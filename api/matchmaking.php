<?php
// ============================================================================
// Matchmaking — Elo-based queue pairing
// ============================================================================

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/ranked.php';

const ELO_RANGE_BASE              = 100;
const ELO_RANGE_EXPANSION_PER_SEC = 10;
const MAX_ELO_RANGE               = 500;

class MatchmakingQueue
{
    /** @var array[] */
    private array $queue = [];
    private RatingStore $ratingStore;

    public function __construct(RatingStore $ratingStore)
    {
        $this->ratingStore = $ratingStore;
    }

    /**
     * Add a player to the matchmaking queue.
     *
     * @param string $playerId
     * @param array  $program   CompiledProgram data
     * @param array  $constants ConstPoolEntry list
     * @param string $mode      MatchMode
     */
    public function enqueue(
        string $playerId,
        array  $program,
        array  $constants,
        string $mode = '1v1_ranked',
    ): void {
        // Remove any existing entry for this player
        $this->queue = array_values(array_filter(
            $this->queue,
            fn(array $e) => $e['playerId'] !== $playerId,
        ));

        $rating = $this->ratingStore->getOrCreate($playerId);
        $this->queue[] = [
            'playerId'   => $playerId,
            'program'    => $program,
            'constants'  => $constants,
            'elo'        => $rating['elo'],
            'enqueuedAt' => (int) (microtime(true) * 1000),
            'mode'       => $mode,
        ];
    }

    /** Remove a player from the queue */
    public function dequeue(string $playerId): void
    {
        $this->queue = array_values(array_filter(
            $this->queue,
            fn(array $e) => $e['playerId'] !== $playerId,
        ));
    }

    /**
     * Try to find a valid match pairing.
     *
     * @return array|null  MatchPairing or null
     */
    public function tryMatch(): ?array
    {
        if (count($this->queue) < 2) {
            return null;
        }

        $now = (int) (microtime(true) * 1000);

        // Sort by queue time (FIFO priority)
        usort($this->queue, fn(array $a, array $b) => $a['enqueuedAt'] <=> $b['enqueuedAt']);

        $length = count($this->queue);

        for ($i = 0; $i < $length; $i++) {
            $p1       = $this->queue[$i];
            $waitTime = ($now - $p1['enqueuedAt']) / 1000;
            $eloRange = min(
                ELO_RANGE_BASE + $waitTime * ELO_RANGE_EXPANSION_PER_SEC,
                MAX_ELO_RANGE,
            );

            for ($j = $i + 1; $j < $length; $j++) {
                $p2 = $this->queue[$j];
                if ($p1['mode'] !== $p2['mode']) {
                    continue;
                }

                $p2WaitTime = ($now - $p2['enqueuedAt']) / 1000;
                $p2EloRange = min(
                    ELO_RANGE_BASE + $p2WaitTime * ELO_RANGE_EXPANSION_PER_SEC,
                    MAX_ELO_RANGE,
                );
                $allowedRange = max($eloRange, $p2EloRange);
                $eloDiff = abs($p1['elo'] - $p2['elo']);
                if ($eloDiff <= $allowedRange) {
                    // Match found — remove both from queue (higher index first)
                    array_splice($this->queue, $j, 1);
                    array_splice($this->queue, $i, 1);

                    return [
                        'player1' => $p1,
                        'player2' => $p2,
                        'config'  => [
                            'mode'        => $p1['mode'],
                            'arenaWidth'  => ARENA_WIDTH,
                            'arenaHeight' => ARENA_HEIGHT,
                            'maxTicks'    => MAX_TICKS,
                            'tickRate'    => TICK_RATE,
                            'seed'        => random_int(0, 2147483646),
                        ],
                    ];
                }
            }
        }

        return null;
    }

    public function getQueueSize(): int
    {
        return count($this->queue);
    }

    /** @return string[] */
    public function getQueuedPlayers(): array
    {
        return array_map(fn(array $e) => $e['playerId'], $this->queue);
    }
}
