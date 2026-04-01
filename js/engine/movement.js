// ============================================================================
// Movement Resolution — Position updates, collision, arena bounds
// ============================================================================

import { add, sub, normalize, scale, distance, clamp, vec2, length } from "../shared/vec2.js";
import { CLASS_STATS, ROBOT_MOVE_SPEED, ROBOT_RADIUS } from "../shared/config.js";

/** Resolve a movement action for a robot */
export function resolveMovement(world, robot, action) {
  if (!action || !robot.alive) {
    robot.velocity = vec2(0, 0);
    return;
  }

  const stats = CLASS_STATS[robot.class];
  const moveSpeed = stats?.moveSpeed ?? ROBOT_MOVE_SPEED;

  switch (action.type) {
    case "move_to": {
      const target = resolveTargetPosition(world, action);
      if (!target) break;
      const navigationTarget = getNavigationTarget(world, robot, target);
      const diff = sub(navigationTarget, robot.position);
      const dist = length(diff);
      if (dist < 0.1) {
        robot.velocity = vec2(0, 0);
      } else {
        const dir = normalize(diff);
        const speed = Math.min(moveSpeed, dist);
        robot.velocity = scale(dir, speed);
        robot.heading = dir;
      }
      break;
    }

    case "move_toward": {
      const target = resolveTargetPosition(world, action);
      if (!target) break;
      const navigationTarget = getNavigationTarget(world, robot, target);
      const dir = normalize(sub(navigationTarget, robot.position));
      robot.velocity = scale(dir, moveSpeed);
      robot.heading = dir;
      break;
    }

    case "strafe_left": {
      // Perpendicular to heading, counter-clockwise
      const dir = vec2(-robot.heading.y, robot.heading.x);
      robot.velocity = scale(dir, moveSpeed);
      break;
    }

    case "strafe_right": {
      // Perpendicular to heading, clockwise
      const dir = vec2(robot.heading.y, -robot.heading.x);
      robot.velocity = scale(dir, moveSpeed);
      break;
    }

    case "retreat": {
      // Move away from nearest enemy
      const enemies = [...world.robots.values()].filter(r => r.alive && r.teamId !== robot.teamId);
      if (enemies.length > 0) {
        let nearest = enemies[0];
        let nearestDist = distance(robot.position, nearest.position);
        for (const e of enemies) {
          const d = distance(robot.position, e.position);
          if (d < nearestDist) {
            nearestDist = d;
            nearest = e;
          }
        }
        const dir = normalize(sub(robot.position, nearest.position));
        robot.velocity = scale(dir, moveSpeed);
        robot.heading = dir;
      } else {
        robot.velocity = vec2(0, 0);
      }
      break;
    }

    case "stop":
    default:
      robot.velocity = vec2(0, 0);
      break;
  }
}

/** Apply velocity to position with arena bounds clamping */
export function applyMovement(world, robot) {
  if (!robot.alive) return;

  const oldPos = robot.position;
  const newPos = add(robot.position, robot.velocity);
  const clamped = clamp(
    newPos,
    ROBOT_RADIUS,
    ROBOT_RADIUS,
    world.config.arenaWidth - ROBOT_RADIUS,
    world.config.arenaHeight - ROBOT_RADIUS,
  );

  if (isInsideCover(world, clamped)) {
    robot.position = oldPos;
    robot.velocity = vec2(0, 0);
    return;
  }

  robot.position = clamped;
}

/** Resolve simple robot-robot collision (push apart) */
export function resolveCollisions(world) {
  const alive = world.getAliveRobots();
  const minDist = ROBOT_RADIUS * 2;

  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i];
      const b = alive[j];
      const dist = distance(a.position, b.position);
      if (dist < minDist && dist > 0.001) {
        const overlap = (minDist - dist) / 2;
        const dir = normalize(sub(b.position, a.position));
        a.position = sub(a.position, scale(dir, overlap));
        b.position = add(b.position, scale(dir, overlap));

        // Re-clamp to arena
        a.position = clamp(a.position, ROBOT_RADIUS, ROBOT_RADIUS,
          world.config.arenaWidth - ROBOT_RADIUS, world.config.arenaHeight - ROBOT_RADIUS);
        b.position = clamp(b.position, ROBOT_RADIUS, ROBOT_RADIUS,
          world.config.arenaWidth - ROBOT_RADIUS, world.config.arenaHeight - ROBOT_RADIUS);
      }
    }
  }
}

