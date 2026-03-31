// ============================================================================
// Tick Scheduler — The 11-phase deterministic simulation loop
// ============================================================================

import type {
  CompiledProgram, ActionIntent, GameEvent, MatchConfig,
  MatchParticipant, EntityId, ReplayData,
} from "../shared/types.js";
import { World, resetIdCounter } from "./world.js";
import { VM, type SensorGateway } from "../runtime/vm.js";
import { createSensorGateway } from "./sensors.js";
import { validateAction, categorizeActions } from "./actions.js";
import { resolveMovement, applyMovement, resolveCollisions } from "./movement.js";
import { resolveCombat, updateProjectiles, updateCooldowns } from "./combat.js";
import { VisibilityTracker, checkCooldownReady } from "./events.js";
import { ReplayWriter } from "./replay.js";
import { CAPTURE_RATE, CAPTURE_WIN_THRESHOLD, CAPTURE_RADIUS } from "../shared/config.js";
import { distance } from "../shared/vec2.js";
import type { ConstPoolEntry } from "../runtime/opcodes.js";

export interface MatchSetup {
  config: MatchConfig;
  participants: Array<{
    program: CompiledProgram;
    constants: ConstPoolEntry[];
    playerId: string;
    teamId: number;
  }>;
}

export interface MatchResult {
  winner: number | null;  // teamId or null for draw
  reason: string;
  tickCount: number;
  replay: ReplayData;
  robotStats: Map<EntityId, RobotStats>;
}

export interface RobotStats {
  damageDealt: number;
  damageTaken: number;
  kills: number;
  actionsExecuted: number;
  budgetExceeded: number;
}

/**
 * Run a complete match simulation.
 * This is the core game loop — fully deterministic.
 */
