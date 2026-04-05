<?php
// ============================================================================
// Matchmaking — Elo-based queue pairing
// ============================================================================

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/ranked.php';
require_once __DIR__ . '/_bootstrap.php';

const ELO_RANGE_BASE              = 100;
const ELO_RANGE_EXPANSION_PER_SEC = 10;
const MAX_ELO_RANGE               = 500;

class MatchmakingQueue
{
    private JsonStore $store;
    private RatingStore $ratingStore;

    public function __construct(RatingStore $ratingStore, ?JsonStore $store = null)
    {
        $this->ratingStore = $ratingStore;
        $this->store       = $store ?? new JsonStore('matchmaking');
    }

    /** @return array[] */
    private function readQueue(): array
    {
        $state = $this->store->readAll();
        return $state['queue'] ?? [];
    }

    public function enqueue(
        string $playerId,
        array  $program,
        array  $constants,
        string $mode = '1v1_ranked',
    ): void {
        $rating = $this->ratingStore->getOrCreate($playerId);
        $entry = [
            'playerId'   => $playerId,
            'program'    => $program,
            'constants'  => $constants,
            'elo'        => $rating['elo'],
            'enqueuedAt' => (int) (microtime(true) * 1000),
            'mode'       => $mode,
        ];
        $this->store->mutate(function (array $state) use ($playerId, $entry): array {
            $queue = $state['queue'] ?? [];
            // Remove any existing entry for this player (re-queue replaces)
            $queue = array_values(array_filter(
                $queue,
                fn(array $e) => $e['playerId'] !== $playerId,
            ));
            $queue[] = $entry;
            $state['queue'] = $queue;
            return [$state, null];
        });
    }

    public function dequeue(string $playerId): void
    {
        $this->store->mutate(function (array $state) use ($playerId): array {
            $queue = $state['queue'] ?? [];
            $queue = array_values(array_filter(
                $queue,
                fn(array $e) => $e['playerId'] !== $playerId,
            ));
            $state['queue'] = $queue;
            return [$state, null];
        });
    }

    /**
     * Try to find a valid match pairing. On success, the two players are
     * removed from the persistent queue atomically.
     *
     * @return array|null  MatchPairing or null
     */
    public function tryMatch(): ?array
    {
        $now  = (int) (microtime(true) * 1000);
        $seed = random_int(0, 2147483646);

        return $this->store->mutate(function (array $state) use ($now, $seed): array {
            $queue = $state['queue'] ?? [];
            if (count($queue) < 2) {
                return [$state, null];
            }

            usort($queue, fn(array $a, array $b) => $a['enqueuedAt'] <=> $b['enqueuedAt']);
            $length = count($queue);

            for ($i = 0; $i < $length; $i++) {
                $p1       = $queue[$i];
                $waitTime = ($now - $p1['enqueuedAt']) / 1000;
                $eloRange = min(
                    ELO_RANGE_BASE + $waitTime * ELO_RANGE_EXPANSION_PER_SEC,
                    MAX_ELO_RANGE,
                );

                for ($j = $i + 1; $j < $length; $j++) {
                    $p2 = $queue[$j];
                    if ($p1['mode'] !== $p2['mode']) {
                        continue;
                    }
                    $p2WaitTime = ($now - $p2['enqueuedAt']) / 1000;
                    $p2EloRange = min(
                        ELO_RANGE_BASE + $p2WaitTime * ELO_RANGE_EXPANSION_PER_SEC,
                        MAX_ELO_RANGE,
                    );
                    $allowedRange = max($eloRange, $p2EloRange);
                    if (abs($p1['elo'] - $p2['elo']) <= $allowedRange) {
                        // Match found — remove both from queue (higher index first)
                        array_splice($queue, $j, 1);
                        array_splice($queue, $i, 1);
                        $state['queue'] = array_values($queue);

                        return [$state, [
                            'player1' => $p1,
                            'player2' => $p2,
                            'config'  => [
                                'mode'        => $p1['mode'],
                                'arenaWidth'  => ARENA_WIDTH,
                                'arenaHeight' => ARENA_HEIGHT,
                                'maxTicks'    => MAX_TICKS,
                                'tickRate'    => TICK_RATE,
                                'seed'        => $seed,
                            ],
                        ]];
                    }
                }
            }

            return [$state, null];
        });
    }

    public function getQueueSize(): int
    {
        return count($this->readQueue());
    }

    /** @return string[] */
    public function getQueuedPlayers(): array
    {
        return array_map(fn(array $e) => $e['playerId'], $this->readQueue());
    }
}

// ----------------------------------------------------------------------------
// HTTP dispatcher
// ----------------------------------------------------------------------------
// POST   /api/matchmaking.php  { action: "enqueue", program, constants, mode? }
// POST   /api/matchmaking.php  { action: "tryMatch" }
// DELETE /api/matchmaking.php             -> leave queue (requires auth)
// GET    /api/matchmaking.php             -> queue status
// ----------------------------------------------------------------------------

if (PHP_SAPI !== 'cli' && realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    as_bootstrap();

    $ratingStore = new RatingStore();
    $queue       = new MatchmakingQueue($ratingStore);
    $method      = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($method === 'GET') {
        as_respond([
            'queueSize' => $queue->getQueueSize(),
            'players'   => $queue->getQueuedPlayers(),
        ]);
    }

    if ($method === 'DELETE') {
        $player = as_require_player();
        $queue->dequeue($player);
        as_respond(['ok' => true]);
    }

    if ($method === 'POST') {
        $player = as_require_player();
        $body   = as_body();
        $action = $body['action'] ?? null;

        if ($action === 'enqueue') {
            $program   = $body['program']   ?? null;
            $constants = $body['constants'] ?? [];
            $mode      = $body['mode']      ?? '1v1_ranked';

            $errors = as_validate_program($program);
            if (!empty($errors)) {
                as_error('Invalid program: ' . implode('; ', $errors), 400);
            }
            as_require(is_array($constants), 'constants must be an array');
            as_require(is_string($mode), 'mode must be a string');

            $queue->enqueue($player, $program, $constants, $mode);
            as_respond([
                'ok'        => true,
                'queueSize' => $queue->getQueueSize(),
            ]);
        }

        if ($action === 'tryMatch') {
            $pairing = $queue->tryMatch();
            as_respond([
                'matched' => $pairing !== null,
                'pairing' => $pairing,
            ]);
        }

        as_error("Unknown action: $action", 400);
    }

    as_require_method('GET', 'POST', 'DELETE');
}
