// ============================================================================
// Sensor Gateway — Read-only perception layer for robots
// ============================================================================

import { getVisibleEnemies, getVisibleAllies, hasLineOfSight } from "./los.js";
import { distance } from "../shared/vec2.js";
import {
  ACTIVE_SCAN_MEMORY_TICKS,
  ACTIVE_SCAN_RANGE,
  ATTACK_RANGE,
  CLASS_STATS,
  DEFAULT_VISION_RANGE,
  MINE_VISIBLE_RANGE,
  NOISE_DECAY_TICKS,
  CLOAK_BREAK_DISTANCE,
  HEAT_MAX,
  HEAT_RECOVERY_THRESHOLD,
} from "../shared/config.js";

/** Convert a RobotState to a safe VM-visible object */
function robotToSensorView(robot) {
  return {
    id: robot.id,
    position: { x: robot.position.x, y: robot.position.y },
    health: robot.health,
    heading: { x: robot.heading.x, y: robot.heading.y },
  };
}

/** Create the sensor gateway for a given world */
export function createSensorGateway(world) {
  const mapRobotView = (targetRobot) => robotToSensorView(targetRobot);
  const scanEnemies = (robot, range) => {
    const detected = [];
    for (const other of world.robots.values()) {
      if (!other.alive) continue;
      if (other.teamId === robot.teamId) continue;
      const d = distance(robot.position, other.position);
      if (d > range) continue;
      // Cloaked enemies don't show up on scan beyond point-blank range
      if (other.cloakActive && d > CLOAK_BREAK_DISTANCE) continue;
      // Scan still requires line of sight (no wallhack)
      if (!hasLineOfSight(world, robot.position, other.position)) continue;
      detected.push(other);
    }
    detected.sort((a, b) => distance(robot.position, a.position) - distance(robot.position, b.position));
    if (detected.length > 0) {
      const nearest = detected[0];
      robot.memory.lastSeenEnemy = {
        id: nearest.id,
        position: { x: nearest.position.x, y: nearest.position.y },
        tick: world.currentTick,
      };
    }
    return detected.map(mapRobotView);
  };

  return (robotId, sensorName, args) => {
    const robot = world.getRobot(robotId);
    if (!robot || !robot.alive) return null;

    switch (sensorName) {
      case "enemy_visible":
        return getVisibleEnemies(world, robot).length > 0;

      case "random": {
        const min = Number(args[0] ?? 0);
        const max = Number(args[1] ?? 100);
        const low = Math.min(min, max);
        const high = Math.max(min, max);
        return Math.floor(world.rng.nextFloat(low, high + 1));
      }

      case "damage_percent":
        return Math.round(((robot.maxHealth - robot.health) / robot.maxHealth) * 100);

      case "wall_ahead": {
        const lookahead = Math.max(0, Number(args[0] ?? 3));
        const p = {
          x: robot.position.x + (robot.heading.x * lookahead),
          y: robot.position.y + (robot.heading.y * lookahead),
        };
        if (p.x <= 0 || p.x >= world.config.arenaWidth || p.y <= 0 || p.y >= world.config.arenaHeight) {
          return true;
        }
        for (const cover of world.covers.values()) {
          const halfW = cover.width / 2;
          const halfH = cover.height / 2;
          const inX = p.x >= cover.position.x - halfW && p.x <= cover.position.x + halfW;
          const inY = p.y >= cover.position.y - halfH && p.y <= cover.position.y + halfH;
          if (inX && inY) return true;
        }
        return false;
      }

      // --- Self Sensors ---
      case "health":
        return robot.health;

      case "max_health":
        return robot.maxHealth;

      case "energy":
        return robot.energy;

      // --- Resource Economy ---
      case "heat":
        return Math.round(robot.heat ?? 0);
      case "max_heat":
        return HEAT_MAX;
      case "heat_percent":
        return Math.round(((robot.heat ?? 0) / HEAT_MAX) * 100);
      case "overheated":
        return !!robot.overheated;
      case "ammo":
        return robot.ammo ?? 0;
      case "max_ammo":
        return robot.maxAmmo ?? 0;
      case "ammo_percent":
        return (robot.maxAmmo ?? 0) === 0 ? 0 : Math.round(((robot.ammo ?? 0) / robot.maxAmmo) * 100);

      // --- Cloak state ---
      case "is_cloaked":
        return !!robot.cloakActive;
      case "cloak_remaining":
        return robot.cloakActive ? Math.max(0, robot.cloakExpiresTick - world.currentTick) : 0;

      // --- Self-destruct countdown ---
      case "self_destruct_armed":
        return (robot.selfDestructTick ?? 0) > 0;
      case "self_destruct_remaining":
        return (robot.selfDestructTick ?? 0) > 0
          ? Math.max(0, robot.selfDestructTick - world.currentTick)
          : 0;

      // --- Resupply Depot ---
      case "nearest_depot": {
        let nearestDist = Infinity;
        let nearest = null;
        for (const depot of world.depots.values()) {
          const d = distance(robot.position, depot.position);
          if (d < nearestDist) {
            nearestDist = d;
            nearest = {
              id: depot.id,
              position: { x: depot.position.x, y: depot.position.y },
              radius: depot.radius,
              distance: Math.round(d),
            };
          }
        }
        return nearest;
      }
      case "is_on_depot": {
        for (const depot of world.depots.values()) {
          if (distance(robot.position, depot.position) <= depot.radius) return true;
        }
        return false;
      }

      // --- Hive (shared team memory) ---
      case "hive_get": {
        const key = args[0];
        if (typeof key !== "string") return null;
        return world.hiveGet(robot.teamId, key);
      }
      case "hive_set": {
        const key = args[0];
        if (typeof key !== "string") return null;
        const value = args[1] ?? null;
        world.hiveSet(robot.teamId, key, value);
        return value;
      }
      case "hive_has": {
        const key = args[0];
        if (typeof key !== "string") return false;
        return world.hiveGet(robot.teamId, key) !== null;
      }

      case "position":
        return { x: robot.position.x, y: robot.position.y };

      case "velocity":
        return { x: robot.velocity.x, y: robot.velocity.y };

      case "heading":
        return { x: robot.heading.x, y: robot.heading.y };

      case "cooldown": {
        const actionName = args[0];
        return robot.cooldowns.get(actionName) ?? 0;
      }

      // --- Enemy Sensors ---
      case "nearest_enemy": {
        const visible = getVisibleEnemies(world, robot);
        if (visible.length === 0) return null;
        return mapRobotView(visible[0]);
      }

      case "visible_enemies": {
        const visible = getVisibleEnemies(world, robot);
        return visible.map(robotToSensorView);
      }

      case "enemy_count_in_range": {
        const range = args[0] ?? ATTACK_RANGE;
        const visible = getVisibleEnemies(world, robot);
        return visible.filter(e => distance(robot.position, e.position) <= range).length;
      }

      // --- Ally Sensors ---
      case "nearest_ally": {
        const allies = getVisibleAllies(world, robot);
        if (allies.length === 0) return null;
        return mapRobotView(allies[0]);
      }

      case "visible_allies": {
        const allies = getVisibleAllies(world, robot);
        return allies.map(robotToSensorView);
      }

      // --- Arena Sensors (discovery-based: only returns features the robot has seen) ---
      case "nearest_cover": {
        let nearestDist = Infinity;
        let nearest = null;
        // Only search discovered covers
        for (const cover of robot.memory.discoveredCovers.values()) {
          const d = distance(robot.position, cover.position);
          if (d < nearestDist) {
            nearestDist = d;
            nearest = { x: cover.position.x, y: cover.position.y };
          }
        }
        return nearest;
      }

      case "nearest_resource": {
        let nearestDist = Infinity;
        let nearest = null;
        // Only search within vision range (consistent with other discovery-based sensors)
        const visionRange = CLASS_STATS[robot.class]?.visionRange ?? DEFAULT_VISION_RANGE;
        for (const res of world.resources.values()) {
          const d = distance(robot.position, res.position);
          if (d > visionRange) continue;
          if (d < nearestDist) {
            nearestDist = d;
            nearest = { id: res.id, position: { x: res.position.x, y: res.position.y }, amount: res.amount };
          }
        }
        return nearest;
      }

      case "nearest_control_point": {
        let nearestDist = Infinity;
        let nearest = null;
        // Only search discovered control points; update owner from live data if still visible
        for (const mem of robot.memory.discoveredControlPoints.values()) {
          const liveCp = world.controlPoints.get(mem.id);
          const owner = liveCp ? liveCp.owner : mem.owner;
          const d = distance(robot.position, mem.position);
          if (d < nearestDist) {
            nearestDist = d;
            nearest = { id: mem.id, position: { x: mem.position.x, y: mem.position.y }, owner };
          }
        }
        return nearest;
      }

      case "nearest_enemy_control_point": {
        let nearestDist = Infinity;
        let nearest = null;
        for (const mem of robot.memory.discoveredControlPoints.values()) {
          const liveCp = world.controlPoints.get(mem.id);
          const owner = liveCp ? liveCp.owner : mem.owner;
          if (owner === robot.teamId) continue;
          const d = distance(robot.position, mem.position);
          if (d < nearestDist) {
            nearestDist = d;
            nearest = { id: mem.id, position: { x: mem.position.x, y: mem.position.y }, owner };
          }
        }
        return nearest;
      }

      case "nearest_heal_zone": {
        let nearestDist = Infinity;
        let nearest = null;
        // Only search discovered healing zones
        for (const zone of robot.memory.discoveredHealZones.values()) {
          const d = distance(robot.position, zone.position);
          if (d < nearestDist) {
            nearestDist = d;
            nearest = { id: zone.id, position: { x: zone.position.x, y: zone.position.y }, radius: zone.radius };
          }
        }
        return nearest;
      }

      case "nearest_hazard": {
        let nearestDist = Infinity;
        let nearest = null;
        for (const hazard of robot.memory.discoveredHazards.values()) {
          const d = distance(robot.position, hazard.position);
          if (d < nearestDist) {
            nearestDist = d;
            nearest = { id: hazard.id, position: { x: hazard.position.x, y: hazard.position.y }, radius: hazard.radius };
          }
        }
        return nearest;
      }

      // --- Proprioceptive Arena Sensors (always work, no discovery needed) ---
      case "is_in_heal_zone": {
        for (const zone of world.healingZones.values()) {
          if (distance(robot.position, zone.position) <= zone.radius) return true;
        }
        return false;
      }

      case "is_in_hazard": {
        for (const hazard of world.hazards.values()) {
          if (distance(robot.position, hazard.position) <= hazard.radius) return true;
        }
        return false;
      }

      case "arena_width":
        return world.config.arenaWidth;

      case "arena_height":
        return world.config.arenaHeight;

      case "spawn_position":
        return { x: robot.memory.spawnPosition.x, y: robot.memory.spawnPosition.y };

      case "discovered_count": {
        const category = args[0] ?? "all";
        if (category === "cover") return robot.memory.discoveredCovers.size;
        if (category === "heal") return robot.memory.discoveredHealZones.size;
        if (category === "hazard") return robot.memory.discoveredHazards.size;
        if (category === "control") return robot.memory.discoveredControlPoints.size;
        return robot.memory.discoveredCovers.size +
               robot.memory.discoveredHealZones.size +
               robot.memory.discoveredHazards.size +
               robot.memory.discoveredControlPoints.size;
      }

      case "distance_to": {
        const target = args[0];
        if (!target) return 999;
        if ("x" in target && "y" in target) {
          return distance(robot.position, target);
        }
        if ("position" in target) {
          return distance(robot.position, target.position);
        }
        // It might be an entity ID
        if (typeof target === "string") {
          const other = world.getRobot(target);
          if (other) return distance(robot.position, other.position);
        }
        return Infinity;
      }

      case "line_of_sight": {
        const target = args[0];
        if (!target) return false;
        let targetPos;
        if ("x" in target && "y" in target) {
          targetPos = target;
        } else if ("position" in target) {
          targetPos = target.position;
        } else {
          return false;
        }
        return hasLineOfSight(world, robot.position, targetPos);
      }

      case "current_tick":
        return world.currentTick;
      case "team_size":
        return world.getAliveRobotsByTeam(robot.teamId).length;
      case "my_index":
        return robot.squadIndex ?? 0;
      case "my_role":
        return robot.squadRole ?? "";

      case "scan": {
        const range = Math.max(0, Math.min(args[0] ?? ACTIVE_SCAN_RANGE, ACTIVE_SCAN_RANGE));
        const detected = scanEnemies(robot, range);
        return detected[0] ?? null;
      }

      case "scan_enemies": {
        const range = Math.max(0, Math.min(args[0] ?? ACTIVE_SCAN_RANGE, ACTIVE_SCAN_RANGE));
        return scanEnemies(robot, range);
      }

      case "last_seen_enemy": {
        const memory = robot.memory.lastSeenEnemy;
        if (!memory) return null;
        const age = world.currentTick - memory.tick;
        return {
          id: memory.id,
          position: { x: memory.position.x, y: memory.position.y },
          last_seen_tick: memory.tick,
          age,
        };
      }

      case "has_recent_enemy_contact": {
        const maxAge = args[0] ?? ACTIVE_SCAN_MEMORY_TICKS;
        const memory = robot.memory.lastSeenEnemy;
        if (!memory) return false;
        return world.currentTick - memory.tick <= maxAge;
      }

      case "can_attack": {
        const target = args[0];
        if (!target) return false;
        const cd = robot.cooldowns.get("attack") ?? 0;
        if (cd > 0) return false;
        const stats = CLASS_STATS[robot.class];
        const range = stats?.attackRange ?? ATTACK_RANGE;
        let targetPos;
        let targetId = null;
        if ("position" in target) {
          targetPos = target.position;
          targetId = target.id ?? null;
        } else if ("x" in target && "y" in target) {
          targetPos = target;
        } else {
          return false;
        }
        if (distance(robot.position, targetPos) > range) return false;
        if (targetId) {
          const visibleIds = new Set(getVisibleEnemies(world, robot).map(enemy => enemy.id));
          if (!visibleIds.has(targetId)) return false;
        }
        return true;
      }

      // --- New Perception Sensors ---
      case "health_percent":
        return Math.round((robot.health / robot.maxHealth) * 100);

      case "angle_to": {
        const target = args[0];
        if (!target) return 0;
        let tx, ty;
        if ("x" in target && "y" in target) { tx = target.x; ty = target.y; }
        else if ("position" in target) { tx = target.position.x; ty = target.position.y; }
        else return 0;
        const dx = tx - robot.position.x;
        const dy = ty - robot.position.y;
        const targetAngle = Math.atan2(dy, dx);
        const headingAngle = Math.atan2(robot.heading.y, robot.heading.x);
        let diff = (targetAngle - headingAngle) * (180 / Math.PI);
        if (diff > 180) diff -= 360;
        if (diff < -180) diff += 360;
        return Math.round(diff);
      }

      case "is_facing": {
        const target = args[0];
        const tolerance = args[1] ?? 30;
        if (!target) return false;
        let tx, ty;
        if ("x" in target && "y" in target) { tx = target.x; ty = target.y; }
        else if ("position" in target) { tx = target.position.x; ty = target.position.y; }
        else return false;
        const dx = tx - robot.position.x;
        const dy = ty - robot.position.y;
        const targetAngle = Math.atan2(dy, dx);
        const headingAngle = Math.atan2(robot.heading.y, robot.heading.x);
        let diff = Math.abs(targetAngle - headingAngle) * (180 / Math.PI);
        if (diff > 180) diff = 360 - diff;
        return diff <= tolerance;
      }

      case "enemy_heading": {
        const target = args[0];
        if (!target) return null;
        const targetId = target.id ?? (typeof target === "string" ? target : null);
        if (!targetId) return null;
        const enemy = world.getRobot(targetId);
        if (!enemy || !enemy.alive) return null;
        // Must be visible
        const visibleIds = new Set(getVisibleEnemies(world, robot).map(e => e.id));
        if (!visibleIds.has(targetId)) return null;
        return { x: enemy.heading.x, y: enemy.heading.y };
      }

      case "is_enemy_facing_me": {
        const target = args[0];
        if (!target) return false;
        const targetId = target.id ?? (typeof target === "string" ? target : null);
        if (!targetId) return false;
        const enemy = world.getRobot(targetId);
        if (!enemy || !enemy.alive) return false;
        const visibleIds = new Set(getVisibleEnemies(world, robot).map(e => e.id));
        if (!visibleIds.has(targetId)) return false;
        const dx = robot.position.x - enemy.position.x;
        const dy = robot.position.y - enemy.position.y;
        const toMe = Math.atan2(dy, dx);
        const theirHeading = Math.atan2(enemy.heading.y, enemy.heading.x);
        let diff = Math.abs(toMe - theirHeading) * (180 / Math.PI);
        if (diff > 180) diff = 360 - diff;
        return diff <= 45;
      }

      case "ally_health": {
        const target = args[0];
        if (!target) return 0;
        const allyId = target.id ?? (typeof target === "string" ? target : null);
        if (!allyId) return 0;
        const ally = world.getRobot(allyId);
        if (!ally || !ally.alive || ally.teamId !== robot.teamId) return 0;
        return ally.health;
      }

      case "kills":
        return robot.kills ?? 0;

      case "time_alive":
        return world.currentTick - (robot.spawnTick ?? 0);

      // --- Noise Sensor ---
      case "nearest_sound": {
        let nearestDist = Infinity;
        let nearest = null;
        const cutoff = world.currentTick - NOISE_DECAY_TICKS;
        for (const noise of world.noiseEvents) {
          if (noise.tick < cutoff) continue;
          const d = distance(robot.position, noise.position);
          if (d > noise.radius) continue;
          // Don't hear your own team's noise
          const source = world.getRobot(noise.sourceName);
          if (source && source.teamId === robot.teamId) continue;
          if (d < nearestDist) {
            nearestDist = d;
            nearest = {
              position: { x: noise.position.x, y: noise.position.y },
              distance: Math.round(d),
              age: world.currentTick - noise.tick,
            };
          }
        }
        return nearest;
      }

      // --- Mine Sensor ---
      case "nearest_mine": {
        let nearestDist = Infinity;
        let nearest = null;
        for (const mine of world.mines.values()) {
          // Can only see enemy mines within close range
          if (mine.teamId === robot.teamId) continue;
          const d = distance(robot.position, mine.position);
          if (d > MINE_VISIBLE_RANGE) continue;
          if (d < nearestDist) {
            nearestDist = d;
            nearest = {
              id: mine.id,
              position: { x: mine.position.x, y: mine.position.y },
              distance: Math.round(d),
            };
          }
        }
        return nearest;
      }

      // --- Pickup Sensor ---
      case "nearest_pickup": {
        let nearestDist = Infinity;
        let nearest = null;
        const visionRange = CLASS_STATS[robot.class]?.visionRange ?? DEFAULT_VISION_RANGE;
        for (const pickup of world.pickups.values()) {
          if (pickup.collected) continue;
          const d = distance(robot.position, pickup.position);
          if (d > visionRange) continue;
          if (d < nearestDist) {
            nearestDist = d;
            nearest = {
              id: pickup.id,
              position: { x: pickup.position.x, y: pickup.position.y },
              type: pickup.type,
              distance: Math.round(d),
            };
          }
        }
        return nearest;
      }

      // --- Waypoint Memory ---
      case "recall_position": {
        const name = args[0];
        if (!name || typeof name !== "string") return null;
        const wp = robot.memory.waypoints.get(name);
        if (!wp) return null;
        return { x: wp.x, y: wp.y };
      }

      // --- State Queries ---
      case "is_taunted":
        return robot.tauntedBy !== null && world.currentTick < robot.tauntExpiresTick;

      case "is_in_overwatch":
        return robot.overwatchActive && world.currentTick < robot.overwatchExpiresTick;

      case "has_effect": {
        const effectType = args[0];
        if (!effectType) return false;
        return robot.activeEffects.some(e => e.type === effectType && world.currentTick < e.expiresTick);
      }

      default:
        return null;
    }
  };
}
