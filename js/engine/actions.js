// ============================================================================
// Action Gateway — Intent collection and validation
// ============================================================================

import {
  CLASS_STATS, ATTACK_COOLDOWN, ATTACK_ENERGY_COST,
  BURST_FIRE_ENERGY_COST, GRENADE_ENERGY_COST, SHIELD_ENERGY_COST,
} from "../shared/config.js";

export function normalizeActionIntent(intent) {
  if (!intent || typeof intent !== "object") return intent;
  return { ...intent };
}

/** Validate and collect action intents from a robot */
export function validateAction(intent, robot) {
  const normalized = normalizeActionIntent(intent);

  if (!robot.alive) {
    return { intent: normalized, valid: false, reason: "Robot is destroyed" };
  }

  switch (normalized.type) {
    case "attack":
    case "fire_at":
    case "burst_fire":
    case "grenade": {
      const cd = robot.cooldowns.get("attack") ?? 0;
      if (cd > 0) {
        return { intent: normalized, valid: false, reason: `Attack on cooldown (${cd} ticks remaining)` };
      }
      const energyCosts = { attack: ATTACK_ENERGY_COST, fire_at: ATTACK_ENERGY_COST, burst_fire: BURST_FIRE_ENERGY_COST, grenade: GRENADE_ENERGY_COST };
      const requiredEnergy = energyCosts[normalized.type] ?? ATTACK_ENERGY_COST;
      if (robot.energy < requiredEnergy) {
        return { intent: normalized, valid: false, reason: "Insufficient energy" };
      }
      return { intent: normalized, valid: true };
    }

    case "shield": {
      const cd = robot.cooldowns.get("shield") ?? 0;
      if (cd > 0) {
        return { intent: normalized, valid: false, reason: `Shield on cooldown (${cd} ticks remaining)` };
      }
      if (robot.energy < SHIELD_ENERGY_COST) {
        return { intent: normalized, valid: false, reason: "Insufficient energy for shield" };
      }
      return { intent: normalized, valid: true };
    }

    case "use_ability": {
      const abilityName = normalized.ability ?? "unknown";
      const cd = robot.cooldowns.get(abilityName) ?? 0;
      if (cd > 0) {
        return { intent: normalized, valid: false, reason: `Ability '${abilityName}' on cooldown` };
      }
      return { intent: normalized, valid: true };
    }

    case "move_to":
    case "move_toward":
    case "move_forward":
    case "move_backward":
    case "turn_left":
    case "turn_right":
    case "strafe_left":
    case "strafe_right":
    case "stop":
    case "retreat":
    case "mark_target":
    case "capture":
    case "ping":
      return { intent: normalized, valid: true };

    default:
      return { intent: normalized, valid: false, reason: `Unknown action type: ${normalized.type}` };
  }
}

/** Separate movement and combat actions (per spec: one of each per tick) */
export function categorizeActions(actions) {
  const movementTypes = new Set([
    "move_to", "move_toward", "move_forward", "move_backward",
    "turn_left", "turn_right", "strafe_left", "strafe_right", "stop", "retreat",
  ]);
  const combatTypes = new Set(["attack", "fire_at", "burst_fire", "grenade", "use_ability", "shield"]);

  let movement = null;
  let combat = null;
  const utility = [];

  for (const rawAction of actions) {
    const action = normalizeActionIntent(rawAction);
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
