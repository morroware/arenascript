<?php
// ============================================================================
// Lobby System — Multiplayer match orchestration
// ============================================================================

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/_bootstrap.php';
require_once __DIR__ . '/match-runner.php';
require_once __DIR__ . '/matchmaking.php';

class LobbyManager
{
    private JsonStore $store;

    public function __construct(?JsonStore $store = null)
    {
        $this->store = $store ?? new JsonStore('lobbies');
    }

    /** @return array<string, array> */
    private function all(): array
    {
        $state = $this->store->readAll();
        return $state['lobbies'] ?? [];
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
        // Sanitize lobby name (limit length, strip control chars).
        $name = mb_substr(trim($name), 0, 100);
        $name = preg_replace('/[\x00-\x1F\x7F]/u', '', $name);
        if ($name === '') {
            $name = 'Untitled Lobby';
        }

        // Whitelist of user-creatable lobby modes. Modes like 'tournament'
        // and 'test' are intentionally excluded — they're driven by other
        // subsystems, not ad-hoc lobbies.
        $modeMaxPlayers = [
            '1v1_ranked'    => 2,
            '1v1_unranked'  => 2,
            'duel_1v1'      => 2,
            '2v1_unranked'  => 3,
            '2v2'           => 4,
            'squad_2v2'     => 8,
            'ffa'           => 8,
        ];
        if (!isset($modeMaxPlayers[$mode])) {
            throw new InvalidArgumentException("Unsupported lobby mode: $mode");
        }
        $maxPlayers = $modeMaxPlayers[$mode];

        $id = 'lobby_' . bin2hex(random_bytes(16));

        $lobby = [
            'id'         => $id,
            'name'       => $name,
            'host'       => $hostId,
            'mode'       => $mode,
            'maxPlayers' => $maxPlayers,
            'players'    => [[
                'playerId'  => $hostId,
                'program'   => null,
                'constants' => null,
                'ready'     => false,
                'teamId'    => 0,
            ]],
            'status'    => 'waiting',
            'createdAt' => (int) (microtime(true) * 1000),
        ];

        $this->store->mutate(function (array $state) use ($id, $lobby): array {
            $state['lobbies'] ??= [];
            // Collision is astronomically unlikely, but if it ever happens we
            // generate a new id inside the lock so the write is still atomic.
            while (isset($state['lobbies'][$id])) {
                $id = 'lobby_' . bin2hex(random_bytes(16));
                $lobby['id'] = $id;
            }
            $state['lobbies'][$id] = $lobby;
            return [$state, null];
        });

        return $lobby;
    }

    /** Join an existing lobby. Returns the updated lobby or null on failure. */
    public function joinLobby(string $lobbyId, string $playerId): ?array
    {
        return $this->store->mutate(function (array $state) use ($lobbyId, $playerId): array {
            $lobbies = $state['lobbies'] ?? [];
            if (!isset($lobbies[$lobbyId])) {
                return [$state, null];
            }
            $lobby = $lobbies[$lobbyId];
            if ($lobby['status'] !== 'waiting') {
                return [$state, null];
            }
            if (count($lobby['players']) >= $lobby['maxPlayers']) {
                return [$state, null];
            }
            foreach ($lobby['players'] as $p) {
                if ($p['playerId'] === $playerId) {
                    return [$state, null];
                }
            }
            $teamId = $lobby['mode'] === '2v2' || $lobby['mode'] === 'squad_2v2'
                ? count($lobby['players']) % 2
                : count($lobby['players']);
            $lobby['players'][] = [
                'playerId'  => $playerId,
                'program'   => null,
                'constants' => null,
                'ready'     => false,
                'teamId'    => $teamId,
            ];
            $lobbies[$lobbyId]  = $lobby;
            $state['lobbies']   = $lobbies;
            return [$state, $lobby];
        });
    }

    /** Leave a lobby (cannot leave during an active match). */
    public function leaveLobby(string $lobbyId, string $playerId): bool
    {
        return $this->store->mutate(function (array $state) use ($lobbyId, $playerId): array {
            $lobbies = $state['lobbies'] ?? [];
            if (!isset($lobbies[$lobbyId])) {
                return [$state, false];
            }
            $lobby = $lobbies[$lobbyId];
            if ($lobby['status'] === 'in_match') {
                return [$state, false];
            }
            $lobby['players'] = array_values(array_filter(
                $lobby['players'],
                fn(array $p) => $p['playerId'] !== $playerId,
            ));
            if (count($lobby['players']) === 0) {
                unset($lobbies[$lobbyId]);
            } else {
                if ($lobby['host'] === $playerId) {
                    $lobby['host'] = $lobby['players'][0]['playerId'];
                }
                $lobbies[$lobbyId] = $lobby;
            }
            $state['lobbies'] = $lobbies;
            return [$state, true];
        });
    }

