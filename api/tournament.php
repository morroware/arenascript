<?php
// ============================================================================
// Tournament System — Single Elimination, Round Robin, Swiss
// ----------------------------------------------------------------------------
// Like lobby/match-runner, this is a persistence/coordination layer. The JS
// client is responsible for actually running each match; the server issues
// pairings, tracks standings, and advances rounds as results are reported.
//
// Tournament state lives in api/.storage/tournaments.json.
// ============================================================================

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/_bootstrap.php';

/**
 * Simple seeded PRNG. Matches the LCG flavour used elsewhere in the codebase.
 * We stash the seed state in the persisted tournament blob rather than
 * keeping an instance around, because each HTTP request is short-lived.
 */
final class SeededRNG
{
    public int $state;

    public function __construct(int $seed)
    {
        $this->state = $seed;
    }

    public function next(): float
    {
        $this->state = ($this->state * 1664525 + 1013904223) & 0x7FFFFFFF;
        return $this->state / 0x80000000;
    }

    public function nextInt(int $min, int $max): int
    {
        return $min + (int) floor($this->next() * ($max - $min + 1));
    }
}

class TournamentManager
{
    private JsonStore $store;

    public function __construct(?JsonStore $store = null)
    {
        $this->store = $store ?? new JsonStore('tournaments');
    }

    /**
     * Create a new tournament.
     *
     * @param string $name
     * @param string $format  'single_elimination' | 'round_robin' | 'swiss'
     * @param array  $entries TournamentEntry[]  — each: { playerId, elo, programId? }
     * @param int    $seed
     */
    public function createTournament(
        string $name,
        string $format,
        array  $entries,
        int    $seed = 0,
    ): array {
        if (!in_array($format, ['single_elimination', 'round_robin', 'swiss'], true)) {
            throw new InvalidArgumentException("Unknown tournament format: $format");
        }
        if (count($entries) < 2) {
            throw new InvalidArgumentException('Tournament requires at least 2 entries');
        }

        if ($seed === 0) {
            $seed = random_int(1, 2147483646);
        }

        // Seed participants by Elo (highest first).
        usort($entries, fn(array $a, array $b) => ($b['elo'] ?? 0) <=> ($a['elo'] ?? 0));

        $participants = [];
        foreach ($entries as $i => $e) {
            $participants[] = [
                'playerId'   => $e['playerId'],
                'programId'  => $e['program']['programId'] ?? ($e['programId'] ?? ''),
                'seed'       => $i + 1,
                'elo'        => $e['elo'] ?? INITIAL_ELO,
                'wins'       => 0,
                'losses'     => 0,
                'draws'      => 0,
                'eliminated' => false,
            ];
        }

        $id = 'tournament_' . bin2hex(random_bytes(8));
        $tournament = [
            'id'           => $id,
            'name'         => mb_substr(trim($name), 0, 100) ?: 'Untitled',
            'format'       => $format,
            'status'       => 'in_progress',
            'participants' => $participants,
            'rounds'       => [],
            'rngState'     => $seed,
            'currentRound' => 0,
            'createdAt'    => (int) (microtime(true) * 1000),
        ];

        $this->store->mutate(function (array $state) use ($id, $tournament): array {
            $state['tournaments'] ??= [];
            $state['tournaments'][$id] = $tournament;
            return [$state, null];
        });

        // Generate first round immediately.
        $this->generateNextRound($id);

        return $this->getTournament($id);
    }

    public function getTournament(string $id): ?array
    {
        $state = $this->store->readAll();
        return $state['tournaments'][$id] ?? null;
    }

    /** @return array[] */
    public function listTournaments(): array
    {
        $state = $this->store->readAll();
        return array_values($state['tournaments'] ?? []);
    }

