<?php
// ============================================================================
// Tournament System — Single Elimination, Round Robin, Swiss
// ============================================================================

/**
 * Simple seeded PRNG (matches the SeededRNG from the TS codebase).
 * Uses a linear congruential generator for deterministic sequences.
 */
class SeededRNG
{
    private int $state;

    public function __construct(int $seed)
    {
        $this->state = $seed;
    }

    public function nextFloat(): float
    {
        // Mulberry32-style
        $this->state = ($this->state + 0x6D2B79F5) & 0x7FFFFFFF;
        $t = ($this->state ^ ($this->state >> 15)) * ($this->state | 1);
        $t = ($t + (($t ^ ($t >> 7)) * ($t | 61))) & 0x7FFFFFFF;
        return (($t ^ ($t >> 14)) & 0x7FFFFFFF) / 0x7FFFFFFF;
    }

    public function nextInt(int $min, int $max): int
    {
        return $min + (int) floor($this->nextFloat() * ($max - $min + 1));
    }
}

class TournamentManager
{
    /**
     * @var array<string, array{tournament: array, entries: array, rng: SeededRNG, currentRound: int}>
     */
    private array $tournaments = [];

    /**
     * Create a new tournament.
     *
     * @param string $name
     * @param string $format  'single_elimination' | 'round_robin' | 'swiss'
     * @param array  $entries Array of ['playerId'=>string,'program'=>array,'constants'=>array,'elo'=>int]
     * @param int    $seed
     * @return array  The tournament data structure
     */
    public function createTournament(
        string $name,
        string $format,
        array $entries,
        int $seed = 0
    ): array {
        if ($seed === 0) {
            $seed = (int) (microtime(true) * 1000);
        }

        $id = "tournament_{$seed}";
        $rng = new SeededRNG($seed);

        // Seed participants by Elo (highest first)
        $sorted = $entries;
        usort($sorted, fn(array $a, array $b) => $b['elo'] <=> $a['elo']);

        $participants = [];
        foreach ($sorted as $i => $e) {
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
            'entries'      => $sorted,
            'rng'          => $rng,
            'currentRound' => 0,
        ];

        // Generate first round
        $this->generateNextRound($id);

        return $this->tournaments[$id]['tournament'];
    }

    /** Generate pairings for the next round */
    private function generateNextRound(string $tournamentId): ?array
    {
        if (!isset($this->tournaments[$tournamentId])) {
            return null;
        }

        $state = &$this->tournaments[$tournamentId];
        $tournament = &$state['tournament'];
        $rng = $state['rng'];

        $active = array_values(array_filter(
            $tournament['participants'],
            fn(array $p) => !$p['eliminated']
        ));

        if (count($active) < 2) {
            return null;
        }

        $matches = [];

        switch ($tournament['format']) {
            case 'single_elimination':
                $matches = $this->generateSingleEliminationPairings($active, $rng);
                break;
            case 'round_robin':
                $matches = $this->generateRoundRobinPairings($tournament, $state['currentRound']);
                break;
            case 'swiss':
                $matches = $this->generateSwissPairings($active, $rng);
                break;
            default:
                return null;
        }

        $round = [
            'roundNumber' => $state['currentRound'] + 1,
            'matches'     => $matches,
            'completed'   => false,
        ];

        $tournament['rounds'][] = $round;
        $state['currentRound']++;

        return $round;
    }

    /**
     * Run all matches in the current round.
     *
     * @param callable $runMatchFn  fn(array $setup): array returning ['winner'=>int|null, 'replay'=>[...]]
     */
    public function runCurrentRound(string $tournamentId, callable $runMatchFn): ?array
    {
        if (!isset($this->tournaments[$tournamentId])) {
            return null;
        }

        $state = &$this->tournaments[$tournamentId];
        $tournament = &$state['tournament'];
        $entries = $state['entries'];
        $rng = $state['rng'];

        if (empty($tournament['rounds'])) {
            return null;
        }

        $currentRound = &$tournament['rounds'][count($tournament['rounds']) - 1];
        if ($currentRound['completed']) {
            return null;
        }

        foreach ($currentRound['matches'] as &$match) {
            if ($match['completed']) {
                continue;
            }

            $entry1 = $entries[$match['participant1Index']] ?? null;
            $entry2 = $entries[$match['participant2Index']] ?? null;

            if ($entry1 === null || $entry2 === null) {
                continue;
            }

            $setup = [
                'config' => [
                    'mode'        => 'tournament',
                    'arenaWidth'  => 100,
                    'arenaHeight' => 100,
                    'maxTicks'    => 3000,
                    'tickRate'    => 30,
                    'seed'        => $rng->nextInt(0, 2147483647),
                ],
                'participants' => [
                    [
                        'program'    => $entry1['program'],
                        'constants'  => $entry1['constants'],
                        'playerId'   => $entry1['playerId'],
                        'teamId'     => 0,
                    ],
                    [
                        'program'    => $entry2['program'],
                        'constants'  => $entry2['constants'],
                        'playerId'   => $entry2['playerId'],
                        'teamId'     => 1,
                    ],
                ],
            ];

            $result = $runMatchFn($setup);
            $match['matchId'] = 'tmatch_' . $rng->nextInt(0, 999999);
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
                // Draw -- in single elimination, give it to higher seed
                $match['winner'] = $match['participant1Index'];
                if ($tournament['format'] === 'single_elimination') {
                    $tournament['participants'][$match['participant2Index']]['eliminated'] = true;
                }
            }
        }
        unset($match);

