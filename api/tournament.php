<?php
// ============================================================================
// Tournament System — Single Elimination, Round Robin, Swiss
// ============================================================================

require_once __DIR__ . '/config.php';

/**
 * Simple seeded PRNG (matching the JS SeededRNG behaviour).
 */
class SeededRNG
{
    private int $state;

    public function __construct(int $seed)
    {
        $this->state = $seed;
    }

    /** Generate a pseudo-random float in [0, 1) */
    public function next(): float
    {
        // Simple LCG
        $this->state = ($this->state * 1664525 + 1013904223) & 0x7FFFFFFF;
        return $this->state / 0x80000000;
    }

    /** Generate a pseudo-random integer in [$min, $max] */
    public function nextInt(int $min, int $max): int
    {
        return $min + (int) floor($this->next() * ($max - $min + 1));
    }
}

class TournamentManager
{
    /**
     * @var array<string, array> tournamentId => TournamentState
     *   TournamentState: {tournament, entries, rng, currentRound}
     */
    private array $tournaments = [];

    /**
     * Create a new tournament.
     *
     * @param string $name
     * @param string $format  'single_elimination' | 'round_robin' | 'swiss'
     * @param array  $entries TournamentEntry[]
     * @param int    $seed
     * @return array          Tournament data
     */
    public function createTournament(
        string $name,
        string $format,
        array  $entries,
        int    $seed = 0,
    ): array {
        if ($seed === 0) {
            $seed = (int) (microtime(true) * 1000);
        }

        $id  = 'tournament_' . $seed;
        $rng = new SeededRNG($seed);

        // Seed participants by Elo (highest first)
        usort($entries, fn(array $a, array $b) => $b['elo'] <=> $a['elo']);

        $participants = [];
        foreach ($entries as $i => $e) {
            $participants[] = [
                'playerId'   => $e['playerId'],
                'programId'  => $e['program']['programId'] ?? '',
                'seed'       => $i + 1,
                'wins'       => 0,
                'losses'     => 0,
                'eliminated' => false,
            ];
        }

        $tournament = [
            'id'           => $id,
            'name'         => $name,
            'format'       => $format,
            'status'       => 'in_progress',
            'participants' => $participants,
            'rounds'       => [],
            'createdAt'    => (int) (microtime(true) * 1000),
        ];

        $this->tournaments[$id] = [
            'tournament'   => $tournament,
            'entries'      => $entries,
            'rng'          => $rng,
            'currentRound' => 0,
        ];

        // Generate first round
        $this->generateNextRound($id);

        return $this->tournaments[$id]['tournament'];
    }

    // -------------------------------------------------------------------------
    // Round generation
    // -------------------------------------------------------------------------

    private function generateNextRound(string $tournamentId): ?array
    {
        if (!isset($this->tournaments[$tournamentId])) {
            return null;
        }

        $tournament = &$this->tournaments[$tournamentId]['tournament'];
        $rng        = $this->tournaments[$tournamentId]['rng'];

        $active = array_values(array_filter(
            $tournament['participants'],
            fn(array $p) => !$p['eliminated'],
        ));

        if (count($active) < 2) {
            return null;
        }

        $matches = match ($tournament['format']) {
            'single_elimination' => $this->generateSingleEliminationPairings($active, $rng),
            'round_robin'        => $this->generateRoundRobinPairings($tournament, $this->tournaments[$tournamentId]['currentRound']),
            'swiss'              => $this->generateSwissPairings($active, $rng),
            default              => null,
        };

        if ($matches === null) {
            return null;
        }

        $round = [
            'roundNumber' => $this->tournaments[$tournamentId]['currentRound'] + 1,
            'matches'     => $matches,
            'completed'   => false,
        ];

        $tournament['rounds'][] = $round;
        $this->tournaments[$tournamentId]['currentRound']++;

        return $round;
    }

    // -------------------------------------------------------------------------
    // Run current round
    // -------------------------------------------------------------------------