function isInsideCover(world, position) {
  for (const cover of world.covers.values()) {
    const halfW = cover.width / 2;
    const halfH = cover.height / 2;
    const inX = position.x >= cover.position.x - halfW && position.x <= cover.position.x + halfW;
    const inY = position.y >= cover.position.y - halfH && position.y <= cover.position.y + halfH;
    if (inX && inY) return true;
  }
  return false;
}

/** Resolve target from action intent — could be a position, entity ID, or entity object */
function resolveTargetPosition(world, action) {
  if (!action.target) return null;

  if (typeof action.target === "string") {
    // Entity ID
    const entity = world.getRobot(action.target);
    if (entity) return entity.position;
    const cp = world.controlPoints.get(action.target);
    if (cp) return cp.position;
    return null;
  }

  // Direct position
  if ("x" in action.target && "y" in action.target) {
    return action.target;
  }

  return null;
}

function getNavigationTarget(world, robot, target) {
  const blockingCover = firstBlockingCover(world, robot.position, target);
  if (!blockingCover) return target;
  return chooseCoverDetour(world, robot.position, target, blockingCover);
}

function firstBlockingCover(world, from, to) {
  let blockingCover = null;
  let nearestIntersection = Infinity;
  for (const cover of world.covers.values()) {
    if (!segmentIntersectsExpandedRect(from, to, cover, ROBOT_RADIUS + 0.2)) continue;
    const dx = cover.position.x - from.x;
    const dy = cover.position.y - from.y;
    const distSq = (dx * dx) + (dy * dy);
    if (distSq < nearestIntersection) {
      nearestIntersection = distSq;
      blockingCover = cover;
    }
  }
  return blockingCover;
}

function chooseCoverDetour(world, from, to, cover) {
  const margin = ROBOT_RADIUS + 0.75;
  const above = clamp(
    vec2(cover.position.x, cover.position.y - (cover.height / 2) - margin),
    ROBOT_RADIUS,
    ROBOT_RADIUS,
    world.config.arenaWidth - ROBOT_RADIUS,
    world.config.arenaHeight - ROBOT_RADIUS,
  );
  const below = clamp(
    vec2(cover.position.x, cover.position.y + (cover.height / 2) + margin),
    ROBOT_RADIUS,
    ROBOT_RADIUS,
    world.config.arenaWidth - ROBOT_RADIUS,
    world.config.arenaHeight - ROBOT_RADIUS,
  );

  const aboveCost = distance(from, above) + distance(above, to);
  const belowCost = distance(from, below) + distance(below, to);
  return aboveCost <= belowCost ? above : below;
}

function segmentIntersectsExpandedRect(start, end, cover, padding) {
  const halfW = (cover.width / 2) + padding;
  const halfH = (cover.height / 2) + padding;
  const minX = cover.position.x - halfW;
  const maxX = cover.position.x + halfW;
  const minY = cover.position.y - halfH;
  const maxY = cover.position.y + halfH;

  const startInside = start.x >= minX && start.x <= maxX && start.y >= minY && start.y <= maxY;
  const endInside = end.x >= minX && end.x <= maxX && end.y >= minY && end.y <= maxY;
  if (startInside || endInside) return true;

  const corners = [
    vec2(minX, minY),
    vec2(maxX, minY),
    vec2(maxX, maxY),
    vec2(minX, maxY),
  ];

  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    if (segmentsIntersect(start, end, a, b)) return true;
  }

  return false;
}

function segmentsIntersect(a, b, c, d) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);

  if (o1 !== o2 && o3 !== o4) return true;
  return false;
}

function orientation(p, q, r) {
  const v = ((q.y - p.y) * (r.x - q.x)) - ((q.x - p.x) * (r.y - q.y));
  if (Math.abs(v) < 0.000001) return 0;
  return v > 0 ? 1 : 2;
}
