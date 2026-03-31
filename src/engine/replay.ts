// ============================================================================
// Replay System — Deterministic match recording and playback
// ============================================================================

import type {
  ReplayData, ReplayFrame, MatchParticipant, GameEvent, ActionIntent,
} from "../shared/types.js";
import type { World } from "./world.js";
import { ENGINE_VERSION } from "../shared/config.js";

export class ReplayWriter {
  private frames: ReplayFrame[] = [];
  private matchId: string;
  private seed: number;
  private participants: MatchParticipant[];

  constructor(matchId: string, seed: number, participants: MatchParticipant[]) {
    this.matchId = matchId;
    this.seed = seed;
    this.participants = participants;
  }

  /** Capture the current world state as a replay frame */
  captureFrame(world: World, events: GameEvent[], actions: Map<string, ActionIntent>): void {
    const robots = [...world.robots.values()].map(r => ({
      id: r.id,
      position: { x: r.position.x, y: r.position.y },
      health: r.health,
      energy: r.energy,
      action: actions.get(r.id),
    }));

    const projectiles = [...world.projectiles.values()].map(p => ({
      id: p.id,
      position: { x: p.position.x, y: p.position.y },
    }));

    this.frames.push({
      tick: world.currentTick,
      robots,
      projectiles,
      events: [...events],
    });
  }

  /** Finalize and return the complete replay data */
  finalize(): ReplayData {
    return {
      metadata: {
        matchId: this.matchId,
        engineVersion: ENGINE_VERSION,
        seed: this.seed,
        tickCount: this.frames.length,
        participants: this.participants,
      },
      frames: this.frames,
    };
  }
}

/** Validate replay integrity — same seed + programs should produce identical frames */
export function validateReplayDeterminism(replay1: ReplayData, replay2: ReplayData): boolean {
  if (replay1.frames.length !== replay2.frames.length) return false;

  for (let i = 0; i < replay1.frames.length; i++) {
    const f1 = replay1.frames[i];
    const f2 = replay2.frames[i];

    if (f1.tick !== f2.tick) return false;
    if (f1.robots.length !== f2.robots.length) return false;

    for (let j = 0; j < f1.robots.length; j++) {
      const r1 = f1.robots[j];
      const r2 = f2.robots[j];
      if (r1.id !== r2.id) return false;
      if (Math.abs(r1.position.x - r2.position.x) > 0.001) return false;
      if (Math.abs(r1.position.y - r2.position.y) > 0.001) return false;
      if (r1.health !== r2.health) return false;
    }
  }

  return true;
}