    /**
     * Report the outcome of a single match inside a tournament round.
     * The client runs the match locally (JS engine) and submits the result.
     *
     * @param int $matchIndex  Index inside the current round's matches array.
     */
    public function reportMatchResult(
        string $tournamentId,
        int    $matchIndex,
        ?int   $winner,  // 0 = p1, 1 = p2, null = draw
    ): ?array {
        return $this->store->mutate(function (array $state) use ($tournamentId, $matchIndex, $winner): array {
            $tournaments = $state['tournaments'] ?? [];
            if (!isset($tournaments[$tournamentId])) {
                return [$state, null];
            }
            $t = $tournaments[$tournamentId];
            if ($t['status'] !== 'in_progress') {
                return [$state, null];
            }

            $roundIdx = count($t['rounds']) - 1;
            if ($roundIdx < 0) {
                return [$state, null];
            }
            $round = $t['rounds'][$roundIdx];
            if (!isset($round['matches'][$matchIndex])) {
                return [$state, null];
            }
            $match = $round['matches'][$matchIndex];
            if (!empty($match['completed'])) {
                return [$state, null];
            }

            $p1Idx = $match['participant1Index'];
            $p2Idx = $match['participant2Index'];

            $match['completed'] = true;
            $match['matchId']   = $match['matchId'] ?: 'tmatch_' . bin2hex(random_bytes(4));

            if ($winner === 0) {
                $match['winner'] = $p1Idx;
                $t['participants'][$p1Idx]['wins']++;
                $t['participants'][$p2Idx]['losses']++;
                if ($t['format'] === 'single_elimination') {
                    $t['participants'][$p2Idx]['eliminated'] = true;
                }
            } elseif ($winner === 1) {
                $match['winner'] = $p2Idx;
                $t['participants'][$p2Idx]['wins']++;
                $t['participants'][$p1Idx]['losses']++;
                if ($t['format'] === 'single_elimination') {
                    $t['participants'][$p1Idx]['eliminated'] = true;
                }
            } else {
                // Draw
                $match['draw']   = true;
                $match['winner'] = null;
                if ($t['format'] !== 'single_elimination') {
                    $t['participants'][$p1Idx]['draws']++;
                    $t['participants'][$p2Idx]['draws']++;
                } else {
                    // Higher seed (lower number) advances in single-elim
                    // draws — consistent with the legacy behaviour.
                    $p1Seed = $t['participants'][$p1Idx]['seed'];
                    $p2Seed = $t['participants'][$p2Idx]['seed'];
                    if ($p1Seed <= $p2Seed) {
                        $match['winner'] = $p1Idx;
                        $t['participants'][$p1Idx]['wins']++;
                        $t['participants'][$p2Idx]['losses']++;
                        $t['participants'][$p2Idx]['eliminated'] = true;
                    } else {
                        $match['winner'] = $p2Idx;
                        $t['participants'][$p2Idx]['wins']++;
                        $t['participants'][$p1Idx]['losses']++;
                        $t['participants'][$p1Idx]['eliminated'] = true;
                    }
                }
            }

            $round['matches'][$matchIndex] = $match;

            // Is the round complete?
            $roundDone = true;
            foreach ($round['matches'] as $m) {
                if (empty($m['completed'])) {
                    $roundDone = false;
                    break;
                }
            }
            $round['completed'] = $roundDone;
            $t['rounds'][$roundIdx] = $round;

            if ($roundDone) {
                // Terminal condition check.
                $active = array_values(array_filter(
                    $t['participants'],
                    fn(array $p) => !$p['eliminated'],
                ));
                if ($t['format'] === 'single_elimination' && count($active) <= 1) {
                    $t['status'] = 'completed';
                } elseif ($t['format'] === 'round_robin') {
                    $totalRounds = count($t['participants']) - 1;
                    if (count($t['rounds']) >= $totalRounds) {
                        $t['status'] = 'completed';
                    }
                } elseif ($t['format'] === 'swiss') {
                    $totalRounds = (int) ceil(log(count($t['participants']), 2));
                    if (count($t['rounds']) >= $totalRounds) {
                        $t['status'] = 'completed';
                    }
                }
                if ($t['status'] === 'in_progress') {
                    $t = $this->generateNextRoundInPlace($t);
                }
            }

            $tournaments[$tournamentId] = $t;
            $state['tournaments'] = $tournaments;
            return [$state, $t];
        });
    }