    public function runCurrentRound(string $tournamentId): ?array
    {
        if (!isset($this->tournaments[$tournamentId])) {
            return null;
        }

        $tournament = &$this->tournaments[$tournamentId]['tournament'];
        $entries    = $this->tournaments[$tournamentId]['entries'];
        $rng        = $this->tournaments[$tournamentId]['rng'];

        $roundIndex = count($tournament['rounds']) - 1;
        if ($roundIndex < 0) {
            return null;
        }

        $currentRound = &$tournament['rounds'][$roundIndex];
        if ($currentRound['completed']) {
            return null;
        }

        foreach ($currentRound['matches'] as &$match) {
            if ($match['completed']) {
                continue;
            }

            $entry1 = $entries[$match['participant1Index']] ?? null;
            $entry2 = $entries[$match['participant2Index']] ?? null;
            if (!$entry1 || !$entry2) {
                continue;
            }

            $setup = [
                'config' => [
                    'mode'        => 'tournament',
                    'arenaWidth'  => ARENA_WIDTH,
                    'arenaHeight' => ARENA_HEIGHT,
                    'maxTicks'    => MAX_TICKS,
                    'tickRate'    => TICK_RATE,
                    'seed'        => $rng->nextInt(0, 2147483647),
                ],
                'participants' => [
                    [
                        'program'   => $entry1['program'],
                        'constants' => $entry1['constants'],
                        'playerId'  => $entry1['playerId'],
                        'teamId'    => 0,
                    ],
                    [
                        'program'   => $entry2['program'],
                        'constants' => $entry2['constants'],
                        'playerId'  => $entry2['playerId'],
                        'teamId'    => 1,
                    ],
                ],
            ];

            $result = $this->runMatchEngine($setup);
            $match['matchId']   = 'tmatch_' . $rng->nextInt(0, 999999);
            $match['completed'] = true;

            if ($result['winner'] === 0) {
                $match['winner'] = $match['participant1Index'];
                $tournament['participants'][$match['participant1Index']]['wins']++;
                $tournament['participants'][$match['participant2Index']]['losses']++;
                if ($tournament['format'] === 'single_elimination') {
                    $tournament['participants'][$match['participant2Index']]['eliminated'] = true;
                }
            } elseif ($result['winner'] === 1) {
                $match['winner'] = $match['participant2Index'];
                $tournament['participants'][$match['participant2Index']]['wins']++;
                $tournament['participants'][$match['participant1Index']]['losses']++;
                if ($tournament['format'] === 'single_elimination') {
                    $tournament['participants'][$match['participant1Index']]['eliminated'] = true;
                }
            } else {
                // Draw — in single elimination, give it to higher seed
                $match['winner'] = $match['participant1Index'];
                if ($tournament['format'] === 'single_elimination') {
                    $tournament['participants'][$match['participant2Index']]['eliminated'] = true;
                }
            }
        }
        unset($match);

        $currentRound['completed'] = true;

        // Check if tournament is over
        $active = array_values(array_filter(
            $tournament['participants'],
            fn(array $p) => !$p['eliminated'],
        ));

        if ($tournament['format'] === 'single_elimination' && count($active) <= 1) {
            $tournament['status'] = 'completed';
        } elseif ($tournament['format'] === 'round_robin') {
            $totalRounds = count($tournament['participants']) - 1;
            if (count($tournament['rounds']) >= $totalRounds) {
                $tournament['status'] = 'completed';
            } else {
                $this->generateNextRound($tournamentId);
            }
        } elseif ($tournament['format'] === 'swiss') {
            $totalRounds = (int) ceil(log(count($tournament['participants']), 2));
            if (count($tournament['rounds']) >= $totalRounds) {
                $tournament['status'] = 'completed';
            } else {
                $this->generateNextRound($tournamentId);
            }
        }

        // Generate next round if not complete (single elimination)
        if ($tournament['status'] === 'in_progress' && $tournament['format'] === 'single_elimination') {
            $this->generateNextRound($tournamentId);
        }

        return $currentRound;
    }

    // -------------------------------------------------------------------------
    // Standings
    // -------------------------------------------------------------------------

    /** @return array[] */
    public function getStandings(string $tournamentId): array
    {
        if (!isset($this->tournaments[$tournamentId])) {
            return [];
        }

        $participants = $this->tournaments[$tournamentId]['tournament']['participants'];
        usort($participants, function (array $a, array $b) {
            if ($a['eliminated'] && !$b['eliminated']) return 1;
            if (!$a['eliminated'] && $b['eliminated']) return -1;
            return ($b['wins'] <=> $a['wins'])
                ?: ($a['losses'] <=> $b['losses'])
                ?: ($a['seed'] <=> $b['seed']);
        });

        return $participants;
    }

    public function getTournament(string $id): ?array
    {
        return $this->tournaments[$id]['tournament'] ?? null;
    }

    // -------------------------------------------------------------------------
    // Pairing generators
    // -------------------------------------------------------------------------

    private function generateSingleEliminationPairings(array $active, SeededRNG $rng): array
    {
        $matches = [];
        // Pair by seed: 1v(n), 2v(n-1), etc.
        usort($active, fn(array $a, array $b) => $a['seed'] <=> $b['seed']);
        $count = count($active);
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
        return $matches;
    }

    private function generateRoundRobinPairings(array $tournament, int $roundIndex): array
    {
        $n       = count($tournament['participants']);
        $matches = [];

        // Circle method for round-robin scheduling: fix player 0, rotate others
        $indices = range(0, $n - 1);

        for ($r = 0; $r < $roundIndex; $r++) {
            $last = array_pop($indices);
            array_splice($indices, 1, 0, [$last]);
        }

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

    private function generateSwissPairings(array $active, SeededRNG $rng): array
    {
        // Sort by wins (desc), then by seed
        usort($active, fn(array $a, array $b) =>
            ($b['wins'] <=> $a['wins']) ?: ($a['seed'] <=> $b['seed'])
        );

        $matches = [];
        $paired  = [];

        $count = count($active);
        for ($i = 0; $i < $count; $i++) {
            $idx1 = $active[$i]['seed'] - 1;
            if (isset($paired[$idx1])) {
                continue;
            }
            for ($j = $i + 1; $j < $count; $j++) {
                $idx2 = $active[$j]['seed'] - 1;
                if (isset($paired[$idx2])) {
                    continue;
                }
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

    // -------------------------------------------------------------------------
    // Engine hook — replace with actual match engine implementation
    // -------------------------------------------------------------------------

    /**
     * Stub for the match engine. Replace with real implementation.
     *
     * @param array $setup
     * @return array {winner: int|null, replay: array}
     */
    protected function runMatchEngine(array $setup): array
    {
        $matchId = 'match_' . bin2hex(random_bytes(8));
        return [
            'winner' => null,
            'replay' => [
                'metadata' => [
                    'matchId'      => $matchId,
                    'participants' => $setup['participants'],
                ],
            ],
        ];
    }
}
