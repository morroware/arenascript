// ============================================================================
// Matchmaking — Elo-based queue pairing
// ============================================================================

import type { CompiledProgram, MatchConfig, MatchMode } from "../shared/types.js";
import type { ConstPoolEntry } from "../runtime/opcodes.js";
import { RatingStore } from "./ranked.js";

export interface QueueEntry {
  playerId: string;
  program: CompiledProgram;
  constants: ConstPoolEntry[];
  elo: number;
  enqueuedAt: number;
  mode: MatchMode;
}

export interface MatchPairing {
  player1: QueueEntry;
  player2: QueueEntry;
  config: MatchConfig;
}

const ELO_RANGE_BASE = 100;
const ELO_RANGE_EXPANSION_PER_SEC = 10;
const MAX_ELO_RANGE = 500;

export class MatchmakingQueue {
  private queue: QueueEntry[] = [];
  private ratingStore: RatingStore;

  constructor(ratingStore: RatingStore) {
    this.ratingStore = ratingStore;
  }

  /** Add a player to the matchmaking queue */
  enqueue(playerId: string, program: CompiledProgram, constants: ConstPoolEntry[], mode: MatchMode = "1v1_ranked"): void {
    // Remove any existing entry for this player
    this.queue = this.queue.filter(e => e.playerId !== playerId);

    const rating = this.ratingStore.getOrCreate(playerId);
    this.queue.push({
      playerId,
      program,
      constants,
      elo: rating.elo,
      enqueuedAt: Date.now(),
      mode,
    });
  }

  /** Remove a player from the queue */
  dequeue(playerId: string): void {
    this.queue = this.queue.filter(e => e.playerId !== playerId);
  }

  /** Try to find a valid match pairing */
  tryMatch(): MatchPairing | null {
    if (this.queue.length < 2) return null;

    const now = Date.now();

    // Sort by queue time (FIFO priority)
    this.queue.sort((a, b) => a.enqueuedAt - b.enqueuedAt);

    for (let i = 0; i < this.queue.length; i++) {
      const p1 = this.queue[i];
      const waitTime = (now - p1.enqueuedAt) / 1000;
      const eloRange = Math.min(
        ELO_RANGE_BASE + waitTime * ELO_RANGE_EXPANSION_PER_SEC,
        MAX_ELO_RANGE,
      );

      for (let j = i + 1; j < this.queue.length; j++) {
        const p2 = this.queue[j];
        if (p1.mode !== p2.mode) continue;

        const eloDiff = Math.abs(p1.elo - p2.elo);
        if (eloDiff <= eloRange) {
          // Match found — remove both from queue
          this.queue.splice(j, 1);
          this.queue.splice(i, 1);

          return {
            player1: p1,
            player2: p2,
            config: {
              mode: p1.mode,
              arenaWidth: 100,
              arenaHeight: 100,
              maxTicks: 3000,
              tickRate: 30,
              seed: Math.floor(Math.random() * 2147483647),
            },
          };
        }
      }
    }

    return null;
  }

  getQueueSize(): number {
    return this.queue.length;
  }

  getQueuedPlayers(): string[] {
    return this.queue.map(e => e.playerId);
  }
}
