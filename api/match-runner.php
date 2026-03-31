<?php
// ============================================================================
// Match Runner — Server-authoritative match execution
// ============================================================================

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/ranked.php';

class MatchRunner
{
    /** @var array<int, array> */
    private array $matchHistory = [];

    /** @var array<string, array> */
    private array $replays = [];

    private RatingStore $ratingStore;

    public function __construct(RatingStore $ratingStore)
    {
        $this->ratingStore = $ratingStore;
    }

    /**
     * Execute a server-authoritative ranked match.
     *
     * NOTE: The engine's runMatch() function is not available in PHP.
     * This method prepares the setup and delegates to an external engine
     * or a PHP port of the engine. The $runMatchFn callback simulates
     * the engine call: fn(array $setup): array returning
     * ['winner' => int|null, 'replay' => [...]]
     */
    public function runRankedMatch(array $request, callable $runMatchFn): array
    {
        $player1EloAtStart = $this->ratingStore->getOrCreate($request['player1']['playerId'])['elo'];
        $player2EloAtStart = $this->ratingStore->getOrCreate($request['player2']['playerId'])['elo'];

        $setup = [
            'config'       => $request['config'],
            'participants' => [
                [
                    'program'    => $request['player1']['program'],
                    'constants'  => $request['player1']['constants'],
                    'playerId'   => $request['player1']['playerId'],
                    'teamId'     => 0,
                ],
                [
                    'program'    => $request['player2']['program'],
                    'constants'  => $request['player2']['constants'],
                    'playerId'   => $request['player2']['playerId'],
                    'teamId'     => 1,
                ],
            ],
        ];

        $result = $runMatchFn($setup);
        $matchId = $result['replay']['metadata']['matchId'];

        // Update ratings
        if ($request['config']['mode'] === '1v1_ranked') {
            if ($result['winner'] === 0) {
                $this->ratingStore->recordResult(
                    $request['player1']['playerId'],
                    $request['player2']['playerId'],
                    $matchId
                );
            } elseif ($result['winner'] === 1) {
                $this->ratingStore->recordResult(
                    $request['player2']['playerId'],
                    $request['player1']['playerId'],
                    $matchId
                );
            } else {
                $this->ratingStore->recordDraw(
                    $request['player1']['playerId'],
                    $request['player2']['playerId'],
                    $matchId
                );
            }
        }

        // Create match record
        $participants = array_map(function (array $p, int $i) use ($player1EloAtStart, $player2EloAtStart) {
            $p['eloAtStart'] = $i === 0 ? $player1EloAtStart : $player2EloAtStart;
            return $p;
        }, $result['replay']['metadata']['participants'], array_keys($result['replay']['metadata']['participants']));

        $record = [
            'matchId'       => $matchId,
            'config'        => $request['config'],
            'participants'  => $participants,
            'status'        => 'completed',
            'winner'        => $result['winner'],
            'startedAt'     => (int) (microtime(true) * 1000),
            'endedAt'       => (int) (microtime(true) * 1000),
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
     * @param callable $runMatchFn  fn(array $setup): array
     */
    public function runUnrankedMatch(array $request, callable $runMatchFn): array
    {
        $unrankedConfig = $request['config'];
        $unrankedConfig['mode'] = '1v1_unranked';

        $setup = [
            'config'       => $unrankedConfig,
            'participants' => [
                [
                    'program'    => $request['player1']['program'],
                    'constants'  => $request['player1']['constants'],
                    'playerId'   => $request['player1']['playerId'],
                    'teamId'     => 0,
                ],
                [
                    'program'    => $request['player2']['program'],
                    'constants'  => $request['player2']['constants'],
                    'playerId'   => $request['player2']['playerId'],
                    'teamId'     => 1,
                ],
            ],
        ];

        $result = $runMatchFn($setup);
        $matchId = $result['replay']['metadata']['matchId'];

        $record = [
            'matchId'       => $matchId,
            'config'        => $unrankedConfig,
            'participants'  => $result['replay']['metadata']['participants'],
            'status'        => 'completed',
            'winner'        => $result['winner'],
            'startedAt'     => (int) (microtime(true) * 1000),
            'endedAt'       => (int) (microtime(true) * 1000),
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
}
