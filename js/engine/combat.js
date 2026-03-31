// ============================================================================
// Combat Resolution — Attacks, damage, abilities, projectiles
// ============================================================================

import { distance, normalize, sub, scale, add, vec2 } from "../shared/vec2.js";
import {
  CLASS_STATS, ATTACK_DAMAGE, ATTACK_RANGE, ATTACK_COOLDOWN, ATTACK_ENERGY_COST,
  FIRE_AT_DAMAGE, FIRE_AT_RANGE, FIRE_AT_COOLDOWN, PROJECTILE_SPEED, PROJECTILE_TTL,
  SHIELD_DURATION, SHIELD_COOLDOWN, LOW_HEALTH_THRESHOLD,
} from "../shared/config.js";

/** Resolve a combat action for a robot */
export function resolveCombat(world, robot, action) {
  if (!action || !robot.alive) return;

  const stats = CLASS_STATS[robot.class];

  switch (action.type) {
    case "attack": {
      const targetId = resolveTargetId(world, action);
      if (!targetId) break;
      const target = world.getRobot(targetId);
      if (!target || !target.alive) break;

      const range = stats?.attackRange ?? ATTACK_RANGE;
      if (distance(robot.position, target.position) > range) break;

      const cd = robot.cooldowns.get("attack") ?? 0;
      if (cd > 0) break;

      const damage = stats?.attackDamage ?? ATTACK_DAMAGE;
      const cooldown = stats?.attackCooldown ?? ATTACK_COOLDOWN;

      applyDamage(world, target, damage, robot.id);
      robot.cooldowns.set("attack", cooldown);
      robot.energy = Math.max(0, robot.energy - ATTACK_ENERGY_COST);

      // Face the target
      const dir = normalize(sub(target.position, robot.position));
      robot.heading = dir;
      break;
    }

    case "fire_at": {
      const targetPos = resolveTargetPosition(world, action);
      if (!targetPos) break;

      if (distance(robot.position, targetPos) > FIRE_AT_RANGE) break;

      const cd = robot.cooldowns.get("attack") ?? 0;
      if (cd > 0) break;

      const dir = normalize(sub(targetPos, robot.position));
      const vel = scale(dir, PROJECTILE_SPEED);
      world.spawnProjectile(robot.id, { ...robot.position }, vel, FIRE_AT_DAMAGE, PROJECTILE_TTL);

      robot.cooldowns.set("attack", FIRE_AT_COOLDOWN);
      robot.heading = dir;
      break;
    }

    case "shield": {
      const cd = robot.cooldowns.get("shield") ?? 0;
      if (cd > 0) break;
      // Apply shield as a temporary health buffer (simplified for PoC)
      robot.health = Math.min(robot.maxHealth + 20, robot.health + 20);
      robot.cooldowns.set("shield", SHIELD_COOLDOWN);
      break;
    }

    case "use_ability": {
      // Simplified ability system for PoC
      break;
    }
  }
}

/** Apply damage to a robot, emit events */
export function applyDamage(world, target, damage, sourceId) {
  target.health -= damage;

  world.emitEvent({
    type: "damaged",
    tick: world.currentTick,
    robotId: target.id,
    data: { damage, sourceId },
  });

  if (target.health <= LOW_HEALTH_THRESHOLD && target.health > 0) {
    world.emitEvent({
      type: "low_health",
      tick: world.currentTick,
      robotId: target.id,
      data: { health: target.health },
    });
  }

  if (target.health <= 0) {
    target.health = 0;
    target.alive = false;
    world.emitEvent({
      type: "destroyed",
      tick: world.currentTick,
      robotId: target.id,
      data: { killedBy: sourceId },
    });
  }
}

/** Update projectiles — move and check collisions */
export function updateProjectiles(world) {
  const toRemove = [];

  for (const [id, proj] of world.projectiles) {
    // Move projectile
    proj.position = add(proj.position, proj.velocity);
    proj.ttl--;

    // Check out of bounds
    if (
      proj.position.x < 0 || proj.position.x > world.config.arenaWidth ||
      proj.position.y < 0 || proj.position.y > world.config.arenaHeight ||
      proj.ttl <= 0
    ) {
      toRemove.push(id);
      continue;
    }

    // Check collision with robots
    for (const robot of world.robots.values()) {
      if (!robot.alive) continue;
      if (robot.id === proj.ownerId) continue;
      // Same team? Skip friendly fire
      const owner = world.getRobot(proj.ownerId);
      if (owner && owner.teamId === robot.teamId) continue;

      if (distance(proj.position, robot.position) < 1.5) {
        applyDamage(world, robot, proj.damage, proj.ownerId);
        toRemove.push(id);
        break;
      }
    }
  }

  for (const id of toRemove) {
    world.projectiles.delete(id);
  }
}

/** Update cooldowns for all robots */
export function updateCooldowns(world) {
  for (const robot of world.robots.values()) {
    if (!robot.alive) continue;
    for (const [action, ticks] of robot.cooldowns) {
      if (ticks > 0) {
        robot.cooldowns.set(action, ticks - 1);
      }
    }
    // Regenerate energy slightly
    robot.energy = Math.min(robot.maxEnergy, robot.energy + 1);
  }
}

// --- Helpers ---

function resolveTargetId(world, action) {
  if (!action.target) return null;
  if (typeof action.target === "string") return action.target;
  // If target is a position-like object with id
  if (typeof action.target === "object" && "id" in action.target) {
    return action.target.id;
  }
  return null;
}

function resolveTargetPosition(world, action) {
  if (!action.target) return null;
  if (typeof action.target === "object" && "x" in action.target) {
    return action.target;
  }
  if (typeof action.target === "string") {
    const robot = world.getRobot(action.target);
    if (robot) return robot.position;
  }
  return null;
}
