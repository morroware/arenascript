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
            if (!target)
                break;
            const diff = sub(target, robot.position);
            const dist = length(diff);
            if (dist < 0.1) {
                robot.velocity = vec2(0, 0);
            }
            else {
                const dir = normalize(diff);
                const speed = Math.min(moveSpeed, dist);
                robot.velocity = scale(dir, speed);
                robot.heading = dir;
            }
            break;
        }
        case "move_toward": {
            const target = resolveTargetPosition(world, action);
            if (!target)
                break;
            const dir = normalize(sub(target, robot.position));
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
            }
            else {
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
    if (!robot.alive)
        return;
    const newPos = add(robot.position, robot.velocity);
    robot.position = clamp(newPos, ROBOT_RADIUS, ROBOT_RADIUS, world.config.arenaWidth - ROBOT_RADIUS, world.config.arenaHeight - ROBOT_RADIUS);
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
                a.position = clamp(a.position, ROBOT_RADIUS, ROBOT_RADIUS, world.config.arenaWidth - ROBOT_RADIUS, world.config.arenaHeight - ROBOT_RADIUS);
                b.position = clamp(b.position, ROBOT_RADIUS, ROBOT_RADIUS, world.config.arenaWidth - ROBOT_RADIUS, world.config.arenaHeight - ROBOT_RADIUS);
            }
        }
    }
}
/** Resolve target from action intent — could be a position, entity ID, or entity object */
function resolveTargetPosition(world, action) {
    if (!action.target)
        return null;
    if (typeof action.target === "string") {
        // Entity ID
        const entity = world.getRobot(action.target);
        if (entity)
            return entity.position;
        const cp = world.controlPoints.get(action.target);
        if (cp)
            return cp.position;
        return null;
    }
    // Direct position
    if ("x" in action.target && "y" in action.target) {
        return action.target;
    }
    return null;
}
