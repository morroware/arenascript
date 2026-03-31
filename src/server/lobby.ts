// ============================================================================
// Lobby System — Multiplayer match orchestration
// ============================================================================

import type { CompiledProgram, MatchMode } from "../shared/types.js";
import type { ConstPoolEntry } from "../runtime/opcodes.js";
import type { MatchRunner, MatchResponse } from "./match-runner.js";
import { MatchmakingQueue } from "./matchmaking.js";

export type LobbyStatus = "waiting" | "ready" | "in_match" | "completed";

export interface Lobby {
  id: string;
  name: string;
  host: string;
  mode: MatchMode;
  maxPlayers: number;
  players: LobbyPlayer[];
  status: LobbyStatus;
  createdAt: number;
  matchResult?: MatchResponse;
}

export interface LobbyPlayer {
  playerId: string;
  program?: CompiledProgram;
  constants?: ConstPoolEntry[];
  ready: boolean;
  teamId: number;
}

export class LobbyManager {
  private lobbies = new Map<string, Lobby>();
  private matchRunner: MatchRunner;
  private matchmaking: MatchmakingQueue;
  private nextId = 0;

  constructor(matchRunner: MatchRunner, matchmaking: MatchmakingQueue) {
    this.matchRunner = matchRunner;
    this.matchmaking = matchmaking;
  }

  /** Create a new lobby */
  createLobby(hostId: string, name: string, mode: MatchMode = "1v1_unranked"): Lobby {
    const id = `lobby_${++this.nextId}`;
    const maxPlayers = mode === "2v2" ? 4 : mode === "ffa" ? 8 : 2;

    const lobby: Lobby = {
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
  joinLobby(lobbyId: string, playerId: string): Lobby | null {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) return null;
    if (lobby.status !== "waiting") return null;
    if (lobby.players.length >= lobby.maxPlayers) return null;
    if (lobby.players.some(p => p.playerId === playerId)) return null;

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
  leaveLobby(lobbyId: string, playerId: string): boolean {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) return false;

    lobby.players = lobby.players.filter(p => p.playerId !== playerId);

    if (lobby.players.length === 0) {
      this.lobbies.delete(lobbyId);
    } else if (lobby.host === playerId) {
      lobby.host = lobby.players[0].playerId;
    }

    return true;
  }

  /** Submit a bot program for a player in a lobby */
  submitProgram(lobbyId: string, playerId: string, program: CompiledProgram, constants: ConstPoolEntry[]): boolean {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) return false;

    const player = lobby.players.find(p => p.playerId === playerId);
    if (!player) return false;

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
  startMatch(lobbyId: string): MatchResponse | null {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby || lobby.status !== "ready") return null;

    const readyPlayers = lobby.players
      .filter(p => p.program && p.constants)
      .map(p => ({
        playerId: p.playerId,
        program: p.program!,
        constants: p.constants!,
        teamId: p.teamId,
      }));

    if (readyPlayers.length < 2) return null;

    lobby.status = "in_match";

    const response = this.matchRunner.runUnrankedMatchWithParticipants({
      participants: readyPlayers,
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
  listLobbies(): Lobby[] {
    return [...this.lobbies.values()].filter(l => l.status === "waiting");
  }

  getLobby(id: string): Lobby | undefined {
    return this.lobbies.get(id);
  }
}
