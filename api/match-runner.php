<?php
// ============================================================================
// Match Runner — Server-authoritative match execution
// ============================================================================

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/ranked.php';

class MatchRunner
{
    /** @var array[] Match history records */
    private array $matchHistory = [];

    /** @var array<string, array> matchId => ReplayData */
    private array $replays = [];

    private RatingStore $ratingStore;

    public function __construct(RatingStore $ratingStore)
    {
        $this->ratingStore = $ratingStore;
    }

    /**
     * Execute a server-authoritative ranked match.
     *
     * The $request parameter expects:
     *   'player1' => ['playerId' => string, 'program' => array, 'constants' => array]
     *   'player2' => ['playerId' => string, 'program' => array, 'constants' => array]
     *   'config'  => MatchConfig array
     *
     * NOTE: The actual match engine (runMatch) is not ported here.
     *       This method provides the orchestration shell; plug in your
     *       PHP engine implementation via the runMatchEngine() hook.
     *
     * @param array $request  MatchRequest
     * @return array          MatchResponse {record, result, replay}
     */
    public function runRankedMatch(array $request): array
    {
        $player1EloAtStart = $this->ratingStore->getOrCreate($request['player1']['playerId'])['elo'];
        $player2EloAtStart = $this->ratingStore->getOrCreate($request['player2']['playerId'])['elo'];

        $setup = [
            'config'       => $request['config'],
            'participants' => [
                [
                    'program'   => $request['player1']['program'],
                    'constants' => $request['player1']['constants'],
                    'playerId'  => $request['player1']['playerId'],
                    'teamId'    => 0,
                ],
                [
                    'program'   => $request['player2']['program'],
                    'constants' => $request['player2']['constants'],
                    'playerId'  => $request['player2']['playerId'],
                    'teamId'    => 1,
                ],
            ],
        ];

        $result  = $this->runMatchEngine($setup);
        $matchId = $result['replay']['metadata']['matchId'];

        // Update ratings
        if ($request['config']['mode'] === '1v1_ranked') {
            if ($result['winner'] === 0) {
                $this->ratingStore->recordResult(
                    $request['player1']['playerId'],
                    $request['player2']['playerId'],
                    $matchId,
                );
            } elseif ($result['winner'] === 1) {
                $this->ratingStore->recordResult(
                    $request['player2']['playerId'],
                    $request['player1']['playerId'],
                    $matchId,
                );
            } else {
                $this->ratingStore->recordDraw(
                    $request['player1']['playerId'],
                    $request['player2']['playerId'],
                    $matchId,
                );
            }
        }

        // Create match record
        $participants = [];
        foreach ($result['replay']['metadata']['participants'] as $i => $p) {
            $p['eloAtStart'] = $i === 0 ? $player1EloAtStart : $player2EloAtStart;
            $participants[] = $p;
        }

        $now = (int) (microtime(true) * 1000);

        $record = [
            'matchId'       => $matchId,
            'config'        => $request['config'],
            'participants'  => $participants,
            'status'        => 'completed',
            'winner'        => $result['winner'],
            'startedAt'     => $now,
            'endedAt'       => $now,
            'replayId'      => $matchId,
            'engineVersion' => ENGINE_VERSION,
        ];

        $this->matchHistory[] = $record;
        $this->replays[$matchId] = $result['replay'];

        return [
            'record' => $record,
            'result' => $result,
            'replay' => $result['replay'],
        ];
    }

    /**
     * Run an unranked match (no Elo changes).
     *
     * @param array $request  MatchRequest
     * @return array          MatchResponse
     */
    public function runUnrankedMatch(array $request): array
    {
        $unrankedConfig = array_merge($request['config'], ['mode' => '1v1_unranked']);

        $setup = [
            'config'       => $unrankedConfig,
            'participants' => [
                [
                    'program'   => $request['player1']['program'],
                    'constants' => $request['player1']['constants'],
                    'playerId'  => $request['player1']['playerId'],
                    'teamId'    => 0,
                ],
                [
                    'program'   => $request['player2']['program'],
                    'constants' => $request['player2']['constants'],
                    'playerId'  => $request['player2']['playerId'],
                    'teamId'    => 1,
                ],
            ],
        ];

        $result  = $this->runMatchEngine($setup);
        $matchId = $result['replay']['metadata']['matchId'];

        $now = (int) (microtime(true) * 1000);

        $record = [
            'matchId'       => $matchId,
            'config'        => $unrankedConfig,
            'participants'  => $result['replay']['metadata']['participants'],
            'status'        => 'completed',
            'winner'        => $result['winner'],
            'startedAt'     => $now,
            'endedAt'       => $now,
            'replayId'      => $matchId,
            'engineVersion' => ENGINE_VERSION,
        ];

        $this->matchHistory[] = $record;
        $this->replays[$matchId] = $result['replay'];

        return [
            'record' => $record,
            'result' => $result,
            'replay' => $result['replay'],
        ];
    }

    /** @return array[] */
    public function getMatchHistory(int $limit = 50): array
    {
        return array_slice($this->matchHistory, -$limit);
    }

    public function getReplay(string $matchId): ?array
    {
        return $this->replays[$matchId] ?? null;
    }

    public function getMatchCount(): int
    {
        return count($this->matchHistory);
    }

    // -------------------------------------------------------------------------
    // Engine hook — replace with actual match engine implementation
    // -------------------------------------------------------------------------

    /**
     * Run the match engine. This is a stub that should be replaced with
     * the actual PHP game engine when it is ported.
     *
     * @param array $setup  MatchSetup {config, participants}
     * @return array        MatchResult {winner, replay: {metadata: {matchId, participants}}}
     */
    protected function runMatchEngine(array $setup): array
    {
        // Stub: generate a match ID and a placeholder result.
        // Replace this with the real engine call.
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
