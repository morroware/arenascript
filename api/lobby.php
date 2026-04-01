<?php
// ============================================================================
// Lobby System — Multiplayer match orchestration
// ============================================================================

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/match-runner.php';
require_once __DIR__ . '/matchmaking.php';

class LobbyManager
{
    /** @var array<string, array> lobbyId => Lobby */
    private array $lobbies = [];

    private MatchRunner $matchRunner;
    private MatchmakingQueue $matchmaking;
    private int $nextId = 0;

    public function __construct(MatchRunner $matchRunner, MatchmakingQueue $matchmaking)
    {
        $this->matchRunner  = $matchRunner;
        $this->matchmaking  = $matchmaking;
    }

    /**
     * Create a new lobby.
     *
     * @param string $hostId
     * @param string $name
     * @param string $mode   MatchMode
     * @return array         Lobby data
     */
    public function createLobby(string $hostId, string $name, string $mode = '1v1_unranked'): array
    {
        $id = 'lobby_' . (++$this->nextId);

        $maxPlayers = match ($mode) {
            '2v2'   => 4,
            'ffa'   => 8,
            default => 2,
        };

        $lobby = [
            'id'         => $id,
            'name'       => $name,
            'host'       => $hostId,
            'mode'       => $mode,
            'maxPlayers' => $maxPlayers,
            'players'    => [
                [
                    'playerId' => $hostId,
                    'program'  => null,
                    'constants' => null,
                    'ready'    => false,
                    'teamId'   => 0,
                ],
            ],
            'status'    => 'waiting',
            'createdAt' => (int) (microtime(true) * 1000),
        ];

        $this->lobbies[$id] = $lobby;
        return $lobby;
    }

    /** Join an existing lobby */
    public function joinLobby(string $lobbyId, string $playerId): ?array
    {
        if (!isset($this->lobbies[$lobbyId])) {
            return null;
        }

        $lobby = &$this->lobbies[$lobbyId];

        if ($lobby['status'] !== 'waiting') {
            return null;
        }
        if (count($lobby['players']) >= $lobby['maxPlayers']) {
            return null;
        }

        // Check if already in the lobby
        foreach ($lobby['players'] as $p) {
            if ($p['playerId'] === $playerId) {
                return null;
            }
        }

        $teamId = $lobby['mode'] === '2v2'
            ? count($lobby['players']) % 2
            : count($lobby['players']);

        $lobby['players'][] = [
            'playerId'  => $playerId,
            'program'   => null,
            'constants' => null,
            'ready'     => false,
            'teamId'    => $teamId,
        ];

        return $lobby;
    }

    /** Leave a lobby */
    public function leaveLobby(string $lobbyId, string $playerId): bool
    {
        if (!isset($this->lobbies[$lobbyId])) {
            return false;
        }

        $lobby = &$this->lobbies[$lobbyId];

        $lobby['players'] = array_values(array_filter(
            $lobby['players'],
            fn(array $p) => $p['playerId'] !== $playerId,
        ));

        if (count($lobby['players']) === 0) {
            unset($this->lobbies[$lobbyId]);
        } elseif ($lobby['host'] === $playerId) {
            $lobby['host'] = $lobby['players'][0]['playerId'];
        }

        return true;
    }

    /**
     * Submit a bot program for a player in a lobby.
     *
     * @param string $lobbyId
     * @param string $playerId
     * @param array  $program   CompiledProgram data
     * @param array  $constants ConstPoolEntry list
     * @return bool
     */
    public function submitProgram(string $lobbyId, string $playerId, array $program, array $constants): bool
    {
        if (!isset($this->lobbies[$lobbyId])) {
            return false;
        }

        $lobby = &$this->lobbies[$lobbyId];
        $found = false;

        foreach ($lobby['players'] as &$player) {
            if ($player['playerId'] === $playerId) {
                $player['program']   = $program;
                $player['constants'] = $constants;
                $player['ready']     = true;
                $found = true;
                break;
            }
        }
        unset($player);

        if (!$found) {
            return false;
        }

        // Check if all players are ready
        if (count($lobby['players']) >= 2) {
            $allReady = true;
            foreach ($lobby['players'] as $p) {
                if (!$p['ready'] || !$p['program']) {
                    $allReady = false;
                    break;
                }
            }
            if ($allReady) {
                $lobby['status'] = 'ready';
            }
        }

        return true;
    }

    /** Start the match when all players are ready */
    public function startMatch(string $lobbyId): ?array
    {
        if (!isset($this->lobbies[$lobbyId])) {
            return null;
        }

        $lobby = &$this->lobbies[$lobbyId];

        if ($lobby['status'] !== 'ready') {
            return null;
        }

        $p1 = $lobby['players'][0] ?? null;
        $p2 = $lobby['players'][1] ?? null;

        if (!$p1 || !$p2 || !$p1['program'] || !$p2['program'] || !$p1['constants'] || !$p2['constants']) {
            return null;
        }

        $lobby['status'] = 'in_match';

        $response = $this->matchRunner->runUnrankedMatch([
            'player1' => [
                'playerId'  => $p1['playerId'],
                'program'   => $p1['program'],
                'constants' => $p1['constants'],
            ],
            'player2' => [
                'playerId'  => $p2['playerId'],
                'program'   => $p2['program'],
                'constants' => $p2['constants'],
            ],
            'config' => [
                'mode'        => $lobby['mode'],
                'arenaWidth'  => ARENA_WIDTH,
                'arenaHeight' => ARENA_HEIGHT,
                'maxTicks'    => MAX_TICKS,
                'tickRate'    => TICK_RATE,
                'seed'        => random_int(0, 2147483646),
            ],
        ]);

        $lobby['status']      = 'completed';
        $lobby['matchResult'] = $response;

        return $response;
    }

    /**
     * List open lobbies (status === 'waiting').
     *
     * @return array[]
     */
    public function listLobbies(): array
    {
        return array_values(array_filter(
            $this->lobbies,
            fn(array $l) => $l['status'] === 'waiting',
        ));
    }

    public function getLobby(string $id): ?array
    {
        return $this->lobbies[$id] ?? null;
    }
}
