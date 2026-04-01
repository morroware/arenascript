// ============================================================================
// Replay System — Deterministic match recording and playback
// ============================================================================

import { ENGINE_VERSION } from "../shared/config.js";

export class ReplayWriter {
  #frames = [];
  #matchId;
  #seed;
  #participants;
  #arenaLayout = null;

  constructor(matchId, seed, participants) {
    this.#matchId = matchId;
    this.#seed = seed;
    this.#participants = participants;
  }

  /** Capture the current world state as a replay frame */
  captureFrame(world, events, actions, decisionTraces) {
    const robots = [...world.robots.values()].map(r => ({
      id: r.id,
      teamId: r.teamId,
      robotClass: r.class,
      position: { x: r.position.x, y: r.position.y },
      health: r.health,
      energy: r.energy,
      action: actions.get(r.id),
    }));

    const projectiles = [...world.projectiles.values()].map(p => ({
      id: p.id,
      position: { x: p.position.x, y: p.position.y },
    }));

    const mines = [...world.mines.values()].map(m => ({
      id: m.id, teamId: m.teamId,
      position: { x: m.position.x, y: m.position.y },
    }));

    const pickups = [...world.pickups.values()].filter(p => !p.collected).map(p => ({
      id: p.id, type: p.type,
      position: { x: p.position.x, y: p.position.y },
    }));

    // Track live cover state (for destructible cover changes)
    const covers = [...world.covers.values()].map(c => ({
      id: c.id, x: c.position.x, y: c.position.y,
      w: c.width, h: c.height,
      destructible: c.destructible, health: c.health,
    }));

    const frame = {
      tick: world.currentTick,
      robots,
      projectiles,
      mines,
      pickups,
      covers,
      events: [...events],
    };

    if (decisionTraces) {
      frame.traces = [...decisionTraces.entries()].map(([robotId, trace]) => ({
        robotId,
        event: trace.event,
        action: trace.action,
        budgetUsed: trace.budgetUsed,
      }));
    }

    this.#frames.push(frame);
  }

  /** Store arena layout for rendering */
  captureArenaLayout(world) {
    this.#arenaLayout = {
      covers: [...world.covers.values()].map(c => ({
        x: c.position.x, y: c.position.y, w: c.width, h: c.height,
        destructible: c.destructible ?? false,
      })),
      controlPoints: [...world.controlPoints.values()].map(cp => ({
        x: cp.position.x, y: cp.position.y, radius: cp.radius,
      })),
      healingZones: [...world.healingZones.values()].map(hz => ({
        x: hz.position.x, y: hz.position.y, radius: hz.radius,
      })),
      hazards: [...world.hazards.values()].map(h => ({
        x: h.position.x, y: h.position.y, radius: h.radius,
      })),
    };
  }

  /** Finalize and return the complete replay data */
  finalize() {
    return {
      metadata: {
        matchId: this.#matchId,
        engineVersion: ENGINE_VERSION,
        seed: this.#seed,
        tickCount: this.#frames.length,
        participants: this.#participants,
        arenaLayout: this.#arenaLayout ?? null,
      },
      frames: this.#frames,
    };
  }
}

/** Scan replay frames and return bookmark indices for key match events */
export function computeBookmarks(frames) {
  const bookmarks = {
    firstDamage: null,
    firstKill: null,
    captureStart: null,
    captureEnd: null,
    lowHealthMoments: [],
  };

  // Track previous health per robot and whether low-health was already recorded
  const prevHealth = new Map();
  const lowHealthSeen = new Set();

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];

    // Check robots for damage, kills, and low-health moments
    for (const robot of frame.robots) {
      const prev = prevHealth.get(robot.id);

      if (prev !== undefined && robot.health < prev) {
        // Damage detected
        if (bookmarks.firstDamage === null) {
          bookmarks.firstDamage = i;
        }
        // Kill detected
        if (robot.health <= 0 && bookmarks.firstKill === null) {
          bookmarks.firstKill = i;
        }
      }

      // Low health moment (first time this robot drops below 25 HP)
      if (robot.health > 0 && robot.health < 25 && !lowHealthSeen.has(robot.id)) {
        lowHealthSeen.add(robot.id);
        bookmarks.lowHealthMoments.push({ frameIndex: i, robotId: robot.id });
      }

      prevHealth.set(robot.id, robot.health);
    }

    // Check events for capture-related entries
    const hasCaptureEvent = frame.events && frame.events.some(
      e => typeof e === "string" ? e.toLowerCase().includes("capture")
        : e && typeof e.type === "string" && e.type.toLowerCase().includes("capture")
    );

    if (hasCaptureEvent) {
      if (bookmarks.captureStart === null) {
        bookmarks.captureStart = i;
      }
      bookmarks.captureEnd = i;
    }
  }

  return bookmarks;
}

/** Validate replay integrity — same seed + programs should produce identical frames */
export function validateReplayDeterminism(replay1, replay2) {
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
