// ============================================================================
// Lobby System — Multiplayer match orchestration
// ============================================================================
export class LobbyManager {
    lobbies = new Map();
    matchRunner;
    matchmaking;
    nextId = 0;
    constructor(matchRunner, matchmaking) {
        this.matchRunner = matchRunner;
        this.matchmaking = matchmaking;
    }
    /** Create a new lobby */
    createLobby(hostId, name, mode = "1v1_unranked") {
        const id = `lobby_${++this.nextId}`;
        const maxPlayers = mode === "2v2" ? 4 : mode === "ffa" ? 8 : 2;
        const lobby = {
            id,
            name,
            host: hostId,
            mode,
            maxPlayers,
            players: [{
                    playerId: hostId,
                    ready: false,
                    teamId: 0,
                }],
            status: "waiting",
            createdAt: Date.now(),
        };
        this.lobbies.set(id, lobby);
        return lobby;
    }
    /** Join an existing lobby */
    joinLobby(lobbyId, playerId) {
        const lobby = this.lobbies.get(lobbyId);
        if (!lobby)
            return null;
        if (lobby.status !== "waiting")
            return null;
        if (lobby.players.length >= lobby.maxPlayers)
            return null;
        if (lobby.players.some(p => p.playerId === playerId))
            return null;
        const teamId = lobby.mode === "2v2"
            ? lobby.players.length % 2
            : lobby.players.length;
        lobby.players.push({
            playerId,
            ready: false,
            teamId,
        });
        return lobby;
    }
    /** Leave a lobby */
    leaveLobby(lobbyId, playerId) {
        const lobby = this.lobbies.get(lobbyId);
        if (!lobby)
            return false;
        lobby.players = lobby.players.filter(p => p.playerId !== playerId);
        if (lobby.players.length === 0) {
            this.lobbies.delete(lobbyId);
        }
        else if (lobby.host === playerId) {
            lobby.host = lobby.players[0].playerId;
        }
        return true;
    }
    /** Submit a bot program for a player in a lobby */
    submitProgram(lobbyId, playerId, program, constants) {
        const lobby = this.lobbies.get(lobbyId);
        if (!lobby)
            return false;
        const player = lobby.players.find(p => p.playerId === playerId);
        if (!player)
            return false;
        player.program = program;
        player.constants = constants;
        player.ready = true;
        // Check if all players are ready
        if (lobby.players.length >= 2 && lobby.players.every(p => p.ready && p.program)) {
            lobby.status = "ready";
        }
        return true;
    }
    /** Start the match when all players are ready */
    startMatch(lobbyId) {
        const lobby = this.lobbies.get(lobbyId);
        if (!lobby || lobby.status !== "ready")
            return null;
        const p1 = lobby.players[0];
        const p2 = lobby.players[1];
        if (!p1?.program || !p2?.program || !p1.constants || !p2.constants)
            return null;
        lobby.status = "in_match";
        const response = this.matchRunner.runUnrankedMatch({
            player1: {
                playerId: p1.playerId,
                program: p1.program,
                constants: p1.constants,
            },
            player2: {
                playerId: p2.playerId,
                program: p2.program,
                constants: p2.constants,
            },
            config: {
                mode: lobby.mode,
                arenaWidth: 100,
                arenaHeight: 100,
                maxTicks: 3000,
                tickRate: 30,
                seed: Math.floor(Math.random() * 2147483647),
            },
        });
        lobby.status = "completed";
        lobby.matchResult = response;
        return response;
    }
    /** List open lobbies */
    listLobbies() {
        return [...this.lobbies.values()].filter(l => l.status === "waiting");
    }
    getLobby(id) {
        return this.lobbies.get(id);
    }
}
