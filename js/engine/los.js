// ============================================================================
// Line-of-Sight and Visibility System
// ============================================================================

import { distance, sub, normalize, scale, add } from "../shared/vec2.js";
import {
  CLASS_STATS, DEFAULT_VISION_RANGE, LOS_RANGE,
  OVERWATCH_VISION_BONUS, PICKUP_VISION_BONUS,
  CLOAK_BREAK_DISTANCE,
} from "../shared/config.js";

function visionRangeFor(robot) {
  let range = CLASS_STATS[robot.class]?.visionRange ?? DEFAULT_VISION_RANGE;
  // Apply vision pickup effect
  if (robot.activeEffects?.some(e => e.type === "vision")) {
    range += PICKUP_VISION_BONUS;
  }
  // Apply overwatch vision bonus
  if (robot.overwatchActive) {
    range += OVERWATCH_VISION_BONUS;
  }
  return Math.min(range, LOS_RANGE);
}

/** Check if a point is within a rectangular cover object */
function pointInRect(p, cover) {
  const halfW = cover.width / 2;
  const halfH = cover.height / 2;
  return (
    p.x >= cover.position.x - halfW &&
    p.x <= cover.position.x + halfW &&
    p.y >= cover.position.y - halfH &&
    p.y <= cover.position.y + halfH
  );
}

/** Ray-AABB intersection test */
function rayIntersectsRect(origin, dir, dist, cover) {
  const halfW = cover.width / 2;
  const halfH = cover.height / 2;
  const minX = cover.position.x - halfW;
  const maxX = cover.position.x + halfW;
  const minY = cover.position.y - halfH;
  const maxY = cover.position.y + halfH;

  let tMin = 0;
  let tMax = dist;

  // X slab
  if (Math.abs(dir.x) < 0.0001) {
    if (origin.x < minX || origin.x > maxX) return false;
  } else {
    let t1 = (minX - origin.x) / dir.x;
    let t2 = (maxX - origin.x) / dir.x;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return false;
  }

  // Y slab
  if (Math.abs(dir.y) < 0.0001) {
    if (origin.y < minY || origin.y > maxY) return false;
  } else {
    let t1 = (minY - origin.y) / dir.y;
    let t2 = (maxY - origin.y) / dir.y;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return false;
  }

  return true;
}

/** Check if there is a clear line of sight between two positions */
export function hasLineOfSight(world, from, to) {
  const dist = distance(from, to);
  if (dist > LOS_RANGE) return false;
  if (dist < 0.001) return true;

  const dir = normalize(sub(to, from));

  // Check against all cover objects
  for (const cover of world.covers.values()) {
    if (rayIntersectsRect(from, dir, dist, cover)) {
      return false;
    }
  }

  return true;
}

/** Get all enemy robots visible from a given robot */
export function getVisibleEnemies(world, robot) {
  const visible = [];
  const visionRange = visionRangeFor(robot);
  for (const other of world.robots.values()) {
    if (!other.alive) continue;
    if (other.teamId === robot.teamId) continue;
    const d = distance(robot.position, other.position);
    if (d > visionRange) continue;
    // Cloaked enemies are invisible except at very close range.
    if (other.cloakActive && d > CLOAK_BREAK_DISTANCE) continue;
    if (hasLineOfSight(world, robot.position, other.position)) {
      visible.push(other);
    }
  }
  // Sort by distance for deterministic ordering
  visible.sort((a, b) => distance(robot.position, a.position) - distance(robot.position, b.position));
  return visible;
}

/** Get all ally robots visible from a given robot */
export function getVisibleAllies(world, robot) {
  const visible = [];
  const visionRange = visionRangeFor(robot);
  for (const other of world.robots.values()) {
    if (!other.alive) continue;
    if (other.id === robot.id) continue;
    if (other.teamId !== robot.teamId) continue;
    if (distance(robot.position, other.position) > visionRange) continue;
    if (hasLineOfSight(world, robot.position, other.position)) {
      visible.push(other);
    }
  }
  visible.sort((a, b) => distance(robot.position, a.position) - distance(robot.position, b.position));
  return visible;
}