        $currentRound['completed'] = true;

        // Check if tournament is over
        $active = array_filter(
            $tournament['participants'],
            fn(array $p) => !$p['eliminated']
        );

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

    /** Get tournament standings */
    public function getStandings(string $tournamentId): array
    {
        if (!isset($this->tournaments[$tournamentId])) {
            return [];
        }

        $participants = $this->tournaments[$tournamentId]['tournament']['participants'];
        usort($participants, function (array $a, array $b) {
            if ($a['eliminated'] && !$b['eliminated']) return 1;
            if (!$a['eliminated'] && $b['eliminated']) return -1;
            return ($b['wins'] <=> $a['wins']) ?: ($a['losses'] <=> $b['losses']) ?: ($a['seed'] <=> $b['seed']);
        });

        return $participants;
    }

    public function getTournament(string $id): ?array
    {
        return $this->tournaments[$id]['tournament'] ?? null;
    }

    // --- Pairing Generators ---

    private function generateSingleEliminationPairings(array $active, SeededRNG $rng): array
    {
        $matches = [];
        // Pair by seed: 1v(n), 2v(n-1), etc.
        $sorted = $active;
        usort($sorted, fn(array $a, array $b) => $a['seed'] <=> $b['seed']);

        $half = (int) floor(count($sorted) / 2);
        for ($i = 0; $i < $half; $i++) {
            $p1 = $sorted[$i];
            $p2 = $sorted[count($sorted) - 1 - $i];
            $matches[] = [
                'matchId'            => '',
                'participant1Index'  => $p1['seed'] - 1,
                'participant2Index'  => $p2['seed'] - 1,
                'completed'          => false,
            ];
        }
        // Bye for odd participant (auto-advance highest remaining)
        return $matches;
    }

    private function generateRoundRobinPairings(array $tournament, int $roundIndex): array
    {
        $n = count($tournament['participants']);
        $matches = [];

        // Circle method for round-robin scheduling
        // Fix player 0, rotate others
        $indices = range(0, $n - 1);

        for ($r = 0; $r < $roundIndex; $r++) {
            // Rotate all except first
            $last = array_pop($indices);
            array_splice($indices, 1, 0, [$last]);
        }

        $half = (int) floor($n / 2);
        for ($i = 0; $i < $half; $i++) {
            $matches[] = [
                'matchId'            => '',
                'participant1Index'  => $indices[$i],
                'participant2Index'  => $indices[$n - 1 - $i],
                'completed'          => false,
            ];
        }

        return $matches;
    }

    private function generateSwissPairings(array $active, SeededRNG $rng): array
    {
        // Sort by wins (desc), then by seed
        $sorted = $active;
        usort($sorted, fn(array $a, array $b) => ($b['wins'] <=> $a['wins']) ?: ($a['seed'] <=> $b['seed']));

        $matches = [];
        $paired = [];

        for ($i = 0; $i < count($sorted); $i++) {
            $idx1 = $sorted[$i]['seed'] - 1;
            if (isset($paired[$idx1])) {
                continue;
            }
            for ($j = $i + 1; $j < count($sorted); $j++) {
                $idx2 = $sorted[$j]['seed'] - 1;
                if (isset($paired[$idx2])) {
                    continue;
                }
                $matches[] = [
                    'matchId'            => '',
                    'participant1Index'  => $idx1,
                    'participant2Index'  => $idx2,
                    'completed'          => false,
                ];
                $paired[$idx1] = true;
                $paired[$idx2] = true;
                break;
            }
        }

        return $matches;
    }
}
