// ============================================================================
// Event System — Generation and dispatch to robot VMs
// ============================================================================

import type { GameEvent, GameEventType, EntityId, RobotState } from "../shared/types.js";
import type { World } from "./world.js";
import { getVisibleEnemies } from "./los.js";

/** Track per-robot visibility state for enemy_seen / enemy_lost events */
export class VisibilityTracker {
  // robotId -> set of visible enemy IDs from last tick
  private previousVisibility = new Map<EntityId, Set<EntityId>>();

  /** Update visibility and generate enemy_seen / enemy_lost events */
  update(world: World): void {
    for (const robot of world.robots.values()) {
      if (!robot.alive) continue;

      const currentlyVisible = new Set(
        getVisibleEnemies(world, robot).map(e => e.id),
      );

      const previousSet = this.previousVisibility.get(robot.id) ?? new Set();

      // enemy_seen: now visible, wasn't before
      for (const enemyId of currentlyVisible) {
        if (!previousSet.has(enemyId)) {
          world.emitEvent({
            type: "enemy_seen",
            tick: world.currentTick,
            robotId: robot.id,
            data: { enemyId },
          });
        }
      }

      // enemy_lost: was visible, no longer
      for (const enemyId of previousSet) {
        if (!currentlyVisible.has(enemyId)) {
          world.emitEvent({
            type: "enemy_lost",
            tick: world.currentTick,
            robotId: robot.id,
            data: { enemyId },
          });
        }
      }

      this.previousVisibility.set(robot.id, currentlyVisible);
    }
  }

  reset(): void {
    this.previousVisibility.clear();
  }
}

/** Check cooldown_ready events */
export function checkCooldownReady(world: World): void {
  for (const robot of world.robots.values()) {
    if (!robot.alive) continue;
    for (const [action, ticks] of robot.cooldowns) {
      if (ticks === 0) {
        world.emitEvent({
          type: "cooldown_ready",
          tick: world.currentTick,
          robotId: robot.id,
          data: { action },
        });
        // Remove the cooldown entry after emitting
        robot.cooldowns.delete(action);
      }
    }
  }
}