    /**
     * Submit a compiled program for a player in a lobby. Marks them ready
     * and flips the lobby to 'ready' state once everyone has submitted.
     */
    public function submitProgram(string $lobbyId, string $playerId, array $program, array $constants): bool
    {
        return $this->store->mutate(function (array $state) use ($lobbyId, $playerId, $program, $constants): array {
            $lobbies = $state['lobbies'] ?? [];
            if (!isset($lobbies[$lobbyId])) {
                return [$state, false];
            }
            $lobby = $lobbies[$lobbyId];
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
                return [$state, false];
            }
            if (count($lobby['players']) >= 2) {
                $allReady = true;
                foreach ($lobby['players'] as $p) {
                    if (empty($p['ready']) || empty($p['program'])) {
                        $allReady = false;
                        break;
                    }
                }
                if ($allReady) {
                    $lobby['status'] = 'ready';
                }
            }
            $lobbies[$lobbyId] = $lobby;
            $state['lobbies']  = $lobbies;
            return [$state, true];
        });
    }

    /**
     * Transition a lobby to 'in_match'. The JS client actually runs the
     * match; when it's done it calls match-runner.php with the result and
     * then calls completeMatch() below.
     *
     * Returns the match-setup payload the client should feed to runMatch().
     */
    public function startMatch(string $lobbyId, string $playerId): ?array
    {
        return $this->store->mutate(function (array $state) use ($lobbyId, $playerId): array {
            $lobbies = $state['lobbies'] ?? [];
            if (!isset($lobbies[$lobbyId])) {
                return [$state, null];
            }
            $lobby = $lobbies[$lobbyId];
            if ($lobby['status'] !== 'ready' || $lobby['host'] !== $playerId) {
                return [$state, null];
            }
            $readyPlayers = array_values(array_filter(
                $lobby['players'],
                fn(array $p): bool => !empty($p['program']) && isset($p['constants']),
            ));
            if (count($readyPlayers) < 2) {
                return [$state, null];
            }
            $lobby['status'] = 'in_match';
            $lobby['matchSetup'] = [
                'config' => [
                    'mode'        => $lobby['mode'],
                    'arenaWidth'  => ARENA_WIDTH,
                    'arenaHeight' => ARENA_HEIGHT,
                    'maxTicks'    => MAX_TICKS,
                    'tickRate'    => TICK_RATE,
                    'seed'        => random_int(0, 2147483646),
                ],
                'participants' => array_map(
                    fn(array $p): array => [
                        'playerId'  => $p['playerId'],
                        'program'   => $p['program'],
                        'constants' => $p['constants'],
                        'teamId'    => $p['teamId'],
                    ],
                    $readyPlayers,
                ),
            ];
            $lobbies[$lobbyId] = $lobby;
            $state['lobbies']  = $lobbies;
            return [$state, $lobby['matchSetup']];
        });
    }

    /** Called by a client after the match finishes. Records the result. */
    public function completeMatch(string $lobbyId, string $playerId, array $result): ?array
    {
        return $this->store->mutate(function (array $state) use ($lobbyId, $playerId, $result): array {
            $lobbies = $state['lobbies'] ?? [];
            if (!isset($lobbies[$lobbyId])) {
                return [$state, null];
            }
            $lobby = $lobbies[$lobbyId];
            if ($lobby['status'] !== 'in_match') {
                return [$state, null];
            }
            // Only participants of the in-match lobby can mark it complete.
            $isParticipant = false;
            foreach ($lobby['players'] as $p) {
                if ($p['playerId'] === $playerId) {
                    $isParticipant = true;
                    break;
                }
            }
            if (!$isParticipant) {
                return [$state, null];
            }
            $lobby['status']      = 'completed';
            $lobby['matchResult'] = $result;
            $lobbies[$lobbyId]    = $lobby;
            $state['lobbies']     = $lobbies;
            return [$state, $lobby];
        });
    }

    /** List open lobbies (status === 'waiting'). @return array[] */
    public function listLobbies(): array
    {
        return array_values(array_filter(
            $this->all(),
            fn(array $l) => $l['status'] === 'waiting',
        ));
    }

    public function getLobby(string $id): ?array
    {
        return $this->all()[$id] ?? null;
    }
}

