<?php
// ============================================================================
// Match Runner — Result ingestion, history, and replay storage
// ----------------------------------------------------------------------------
// Model (beta): the deterministic match engine lives in JavaScript
// (js/engine/tick.js). The PHP backend is NOT authoritative for simulation —
// porting the 17k-LOC engine would be a separate, large project. Instead,
// clients submit the result of a locally-run match along with the seed,
// participant list, and optional replay blob. The server:
//
//   1. Validates the structural shape of the submission.
//   2. Verifies the submitting player is one of the listed participants
//      (via the X-Arena-Player auth header) so one player can't report a
//      match on another's behalf.
//   3. Persists a match history record + replay blob keyed by matchId.
//   4. Updates Elo ratings for ranked modes.
//
// This is sufficient for an honest-player beta. A server-authoritative
// "re-run the engine and reject mismatches" mode is future work and is
// scoped in api/README.md.
// ============================================================================

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/ranked.php';
require_once __DIR__ . '/_bootstrap.php';

class MatchRunner
{
    private JsonStore $historyStore;
    private JsonStore $replayStore;
    private RatingStore $ratingStore;

    public function __construct(?RatingStore $ratingStore = null)
    {
        $this->ratingStore  = $ratingStore ?? new RatingStore();
        $this->historyStore = new JsonStore('match-history');
        $this->replayStore  = new JsonStore('replays');
    }

    /**
     * Record a client-submitted match result.
     *
     * Expected $request shape:
     *   {
     *     config:       { mode, arenaWidth, arenaHeight, maxTicks, tickRate, seed },
     *     participants: [ { playerId, teamId, program: { programId, robotName, robotClass, bytecode } } ],
     *     result:       { winner, tickCount, reason, seed },
     *     replay?:      { ... opaque replay blob ... }
     *   }
     *
     * $reporterId is the authenticated player submitting the record; they
     * must be listed in `participants`.
     *
     * @return array  { record, updatedRatings? }
     */
    public function submitResult(array $request, string $reporterId): array
    {
        // ---- Structural validation ----
        if (!isset($request['config']) || !is_array($request['config'])) {
            throw new InvalidArgumentException('config is required');
        }
        if (!isset($request['participants']) || !is_array($request['participants'])) {
            throw new InvalidArgumentException('participants is required');
        }
        if (!isset($request['result']) || !is_array($request['result'])) {
            throw new InvalidArgumentException('result is required');
        }

        $config       = $request['config'];
        $participants = $request['participants'];
        $result       = $request['result'];

        if (count($participants) < 2) {
            throw new InvalidArgumentException('participants must contain at least 2 entries');
        }

        $errors = [];
        foreach ($participants as $i => $p) {
            foreach (as_validate_participant($p) as $err) {
                $errors[] = "participants[$i].$err";
            }
        }
        $errors = array_merge($errors, as_validate_match_result($result));

        if (!empty($errors)) {
            throw new InvalidArgumentException('Validation failed: ' . implode('; ', $errors));
        }

        // ---- Auth: reporter must be one of the participants ----
        $reporterIsParticipant = false;
        foreach ($participants as $p) {
            if (($p['playerId'] ?? null) === $reporterId) {
                $reporterIsParticipant = true;
                break;
            }
        }
        if (!$reporterIsParticipant) {
            throw new DomainException('Reporter is not a participant in this match');
        }

        // ---- Config consistency check ----
        if (($config['seed'] ?? null) !== ($result['seed'] ?? null)) {
            throw new InvalidArgumentException('config.seed must match result.seed');
        }

        // ---- Persist record ----
        $matchId = 'match_' . bin2hex(random_bytes(8));
        $now     = (int) (microtime(true) * 1000);

        $record = [
            'matchId'       => $matchId,
            'config'        => $config,
            'participants'  => array_map(
                fn(array $p): array => [
                    'playerId'   => $p['playerId'],
                    'teamId'     => $p['teamId'],
                    'programId'  => $p['program']['programId']   ?? null,
                    'robotName'  => $p['program']['robotName']   ?? null,
                    'robotClass' => $p['program']['robotClass']  ?? null,
                ],
                $participants,
            ),
            'result'        => [
                'winner'    => $result['winner'],
                'tickCount' => $result['tickCount'],
                'reason'    => $result['reason'],
                'seed'      => $result['seed'],
            ],
            'reportedBy'    => $reporterId,
            'reportedAt'    => $now,
            'engineVersion' => ENGINE_VERSION,
        ];

        $this->historyStore->mutate(function (array $state) use ($matchId, $record): array {
            $history = $state['matches'] ?? [];
            $history[] = $record;
            // Cap history to the most recent 1000 matches per host to prevent
            // unbounded file growth. Replays are stored separately and keyed
            // by matchId; they follow the same retention.
            if (count($history) > 1000) {
                $dropped = array_splice($history, 0, count($history) - 1000);
                // Drop the replays for evicted matches too.
                // (We do this in a separate mutate to keep the lock scoped.)
                $GLOBALS['AS_DROPPED_MATCH_IDS'] = array_map(
                    fn(array $r): string => $r['matchId'],
                    $dropped,
                );
            }
            $state['matches'] = $history;
            return [$state, null];
        });

        if (!empty($GLOBALS['AS_DROPPED_MATCH_IDS'] ?? [])) {
            $dropped = $GLOBALS['AS_DROPPED_MATCH_IDS'];
            unset($GLOBALS['AS_DROPPED_MATCH_IDS']);
            $this->replayStore->mutate(function (array $state) use ($dropped): array {
                foreach ($dropped as $id) {
                    unset($state[$id]);
                }
                return [$state, null];
            });
        }

        // Store replay blob separately so list endpoints stay cheap.
        if (isset($request['replay']) && is_array($request['replay'])) {
            $this->replayStore->mutate(function (array $state) use ($matchId, $request): array {
                $state[$matchId] = $request['replay'];
                return [$state, null];
            });
        }

        // ---- Update ratings for ranked modes ----
        $updatedRatings = null;
        $mode = $config['mode'] ?? '';
        if ($mode === '1v1_ranked' && count($participants) === 2) {
            $p1 = $participants[0];
            $p2 = $participants[1];
            if ($result['winner'] === $p1['teamId']) {
                $updatedRatings = $this->ratingStore->recordResult($p1['playerId'], $p2['playerId'], $matchId);
            } elseif ($result['winner'] === $p2['teamId']) {
                $updatedRatings = $this->ratingStore->recordResult($p2['playerId'], $p1['playerId'], $matchId);
            } else {
                $this->ratingStore->recordDraw($p1['playerId'], $p2['playerId'], $matchId);
                $updatedRatings = [
                    'a' => $this->ratingStore->find($p1['playerId']),
                    'b' => $this->ratingStore->find($p2['playerId']),
                ];
            }
        }

        return [
            'record'         => $record,
            'updatedRatings' => $updatedRatings,
        ];
    }

