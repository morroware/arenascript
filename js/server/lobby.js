// ============================================================================
// Lobby System — Multiplayer match orchestration
// ============================================================================
import { ARENA_WIDTH, ARENA_HEIGHT, MAX_TICKS, TICK_RATE } from "../shared/config.js";
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
        const readyPlayers = lobby.players
            .filter(p => p.program && p.constants)
            .map(p => ({
            playerId: p.playerId,
            program: p.program,
            constants: p.constants,
            teamId: p.teamId,
        }));
        if (readyPlayers.length < 2)
            return null;
        lobby.status = "in_match";
        const response = this.matchRunner.runUnrankedMatchWithParticipants({
            participants: readyPlayers,
            config: {
                mode: lobby.mode,
                arenaWidth: ARENA_WIDTH,
                arenaHeight: ARENA_HEIGHT,
                maxTicks: MAX_TICKS,
                tickRate: TICK_RATE,
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
