// ============================================================================
// Match Runner — Server-authoritative match execution
// ============================================================================

import type { CompiledProgram, MatchConfig, MatchRecord, ReplayData } from "../shared/types.js";
import type { ConstPoolEntry } from "../runtime/opcodes.js";
import { runMatch, type MatchSetup, type MatchResult } from "../engine/tick.js";
import { RatingStore } from "./ranked.js";
import { ENGINE_VERSION } from "../shared/config.js";

export interface MatchRequest {
  player1: { playerId: string; program: CompiledProgram; constants: ConstPoolEntry[] };
  player2: { playerId: string; program: CompiledProgram; constants: ConstPoolEntry[] };
  config: MatchConfig;
}

export interface MatchResponse {
  record: MatchRecord;
  result: MatchResult;
  replay: ReplayData;
}

export class MatchRunner {
  private matchHistory: MatchRecord[] = [];
  private replays = new Map<string, ReplayData>();
  private ratingStore: RatingStore;

  constructor(ratingStore: RatingStore) {
    this.ratingStore = ratingStore;
  }

  /** Execute a server-authoritative match */
  runRankedMatch(request: MatchRequest): MatchResponse {
    const setup: MatchSetup = {
      config: request.config,
      participants: [
        {
          program: request.player1.program,
          constants: request.player1.constants,
          playerId: request.player1.playerId,
          teamId: 0,
        },
        {
          program: request.player2.program,
          constants: request.player2.constants,
          playerId: request.player2.playerId,
          teamId: 1,
        },
      ],
    };

    const result = runMatch(setup);
    const matchId = result.replay.metadata.matchId;

    // Update ratings
    if (request.config.mode === "1v1_ranked") {
      if (result.winner === 0) {
        this.ratingStore.recordResult(request.player1.playerId, request.player2.playerId, matchId);
      } else if (result.winner === 1) {
        this.ratingStore.recordResult(request.player2.playerId, request.player1.playerId, matchId);
      } else {
        this.ratingStore.recordDraw(request.player1.playerId, request.player2.playerId, matchId);
      }
    }

    // Create match record
    const record: MatchRecord = {
      matchId,
      config: request.config,
      participants: result.replay.metadata.participants.map((p, i) => ({
        ...p,
        eloAtStart: i === 0
          ? this.ratingStore.getOrCreate(request.player1.playerId).elo
          : this.ratingStore.getOrCreate(request.player2.playerId).elo,
      })),
      status: "completed",
      winner: result.winner,
      startedAt: Date.now(),
      endedAt: Date.now(),
      replayId: matchId,
      engineVersion: ENGINE_VERSION,
    };

    this.matchHistory.push(record);
    this.replays.set(matchId, result.replay);

    return { record, result, replay: result.replay };
  }

  /** Run an unranked match (no Elo changes) */
  runUnrankedMatch(request: MatchRequest): MatchResponse {
    const unrankedConfig = { ...request.config, mode: "1v1_unranked" as const };
    const setup: MatchSetup = {
      config: unrankedConfig,
      participants: [
        {
          program: request.player1.program,
          constants: request.player1.constants,
          playerId: request.player1.playerId,
          teamId: 0,
        },
        {
          program: request.player2.program,
          constants: request.player2.constants,
          playerId: request.player2.playerId,
          teamId: 1,
        },
      ],
    };

    const result = runMatch(setup);
    const matchId = result.replay.metadata.matchId;

    const record: MatchRecord = {
      matchId,
      config: unrankedConfig,
      participants: result.replay.metadata.participants,
      status: "completed",
      winner: result.winner,
      startedAt: Date.now(),
      endedAt: Date.now(),
      replayId: matchId,
      engineVersion: ENGINE_VERSION,
    };

    this.matchHistory.push(record);
    this.replays.set(matchId, result.replay);

    return { record, result, replay: result.replay };
  }

  getMatchHistory(limit = 50): MatchRecord[] {
    return this.matchHistory.slice(-limit);
  }

  getReplay(matchId: string): ReplayData | undefined {
    return this.replays.get(matchId);
  }

  getMatchCount(): number {
    return this.matchHistory.length;
  }
}