    /** @return array[] most-recent first */
    public function getMatchHistory(int $limit = 50): array
    {
        $state   = $this->historyStore->readAll();
        $history = $state['matches'] ?? [];
        $history = array_reverse($history); // most recent first
        return array_slice($history, 0, max(0, $limit));
    }

    public function getReplay(string $matchId): ?array
    {
        $state = $this->replayStore->readAll();
        return $state[$matchId] ?? null;
    }

    public function getMatchCount(): int
    {
        $state = $this->historyStore->readAll();
        return count($state['matches'] ?? []);
    }
}

// ----------------------------------------------------------------------------
// HTTP dispatcher
// ----------------------------------------------------------------------------
// POST /api/match-runner.php             -> submit a completed match result
//                                           body: { config, participants, result, replay? }
// GET  /api/match-runner.php             -> recent match history
// GET  /api/match-runner.php?match=<id>  -> fetch a stored replay
// ----------------------------------------------------------------------------

if (PHP_SAPI !== 'cli' && realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    as_bootstrap();

    $runner = new MatchRunner();
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($method === 'GET') {
        if (isset($_GET['match'])) {
            $matchId = $_GET['match'];
            if (!is_string($matchId) || !preg_match('/^match_[a-f0-9]{16}$/', $matchId)) {
                as_error('Invalid match id', 400);
            }
            $replay = $runner->getReplay($matchId);
            if ($replay === null) {
                as_error('Replay not found', 404);
            }
            as_respond(['matchId' => $matchId, 'replay' => $replay]);
        }
        $limit = isset($_GET['limit']) ? (int) $_GET['limit'] : 50;
        as_respond([
            'count'   => $runner->getMatchCount(),
            'matches' => $runner->getMatchHistory($limit),
        ]);
    }

    if ($method === 'POST') {
        $reporter = as_require_player();
        try {
            $response = $runner->submitResult(as_body(), $reporter);
        } catch (InvalidArgumentException $e) {
            as_error($e->getMessage(), 400);
        } catch (DomainException $e) {
            as_error($e->getMessage(), 403);
        }
        as_respond($response, 201);
    }

    as_require_method('GET', 'POST');
}