    /** @return array[] */
    public function getStandings(string $tournamentId): array
    {
        $t = $this->getTournament($tournamentId);
        if (!$t) {
            return [];
        }
        $participants = $t['participants'];
        usort($participants, function (array $a, array $b) {
            if ($a['eliminated'] && !$b['eliminated']) return 1;
            if (!$a['eliminated'] && $b['eliminated']) return -1;
            return ($b['wins'] <=> $a['wins'])
                ?: ($a['losses'] <=> $b['losses'])
                ?: ($a['seed']   <=> $b['seed']);
        });
        return $participants;
    }

    // -------------------------------------------------------------------------
    // Pairing generation
    // -------------------------------------------------------------------------

    private function generateNextRound(string $tournamentId): void
    {
        $this->store->mutate(function (array $state) use ($tournamentId): array {
            $tournaments = $state['tournaments'] ?? [];
            if (!isset($tournaments[$tournamentId])) {
                return [$state, null];
            }
            $t = $this->generateNextRoundInPlace($tournaments[$tournamentId]);
            $tournaments[$tournamentId] = $t;
            $state['tournaments'] = $tournaments;
            return [$state, null];
        });
    }

    /**
     * Pure helper that consumes a tournament blob and returns an updated
     * blob with a new round appended. Factored out so it can be called
     * inside an already-open mutate() without deadlocking.
     */
    private function generateNextRoundInPlace(array $t): array
    {
        $active = array_values(array_filter(
            $t['participants'],
            fn(array $p) => !$p['eliminated'],
        ));
        if (count($active) < 2) {
            return $t;
        }

        $rng = new SeededRNG($t['rngState']);
        $matches = match ($t['format']) {
            'single_elimination' => $this->pairSingleElim($active, $t),
            'round_robin'        => $this->pairRoundRobin($t, $t['currentRound']),
            'swiss'              => $this->pairSwiss($active),
            default              => [],
        };
        $t['rngState'] = $rng->state;

        $t['rounds'][] = [
            'roundNumber' => $t['currentRound'] + 1,
            'matches'     => $matches,
            'completed'   => false,
        ];
        $t['currentRound']++;
        return $t;
    }

    /** @return array[] */
    private function pairSingleElim(array $active, array &$t): array
    {
        // Pair by seed: 1 vs n, 2 vs n-1, ...
        usort($active, fn(array $a, array $b) => $a['seed'] <=> $b['seed']);
        $matches = [];
        $count   = count($active);
        for ($i = 0; $i < intdiv($count, 2); $i++) {
            $p1 = $active[$i];
            $p2 = $active[$count - 1 - $i];
            $matches[] = [
                'matchId'           => '',
                'participant1Index' => $p1['seed'] - 1,
                'participant2Index' => $p2['seed'] - 1,
                'completed'         => false,
            ];
        }
        // Odd participant gets a bye (auto-advance).
        if ($count % 2 !== 0) {
            $byePlayer = $active[intdiv($count, 2)];
            $idx = $byePlayer['seed'] - 1;
            if (isset($t['participants'][$idx])) {
                $t['participants'][$idx]['wins']++;
            }
        }
        return $matches;
    }

    /** @return array[] */
    private function pairRoundRobin(array $t, int $roundIndex): array
    {
        $n = count($t['participants']);
        $indices = range(0, $n - 1);
        // Circle method: fix player 0, rotate others.
        for ($r = 0; $r < $roundIndex; $r++) {
            $last = array_pop($indices);
            array_splice($indices, 1, 0, [$last]);
        }
        $matches = [];
        for ($i = 0; $i < intdiv($n, 2); $i++) {
            $matches[] = [
                'matchId'           => '',
                'participant1Index' => $indices[$i],
                'participant2Index' => $indices[$n - 1 - $i],
                'completed'         => false,
            ];
        }
        return $matches;
    }

