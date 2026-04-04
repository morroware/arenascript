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
        // Sanitize lobby name (limit length, strip control chars)
        $name = mb_substr(trim($name), 0, 100);
        $name = preg_replace('/[\x00-\x1F\x7F]/u', '', $name);
        if ($name === '') {
            $name = 'Untitled Lobby';
        }

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

    /** Leave a lobby (cannot leave during an active match) */
    public function leaveLobby(string $lobbyId, string $playerId): bool
    {
        if (!isset($this->lobbies[$lobbyId])) {
            return false;
        }

        $lobby = &$this->lobbies[$lobbyId];

        if ($lobby['status'] === 'in_match') {
            return false;
        }

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

    /** Start the match when all players are ready (only host can start) */
    public function startMatch(string $lobbyId, ?string $playerId = null): ?array
    {
        if (!isset($this->lobbies[$lobbyId])) {
            return null;
        }

        $lobby = &$this->lobbies[$lobbyId];

        if ($lobby['status'] !== 'ready') {
            return null;
        }

        // Only the host can start the match
        if ($playerId === null || $playerId !== $lobby['host']) {
            return null;
        }

        $readyPlayers = array_values(array_filter(
            $lobby['players'],
            fn(array $p): bool => (bool) ($p['program'] ?? null) && (bool) ($p['constants'] ?? null),
        ));

        if (count($readyPlayers) < 2) {
            return null;
        }

        $lobby['status'] = 'in_match';

        $response = $this->matchRunner->runUnrankedMatchWithParticipants([
            'participants' => array_map(
                fn(array $p): array => [
                    'playerId'  => $p['playerId'],
                    'program'   => $p['program'],
                    'constants' => $p['constants'],
                    'teamId'    => $p['teamId'],
                ],
                $readyPlayers,
            ),
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