// ----------------------------------------------------------------------------
// HTTP dispatcher
// ----------------------------------------------------------------------------
// GET    /api/lobby.php                    -> list open lobbies
// GET    /api/lobby.php?id=<lobbyId>       -> single lobby
// POST   /api/lobby.php  { action: "create", name, mode }
// POST   /api/lobby.php  { action: "join", lobbyId }
// POST   /api/lobby.php  { action: "submit", lobbyId, program, constants }
// POST   /api/lobby.php  { action: "start", lobbyId }
// POST   /api/lobby.php  { action: "complete", lobbyId, result }
// DELETE /api/lobby.php  { lobbyId }       -> leave
//
// Every write requires the X-Arena-Player header.
// ----------------------------------------------------------------------------

if (PHP_SAPI !== 'cli' && realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    as_bootstrap();

    $manager = new LobbyManager();
    $method  = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($method === 'GET') {
        if (isset($_GET['id'])) {
            $id = $_GET['id'];
            as_require(is_string($id) && preg_match('/^lobby_[a-f0-9]{32}$/', $id), 'invalid lobby id');
            $lobby = $manager->getLobby($id);
            if ($lobby === null) as_error('Lobby not found', 404);
            as_respond(['lobby' => $lobby]);
        }
        as_respond(['lobbies' => $manager->listLobbies()]);
    }

    if ($method === 'DELETE') {
        $player = as_require_player();
        $body   = as_body();
        $lobbyId = $body['lobbyId'] ?? null;
        as_require(is_string($lobbyId), 'lobbyId required');
        $ok = $manager->leaveLobby($lobbyId, $player);
        as_respond(['ok' => $ok]);
    }

    if ($method === 'POST') {
        $player = as_require_player();
        $body   = as_body();
        $action = $body['action'] ?? null;

        switch ($action) {
            case 'create':
                $name = (string) ($body['name'] ?? 'Untitled Lobby');
                $mode = (string) ($body['mode'] ?? '1v1_unranked');
                try {
                    $lobby = $manager->createLobby($player, $name, $mode);
                } catch (InvalidArgumentException $e) {
                    as_error($e->getMessage(), 400);
                }
                as_respond(['lobby' => $lobby], 201);

            case 'join':
                $lobbyId = $body['lobbyId'] ?? null;
                as_require(is_string($lobbyId), 'lobbyId required');
                $lobby = $manager->joinLobby($lobbyId, $player);
                if ($lobby === null) as_error('Unable to join lobby', 409);
                as_respond(['lobby' => $lobby]);

            case 'submit':
                $lobbyId   = $body['lobbyId']   ?? null;
                $program   = $body['program']   ?? null;
                $constants = $body['constants'] ?? [];
                as_require(is_string($lobbyId), 'lobbyId required');
                $errors = as_validate_program($program);
                if (!empty($errors)) as_error('Invalid program: ' . implode('; ', $errors), 400);
                as_require(is_array($constants), 'constants must be an array');
                $ok = $manager->submitProgram($lobbyId, $player, $program, $constants);
                if (!$ok) as_error('Unable to submit program (not in lobby?)', 409);
                as_respond(['ok' => true, 'lobby' => $manager->getLobby($lobbyId)]);

            case 'start':
                $lobbyId = $body['lobbyId'] ?? null;
                as_require(is_string($lobbyId), 'lobbyId required');
                $setup = $manager->startMatch($lobbyId, $player);
                if ($setup === null) as_error('Unable to start match', 409);
                as_respond(['setup' => $setup]);

            case 'complete':
                $lobbyId = $body['lobbyId'] ?? null;
                $result  = $body['result']  ?? null;
                as_require(is_string($lobbyId), 'lobbyId required');
                $errors = as_validate_match_result($result);
                if (!empty($errors)) as_error('Invalid result: ' . implode('; ', $errors), 400);
                $lobby = $manager->completeMatch($lobbyId, $player, $result);
                if ($lobby === null) as_error('Unable to complete match', 409);
                as_respond(['lobby' => $lobby]);

            default:
                as_error("Unknown action: $action", 400);
        }
    }

    as_require_method('GET', 'POST', 'DELETE');
}
