// ============================================================================
// Combat Resolution — Attacks, damage, abilities, projectiles
// ============================================================================

import { distance, normalize, sub, scale, add, vec2 } from "../shared/vec2.js";
import { getVisibleEnemies, hasLineOfSight } from "./los.js";
import {
  CLASS_STATS, ATTACK_DAMAGE, ATTACK_RANGE, ATTACK_COOLDOWN, ATTACK_ENERGY_COST,
  FIRE_AT_DAMAGE, FIRE_AT_RANGE, FIRE_AT_COOLDOWN, PROJECTILE_SPEED, PROJECTILE_TTL,
  BURST_FIRE_DAMAGE, BURST_FIRE_RANGE, BURST_FIRE_COOLDOWN, BURST_FIRE_ENERGY_COST,
  GRENADE_DAMAGE, GRENADE_RADIUS, GRENADE_RANGE, GRENADE_COOLDOWN, GRENADE_ENERGY_COST,
  SHIELD_DURATION, SHIELD_COOLDOWN, SHIELD_ENERGY_COST, LOW_HEALTH_THRESHOLD,
  PICKUP_DAMAGE_MULTIPLIER,
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
      const visibleEnemyIds = new Set(getVisibleEnemies(world, robot).map(enemy => enemy.id));
      if (!visibleEnemyIds.has(target.id)) break;

      const range = stats?.attackRange ?? ATTACK_RANGE;
      if (distance(robot.position, target.position) > range) break;

      const cd = robot.cooldowns.get("attack") ?? 0;
      if (cd > 0) break;

      let damage = stats?.attackDamage ?? ATTACK_DAMAGE;
      const cooldown = stats?.attackCooldown ?? ATTACK_COOLDOWN;
      // Apply damage pickup effect
      if (robot.activeEffects?.some(e => e.type === "damage")) {
        damage = Math.round(damage * PICKUP_DAMAGE_MULTIPLIER);
      }

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
      if (!hasLineOfSight(world, robot.position, targetPos)) break;

      if (distance(robot.position, targetPos) > FIRE_AT_RANGE) break;

      const cd = robot.cooldowns.get("attack") ?? 0;
      if (cd > 0) break;

      const dir = normalize(sub(targetPos, robot.position));
      const vel = scale(dir, PROJECTILE_SPEED);
      let fireAtDmg = FIRE_AT_DAMAGE;
      if (robot.activeEffects?.some(e => e.type === "damage")) {
        fireAtDmg = Math.round(fireAtDmg * PICKUP_DAMAGE_MULTIPLIER);
      }
      world.spawnProjectile(robot.id, { ...robot.position }, vel, fireAtDmg, PROJECTILE_TTL);

      robot.cooldowns.set("attack", FIRE_AT_COOLDOWN);
      robot.energy = Math.max(0, robot.energy - ATTACK_ENERGY_COST);
      robot.heading = dir;
      break;
    }

    case "burst_fire": {
      const targetPos = resolveTargetPosition(world, action);
      if (!targetPos) break;
      if (!hasLineOfSight(world, robot.position, targetPos)) break;
      if (distance(robot.position, targetPos) > BURST_FIRE_RANGE) break;
      const cd = robot.cooldowns.get("attack") ?? 0;
      if (cd > 0) break;

      const baseDir = normalize(sub(targetPos, robot.position));
      let burstDmg = BURST_FIRE_DAMAGE;
      if (robot.activeEffects?.some(e => e.type === "damage")) {
        burstDmg = Math.round(burstDmg * PICKUP_DAMAGE_MULTIPLIER);
      }
      const spread = [0, -0.12, 0.12];
      for (const s of spread) {
        const dir = normalize({ x: baseDir.x - (baseDir.y * s), y: baseDir.y + (baseDir.x * s) });
        const vel = scale(dir, PROJECTILE_SPEED);
        world.spawnProjectile(robot.id, { ...robot.position }, vel, burstDmg, PROJECTILE_TTL);
      }
      robot.cooldowns.set("attack", BURST_FIRE_COOLDOWN);
      robot.energy = Math.max(0, robot.energy - BURST_FIRE_ENERGY_COST);
      robot.heading = baseDir;
      break;
    }

    case "grenade": {
      const targetPos = resolveTargetPosition(world, action);
      if (!targetPos) break;
      if (distance(robot.position, targetPos) > GRENADE_RANGE) break;
      const cd = robot.cooldowns.get("attack") ?? 0;
      if (cd > 0) break;
      let grenadeDmg = GRENADE_DAMAGE;
      if (robot.activeEffects?.some(e => e.type === "damage")) {
        grenadeDmg = Math.round(grenadeDmg * PICKUP_DAMAGE_MULTIPLIER);
      }
      for (const other of world.getAliveRobots()) {
        if (other.teamId === robot.teamId) continue;
        if (distance(other.position, targetPos) <= GRENADE_RADIUS) {
          applyDamage(world, other, grenadeDmg, robot.id);
        }
      }
      // Damage destructible cover in blast radius
      const coversToRemove = [];
      for (const [coverId, cover] of world.covers) {
        if (!cover.destructible) continue;
        if (distance(cover.position, targetPos) <= GRENADE_RADIUS) {
          cover.health -= GRENADE_DAMAGE;
          if (cover.health <= 0) {
            coversToRemove.push(coverId);
          }
        }
      }
      for (const id of coversToRemove) {
        world.covers.delete(id);
      }
      robot.cooldowns.set("attack", GRENADE_COOLDOWN);
      robot.energy = Math.max(0, robot.energy - GRENADE_ENERGY_COST);
      robot.heading = normalize(sub(targetPos, robot.position));
      break;
    }

    case "shield": {
      const cd = robot.cooldowns.get("shield") ?? 0;
      if (cd > 0) break;
      // Apply shield as a health restore capped at maxHealth (roughly 20% of base)
      const shieldHeal = Math.round(robot.maxHealth * 0.2);
      robot.health = Math.min(robot.maxHealth, robot.health + shieldHeal);
      robot.cooldowns.set("shield", SHIELD_COOLDOWN);
      robot.energy = Math.max(0, robot.energy - SHIELD_ENERGY_COST);
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

  const healthBefore = target.health + damage;
  if (target.health <= LOW_HEALTH_THRESHOLD && target.health > 0 && healthBefore > LOW_HEALTH_THRESHOLD) {
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

    // Check collision with cover (projectiles blocked by walls)
    let hitCover = false;
    for (const cover of world.covers.values()) {
      const halfW = cover.width / 2;
      const halfH = cover.height / 2;
      if (proj.position.x >= cover.position.x - halfW && proj.position.x <= cover.position.x + halfW &&
          proj.position.y >= cover.position.y - halfH && proj.position.y <= cover.position.y + halfH) {
        hitCover = true;
        break;
      }
    }
    if (hitCover) {
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
  if (typeof action.target === "object" && "x" in action.target && "y" in action.target) {
    return action.target;
  }
  // Sensor objects often include { id, position, ... }
  if (typeof action.target === "object" && "position" in action.target &&
      action.target.position && "x" in action.target.position && "y" in action.target.position) {
    return action.target.position;
  }
  if (typeof action.target === "string") {
    const robot = world.getRobot(action.target);
    if (robot) return robot.position;
  }
  return null;
}
