// ============================================================================
// Action Gateway — Intent collection and validation
// ============================================================================

import type { ActionIntent, EntityId, RobotState } from "../shared/types.js";
import { CLASS_STATS, ATTACK_COOLDOWN } from "../shared/config.js";

export interface ValidatedAction {
  intent: ActionIntent;
  valid: boolean;
  reason?: string;
}

/** Validate and collect action intents from a robot */
export function validateAction(intent: ActionIntent, robot: RobotState): ValidatedAction {
  if (!robot.alive) {
    return { intent, valid: false, reason: "Robot is destroyed" };
  }

  switch (intent.type) {
    case "attack":
    case "fire_at": {
      const cd = robot.cooldowns.get("attack") ?? 0;
      if (cd > 0) {
        return { intent, valid: false, reason: `Attack on cooldown (${cd} ticks remaining)` };
      }
      const stats = CLASS_STATS[robot.class];
      if (stats && robot.energy < (stats.attackDamage ?? 10)) {
        return { intent, valid: false, reason: "Insufficient energy" };
      }
      return { intent, valid: true };
    }

    case "use_ability": {
      const abilityName = intent.ability ?? "unknown";
      const cd = robot.cooldowns.get(abilityName) ?? 0;
      if (cd > 0) {
        return { intent, valid: false, reason: `Ability '${abilityName}' on cooldown` };
      }
      return { intent, valid: true };
    }

    case "move_to":
    case "move_toward":
    case "strafe_left":
    case "strafe_right":
    case "stop":
    case "retreat":
    case "shield":
    case "mark_target":
    case "capture":
    case "ping":
      return { intent, valid: true };

    default:
      return { intent, valid: false, reason: `Unknown action type: ${intent.type}` };
  }
}

/** Separate movement and combat actions (per spec: one of each per tick) */
export function categorizeActions(actions: ActionIntent[]): {
  movement: ActionIntent | null;
  combat: ActionIntent | null;
  utility: ActionIntent[];
} {
  const movementTypes = new Set(["move_to", "move_toward", "strafe_left", "strafe_right", "stop", "retreat"]);
  const combatTypes = new Set(["attack", "fire_at", "use_ability", "shield"]);

  let movement: ActionIntent | null = null;
  let combat: ActionIntent | null = null;
  const utility: ActionIntent[] = [];

  for (const action of actions) {
    if (movementTypes.has(action.type) && !movement) {
      movement = action;
    } else if (combatTypes.has(action.type) && !combat) {
      combat = action;
    } else {
      utility.push(action);
    }
  }

  return { movement, combat, utility };
}
