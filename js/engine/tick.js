// ============================================================================
// Tick Scheduler — The 11-phase deterministic simulation loop
// ============================================================================

import { World, resetIdCounter } from "./world.js";
import { VM } from "../runtime/vm.js";
import { createSensorGateway } from "./sensors.js";
import { validateAction, categorizeActions } from "./actions.js";
import { resolveMovement, applyMovement, resolveCollisions } from "./movement.js";
import { resolveCombat, updateProjectiles, updateCooldowns } from "./combat.js";
import { VisibilityTracker, checkCooldownReady } from "./events.js";
import { ReplayWriter } from "./replay.js";
import { CAPTURE_RATE, CAPTURE_WIN_THRESHOLD, CAPTURE_RADIUS } from "../shared/config.js";
import { distance, vec2 } from "../shared/vec2.js";

/**
 * Run a complete match simulation.
 * This is the core game loop — fully deterministic.
 */
export function runMatch(setup) {
  resetIdCounter();

  const { config } = setup;
  const world = new World(config);
  initializeArenaLayout(world);
  const visibilityTracker = new VisibilityTracker();
  const sensorGateway = createSensorGateway(world);

  // Track stats per robot
  const robotStats = new Map();

  // Spawn robots and create VMs
  const robotVMs = new Map();

  const matchParticipants = [];

  const teamSpawnOrder = new Map();

  for (const participant of setup.participants) {
    const teamIndex = teamSpawnOrder.get(participant.teamId) ?? 0;
    const spawnPosition = getSpawnPositionForTeam(world, participant.teamId, teamIndex);
    teamSpawnOrder.set(participant.teamId, teamIndex + 1);

    const robot = world.spawnRobot(
      participant.program.robotName,
      participant.program.robotClass,
      participant.teamId,
      participant.program.programId,
      spawnPosition,
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
  let winner = null;
  let reason = "max_ticks_reached";

  for (let tick = 0; tick < config.maxTicks; tick++) {
    world.currentTick = tick;

    // Phase 1: Update world timers/cooldowns
    updateCooldowns(world);

    // Phase 2: Build sensor views (handled lazily by sensor gateway)
    // Phase 3 & 4: Execute robot programs and collect action intents
    const movementActions = new Map();
    const combatActions = new Map();

    for (const [robotId, vm] of robotVMs) {
      const robot = world.getRobot(robotId);
      if (!robot || !robot.alive) continue;

      // Execute tick handler
      const result = vm.executeEvent("tick");

      if (result.budgetExceeded) {
        const stats = robotStats.get(robotId);
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
            robotStats.get(robotId).actionsExecuted++;
          }
        }
        if (combat) {
          const validated = validateAction(combat, robot);
          if (validated.valid) {
            combatActions.set(robotId, combat);
            robotStats.get(robotId).actionsExecuted++;
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
        const sourceId = event.data.sourceId;
        const damage = event.data.damage;
        const sourceStats = robotStats.get(sourceId);
        if (sourceStats) sourceStats.damageDealt += damage;
        const targetStats = robotStats.get(event.robotId);
        if (targetStats) targetStats.damageTaken += damage;
      }
      if (event.type === "destroyed" && event.data) {
        const killedBy = event.data.killedBy;
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
    const replayActions = new Map();
    for (const [robotId, action] of movementActions) replayActions.set(robotId, action);
    for (const [robotId, action] of combatActions) replayActions.set(robotId, action);
    replayWriter.captureFrame(world, tickEvents, replayActions);

    // Phase 11: Check win conditions
    const winResult = checkWinCondition(world);
    if (winResult.resolved) {
      winner = winResult.winner;
      reason = winResult.reason;
      break;
    }
  }

  if (reason === "max_ticks_reached") {
    const timeoutResolution = determineTimeoutWinner(world, robotStats);
    winner = timeoutResolution.winner;
    reason = timeoutResolution.reason;
  }

  return {
    winner,
    reason,
    tickCount: world.currentTick + 1,
    replay: replayWriter.finalize(),
    robotStats,
  };
}

function initializeArenaLayout(world) {
  const { arenaWidth: w, arenaHeight: h } = world.config;

  // Multi-point objective map: encourages rotation instead of center camping.
  world.addControlPoint(vec2(w * 0.20, h * 0.50), CAPTURE_RADIUS);
  world.addControlPoint(vec2(w * 0.50, h * 0.50), CAPTURE_RADIUS);
  world.addControlPoint(vec2(w * 0.80, h * 0.50), CAPTURE_RADIUS);

  // Central wall with two pass-through lanes creates meaningful chokepoints.
  world.addCover(vec2(w * 0.50, h * 0.18), 8, 18);
  world.addCover(vec2(w * 0.50, h * 0.82), 8, 18);

  // Side anchors for flank-vs-mid decision making.
  world.addCover(vec2(w * 0.33, h * 0.50), 6, 10);
  world.addCover(vec2(w * 0.67, h * 0.50), 6, 10);
}

function getSpawnPositionForTeam(world, teamId, teamMemberIndex) {
  const { arenaWidth: w, arenaHeight: h } = world.config;
  const laneOffsets = [-12, -6, 0, 6, 12];
  const laneOffset = laneOffsets[teamMemberIndex % laneOffsets.length];
  const x = teamId % 2 === 0 ? w * 0.10 : w * 0.90;
  const y = Math.max(6, Math.min(h - 6, (h * 0.50) + laneOffset));
  return vec2(x, y);
}

/** Check if a team has won by eliminating all opponents */
function checkWinCondition(world) {
  const teams = world.getTeamIds();
  const aliveTeams = teams.filter(t => world.getAliveRobotsByTeam(t).length > 0);

  if (aliveTeams.length === 1) {
    return {
      resolved: true,
      winner: aliveTeams[0],
      reason: "elimination",
    };
  }

  if (aliveTeams.length === 0) {
    return {
      resolved: true,
      winner: null,
      reason: "mutual_destruction",
    };
  }

  return {
    resolved: false,
    winner: null,
    reason: "ongoing",
  };
}

function determineTimeoutWinner(world, robotStats) {
  const teams = world.getTeamIds();
  const summary = new Map();

  for (const teamId of teams) {
    summary.set(teamId, {
      aliveCount: 0,
      totalHealth: 0,
      damageDealt: 0,
      controlPointsOwned: 0,
    });
  }

  for (const robot of world.robots.values()) {
    const teamSummary = summary.get(robot.teamId);
    if (!teamSummary) continue;
    if (robot.alive) {
      teamSummary.aliveCount += 1;
      teamSummary.totalHealth += robot.health;
    }
    const stats = robotStats.get(robot.id);
    if (stats) {
      teamSummary.damageDealt += stats.damageDealt;
    }
  }

  for (const cp of world.controlPoints.values()) {
    if (cp.owner !== null && summary.has(cp.owner)) {
      summary.get(cp.owner).controlPointsOwned += 1;
    }
  }

  const rankedTeams = [...summary.entries()].sort((a, b) => {
    const [, aStats] = a;
    const [, bStats] = b;
    if (bStats.aliveCount !== aStats.aliveCount) return bStats.aliveCount - aStats.aliveCount;
    if (bStats.totalHealth !== aStats.totalHealth) return bStats.totalHealth - aStats.totalHealth;
    if (bStats.damageDealt !== aStats.damageDealt) return bStats.damageDealt - aStats.damageDealt;
    if (bStats.controlPointsOwned !== aStats.controlPointsOwned) return bStats.controlPointsOwned - aStats.controlPointsOwned;
    return a[0] - b[0];
  });

  if (rankedTeams.length <= 1) {
    return {
      winner: rankedTeams[0]?.[0] ?? null,
      reason: "max_ticks_reached",
    };
  }

  const [firstTeamId, first] = rankedTeams[0];
  const [, second] = rankedTeams[1];

  if (first.aliveCount !== second.aliveCount) {
    return { winner: firstTeamId, reason: "timeout_alive_tiebreak" };
  }
  if (first.totalHealth !== second.totalHealth) {
    return { winner: firstTeamId, reason: "timeout_health_tiebreak" };
  }
  if (first.damageDealt !== second.damageDealt) {
    return { winner: firstTeamId, reason: "timeout_damage_tiebreak" };
  }
  if (first.controlPointsOwned !== second.controlPointsOwned) {
    return { winner: firstTeamId, reason: "timeout_control_tiebreak" };
  }

  return {
    winner: null,
    reason: "timeout_exact_draw",
  };
}
