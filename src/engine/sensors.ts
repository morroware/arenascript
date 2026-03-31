// ============================================================================
// Sensor Gateway — Read-only perception layer for robots
// ============================================================================

import type { EntityId, RobotState, Vec2 } from "../shared/types.js";
import type { World } from "./world.js";
import { getVisibleEnemies, getVisibleAllies, hasLineOfSight } from "./los.js";
import { distance } from "../shared/vec2.js";
import type { SensorGateway } from "../runtime/vm.js";
import { ATTACK_RANGE, CLASS_STATS } from "../shared/config.js";

/** Convert a RobotState to a safe VM-visible object */
function robotToSensorView(robot: RobotState): Record<string, unknown> {
  return {
    id: robot.id,
    position: { x: robot.position.x, y: robot.position.y },
    health: robot.health,
    heading: { x: robot.heading.x, y: robot.heading.y },
  };
}

/** Create the sensor gateway for a given world */
export function createSensorGateway(world: World): SensorGateway {
  return (robotId: EntityId, sensorName: string, args: unknown[]): unknown => {
    const robot = world.getRobot(robotId);
    if (!robot || !robot.alive) return null;

    switch (sensorName) {
      // --- Self Sensors ---
      case "health":
        return robot.health;

      case "max_health":
        return robot.maxHealth;

      case "energy":
        return robot.energy;

      case "position":
        return { x: robot.position.x, y: robot.position.y };

      case "velocity":
        return { x: robot.velocity.x, y: robot.velocity.y };

      case "heading":
        return { x: robot.heading.x, y: robot.heading.y };

      case "cooldown": {
        const actionName = args[0] as string;
        return robot.cooldowns.get(actionName) ?? 0;
      }

      // --- Enemy Sensors ---
      case "nearest_enemy": {
        const visible = getVisibleEnemies(world, robot);
        if (visible.length === 0) return null;
        return robotToSensorView(visible[0]);
      }

      case "visible_enemies": {
        const visible = getVisibleEnemies(world, robot);
        return visible.map(robotToSensorView);
      }

      case "enemy_count_in_range": {
        const range = (args[0] as number) ?? ATTACK_RANGE;
        const visible = getVisibleEnemies(world, robot);
        return visible.filter(e => distance(robot.position, e.position) <= range).length;
      }

      // --- Ally Sensors ---
      case "nearest_ally": {
        const allies = getVisibleAllies(world, robot);
        if (allies.length === 0) return null;
        return robotToSensorView(allies[0]);
      }

      case "visible_allies": {
        const allies = getVisibleAllies(world, robot);
        return allies.map(robotToSensorView);
      }

      // --- Arena Sensors ---
      case "nearest_cover": {
        let nearestDist = Infinity;
        let nearest: Vec2 | null = null;
        for (const cover of world.covers.values()) {
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
        let nearest: Record<string, unknown> | null = null;
        for (const res of world.resources.values()) {
          const d = distance(robot.position, res.position);
          if (d < nearestDist) {
            nearestDist = d;
            nearest = { id: res.id, position: { x: res.position.x, y: res.position.y }, amount: res.amount };
          }
        }
        return nearest;
      }

      case "nearest_control_point": {
        let nearestDist = Infinity;
        let nearest: Record<string, unknown> | null = null;
        for (const cp of world.controlPoints.values()) {
          const d = distance(robot.position, cp.position);
          if (d < nearestDist) {
            nearestDist = d;
            nearest = { id: cp.id, position: { x: cp.position.x, y: cp.position.y }, owner: cp.owner };
          }
        }
        return nearest;
      }

      case "distance_to": {
        const target = args[0] as Vec2 | Record<string, unknown> | null;
        if (!target) return 999;
        if ("x" in target && "y" in target) {
          return distance(robot.position, target as Vec2);
        }
        if ("position" in target) {
          return distance(robot.position, (target as Record<string, unknown>).position as Vec2);
        }
        // It might be an entity ID
        if (typeof target === "string") {
          const other = world.getRobot(target);
          if (other) return distance(robot.position, other.position);
        }
        return 999;
      }

      case "line_of_sight": {
        const target = args[0] as Vec2 | Record<string, unknown> | null;
        if (!target) return false;
        let targetPos: Vec2;
        if ("x" in target && "y" in target) {
          targetPos = target as Vec2;
        } else if ("position" in target) {
          targetPos = (target as Record<string, unknown>).position as Vec2;
        } else {
          return false;
        }
        return hasLineOfSight(world, robot.position, targetPos);
      }

      case "current_tick":
        return world.currentTick;

      case "can_attack": {
        const target = args[0] as Record<string, unknown> | null;
        if (!target) return false;
        const cd = robot.cooldowns.get("attack") ?? 0;
        if (cd > 0) return false;
        const stats = CLASS_STATS[robot.class];
        const range = stats?.attackRange ?? ATTACK_RANGE;
        let targetPos: Vec2;
        if ("position" in target) {
          targetPos = target.position as Vec2;
        } else if ("x" in target && "y" in target) {
          targetPos = target as unknown as Vec2;
        } else {
          return false;
        }
        return distance(robot.position, targetPos) <= range;
      }

      default:
        return null;
    }
  };
}