    /** @return array[] */
    private function pairSwiss(array $active): array
    {
        // Sort by wins desc, then seed asc.
        usort($active, fn(array $a, array $b) =>
            ($b['wins'] <=> $a['wins']) ?: ($a['seed'] <=> $b['seed']),
        );
        $matches = [];
        $paired  = [];
        $count   = count($active);
        for ($i = 0; $i < $count; $i++) {
            $idx1 = $active[$i]['seed'] - 1;
            if (isset($paired[$idx1])) continue;
            for ($j = $i + 1; $j < $count; $j++) {
                $idx2 = $active[$j]['seed'] - 1;
                if (isset($paired[$idx2])) continue;
                $matches[] = [
                    'matchId'           => '',
                    'participant1Index' => $idx1,
                    'participant2Index' => $idx2,
                    'completed'         => false,
                ];
                $paired[$idx1] = true;
                $paired[$idx2] = true;
                break;
            }
        }
        return $matches;
    }
}

// ----------------------------------------------------------------------------
// HTTP dispatcher
// ----------------------------------------------------------------------------
// GET  /api/tournament.php                         -> list tournaments
// GET  /api/tournament.php?id=<tournamentId>       -> tournament detail
// GET  /api/tournament.php?id=<id>&standings=1     -> sorted standings
// POST /api/tournament.php  { action: "create", name, format, entries, seed? }
// POST /api/tournament.php  { action: "report", tournamentId, matchIndex, winner }
// ----------------------------------------------------------------------------

if (PHP_SAPI !== 'cli' && realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    as_bootstrap();
    $manager = new TournamentManager();
    $method  = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($method === 'GET') {
        if (isset($_GET['id'])) {
            $id = $_GET['id'];
            as_require(is_string($id) && preg_match('/^tournament_[a-f0-9]{16}$/', $id), 'invalid tournament id');
            if (isset($_GET['standings'])) {
                as_respond(['standings' => $manager->getStandings($id)]);
            }
            $t = $manager->getTournament($id);
            if ($t === null) as_error('Tournament not found', 404);
            as_respond(['tournament' => $t]);
        }
        as_respond(['tournaments' => $manager->listTournaments()]);
    }

    if ($method === 'POST') {
        $player = as_require_player();
        $body   = as_body();
        $action = $body['action'] ?? null;

        if ($action === 'create') {
            $name    = (string) ($body['name']    ?? 'Untitled Tournament');
            $format  = (string) ($body['format']  ?? 'single_elimination');
            $entries = $body['entries'] ?? null;
            $seed    = (int)    ($body['seed']    ?? 0);
            as_require(is_array($entries) && count($entries) >= 2, 'entries must be an array of at least 2');
            try {
                $t = $manager->createTournament($name, $format, $entries, $seed);
            } catch (InvalidArgumentException $e) {
                as_error($e->getMessage(), 400);
            }
            as_respond(['tournament' => $t], 201);
        }

        if ($action === 'report') {
            $tournamentId = $body['tournamentId'] ?? null;
            $matchIndex   = $body['matchIndex']   ?? null;
            $winner       = $body['winner']       ?? null;
            as_require(is_string($tournamentId), 'tournamentId required');
            as_require(is_int($matchIndex) && $matchIndex >= 0, 'matchIndex must be a non-negative integer');
            as_require($winner === null || $winner === 0 || $winner === 1, 'winner must be 0, 1, or null');
            $t = $manager->reportMatchResult($tournamentId, $matchIndex, $winner);
            if ($t === null) as_error('Unable to report result', 409);
            as_respond(['tournament' => $t]);
        }

        as_error("Unknown action: $action", 400);
    }

    as_require_method('GET', 'POST');
}