export function runMatch(setup: MatchSetup): MatchResult {
  resetIdCounter();

  const { config } = setup;
  const world = new World(config);
  const visibilityTracker = new VisibilityTracker();
  const sensorGateway = createSensorGateway(world);

  // Track stats per robot
  const robotStats = new Map<EntityId, RobotStats>();

  // Spawn robots and create VMs
  const robotVMs = new Map<EntityId, VM>();

  const matchParticipants: MatchParticipant[] = [];

  for (const participant of setup.participants) {
    const robot = world.spawnRobot(
      participant.program.robotName,
      participant.program.robotClass,
      participant.teamId,
      participant.program.programId,
    );

    const vm = new VM(participant.program, robot.id, sensorGateway);
    vm.setConstants(participant.constants);
    robotVMs.set(robot.id, vm);

    robotStats.set(robot.id, {
      damageDealt: 0,
      damageTaken: 0,
      kills: 0,
      actionsExecuted: 0,
      budgetExceeded: 0,
    });

    matchParticipants.push({
      robotId: robot.id,
      programId: participant.program.programId,
      teamId: participant.teamId,
      playerId: participant.playerId,
      eloAtStart: 0,
    });
  }

  // Create replay writer
  const matchId = `match_${config.seed}_${Date.now()}`;
  const replayWriter = new ReplayWriter(matchId, config.seed, matchParticipants);

  // Execute spawn handlers
  for (const [robotId, vm] of robotVMs) {
    vm.executeEvent("spawn");
  }

  // Main tick loop
  let winner: number | null = null;
  let reason = "max_ticks_reached";

  for (let tick = 0; tick < config.maxTicks; tick++) {
    world.currentTick = tick;

    // Phase 1: Update world timers/cooldowns
    updateCooldowns(world);

    // Phase 2: Build sensor views (handled lazily by sensor gateway)
    // Phase 3 & 4: Execute robot programs and collect action intents
    const movementActions = new Map<EntityId, ActionIntent>();
    const combatActions = new Map<EntityId, ActionIntent>();

    for (const [robotId, vm] of robotVMs) {
      const robot = world.getRobot(robotId);
      if (!robot || !robot.alive) continue;

      // Execute tick handler
      const result = vm.executeEvent("tick");

      if (result.budgetExceeded) {
        const stats = robotStats.get(robotId)!;
        stats.budgetExceeded++;
      }

      // Validate and categorize actions
      if (result.actions.length > 0) {
        const { movement, combat, utility } = categorizeActions(result.actions);
        // Store primary actions
        if (movement) {
          const validated = validateAction(movement, robot);
          if (validated.valid) {
            movementActions.set(robotId, movement);
            robotStats.get(robotId)!.actionsExecuted++;
          }
        }
        if (combat) {
          const validated = validateAction(combat, robot);
          if (validated.valid) {
            combatActions.set(robotId, combat);
            robotStats.get(robotId)!.actionsExecuted++;
          }
        }
      }
    }

    // Phase 5: Resolve movement
    for (const robot of world.getAliveRobots()) {
      resolveMovement(world, robot, movementActions.get(robot.id) ?? null);
    }

    // Phase 6: Apply movement and resolve collisions
    for (const robot of world.getAliveRobots()) {
      applyMovement(world, robot);
    }
    resolveCollisions(world);

    // Phase 7: Resolve attacks and abilities
    for (const robot of world.getAliveRobots()) {
      const combatAction = combatActions.get(robot.id);
      if (combatAction && ["attack", "fire_at", "use_ability", "shield"].includes(combatAction.type)) {
        resolveCombat(world, robot, combatAction);
      }
    }

    // Phase 8: Apply damage/effects (projectiles)
    updateProjectiles(world);

    // Update capture points
    for (const cp of world.controlPoints.values()) {
      for (const robot of world.getAliveRobots()) {
        if (distance(robot.position, cp.position) <= CAPTURE_RADIUS) {
          if (cp.owner !== robot.teamId) {
            cp.captureProgress += CAPTURE_RATE;
            if (cp.captureProgress >= CAPTURE_WIN_THRESHOLD) {
              cp.owner = robot.teamId;
              cp.captureProgress = 0;
            }
          }
        }
      }
    }

    // Phase 9: Emit events
    visibilityTracker.update(world);
    checkCooldownReady(world);
    const tickEvents = world.drainEvents();

    // Track damage stats from events
    for (const event of tickEvents) {
      if (event.type === "damaged" && event.data) {
        const sourceId = event.data.sourceId as string;
        const damage = event.data.damage as number;
        const sourceStats = robotStats.get(sourceId);
        if (sourceStats) sourceStats.damageDealt += damage;
        const targetStats = robotStats.get(event.robotId);
        if (targetStats) targetStats.damageTaken += damage;
      }
      if (event.type === "destroyed" && event.data) {
        const killedBy = event.data.killedBy as string;
        const killerStats = robotStats.get(killedBy);
        if (killerStats) killerStats.kills++;
      }
    }

    // Dispatch emitted events to robot VMs (reactive handlers — no new actions this tick)
    for (const event of tickEvents) {
      if (event.type === "tick" || event.type === "spawn") continue;
      const vm = robotVMs.get(event.robotId);
      if (vm) {
        const robot = world.getRobot(event.robotId);
        if (robot?.alive) {
          vm.executeEvent(event.type, event);
        }
      }
    }

    // Phase 10: Write replay trace
    const replayActions = new Map<EntityId, ActionIntent>();
    for (const [robotId, action] of movementActions) replayActions.set(robotId, action);
    for (const [robotId, action] of combatActions) replayActions.set(robotId, action);
    replayWriter.captureFrame(world, tickEvents, replayActions);

    // Phase 11: Check win conditions
    const winResult = checkWinCondition(world);
    if (winResult !== null) {
      winner = winResult;
      reason = "elimination";
      break;
    }
  }

  return {
    winner,
    reason,
    tickCount: world.currentTick + 1,
    replay: replayWriter.finalize(),
    robotStats,
  };
}

/** Check if a team has won by eliminating all opponents */
function checkWinCondition(world: World): number | null {
  const teams = world.getTeamIds();
  const aliveTeams = teams.filter(t => world.getAliveRobotsByTeam(t).length > 0);

  if (aliveTeams.length === 1) {
    return aliveTeams[0];
  }

  if (aliveTeams.length === 0) {
    return null; // draw — everyone died
  }

  return null; // match continues
}
