// ============================================================================
// Tick Scheduler — The 11-phase deterministic simulation loop
// ============================================================================

import { World, resetIdCounter } from "./world.js";
import { VM } from "../runtime/vm.js";
import { createSensorGateway } from "./sensors.js";
import { validateAction, categorizeActions } from "./actions.js";
import { resolveMovement, applyMovement, resolveCollisions } from "./movement.js";
import { resolveCombat, updateProjectiles, updateCooldowns, applyDamage } from "./combat.js";
import { VisibilityTracker, checkCooldownReady } from "./events.js";
import { ReplayWriter } from "./replay.js";
import {
  CAPTURE_RATE, CAPTURE_WIN_THRESHOLD, CAPTURE_RADIUS,
  HEAL_ZONE_RADIUS, HEAL_ZONE_TICK_RATE,
  HAZARD_ZONE_RADIUS, HAZARD_DAMAGE_PER_TICK,
  MIN_COVER_COUNT, MAX_COVER_COUNT,
  MIN_HEAL_ZONES, MAX_HEAL_ZONES,
  MIN_HAZARD_ZONES, MAX_HAZARD_ZONES,
  SPAWN_CLEAR_RADIUS, CLASS_STATS, DEFAULT_VISION_RANGE,
  MINE_DAMAGE, MINE_TRIGGER_RADIUS, MINE_MAX_PER_ROBOT, MINE_COOLDOWN, MINE_ENERGY_COST,
  PICKUP_SPAWN_INTERVAL, PICKUP_MAX_ACTIVE, PICKUP_COLLECT_RADIUS,
  PICKUP_EFFECT_DURATION, PICKUP_SPEED_MULTIPLIER, PICKUP_DAMAGE_MULTIPLIER,
  PICKUP_VISION_BONUS, PICKUP_ENERGY_RESTORE,
  NOISE_ATTACK_RADIUS, NOISE_MOVE_RADIUS, NOISE_GRENADE_RADIUS, NOISE_DECAY_TICKS,
  SIGNAL_RANGE, SIGNAL_COOLDOWN,
  OVERWATCH_DURATION, OVERWATCH_COOLDOWN, OVERWATCH_ENERGY_COST,
  TAUNT_DURATION, TAUNT_COOLDOWN, TAUNT_RANGE, TAUNT_ENERGY_COST,
  DESTRUCTIBLE_COVER_RATIO,
  CLOAK_DURATION, CLOAK_COOLDOWN, CLOAK_ENERGY_COST,
  SELF_DESTRUCT_COUNTDOWN, SELF_DESTRUCT_RADIUS, SELF_DESTRUCT_DAMAGE,
  SELF_DESTRUCT_HEALTH_THRESHOLD,
  DEPOT_COUNT, DEPOT_RADIUS, DEPOT_AMMO_PER_TICK, DEPOT_HEAT_VENT_PER_TICK,
  HEAT_MAX,
} from "../shared/config.js";
import { distance, vec2 } from "../shared/vec2.js";

let nextMatchSequence = 0;

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
    const requestedSquadSize = participant.program.squad?.size ?? 1;
    const squadSize = Math.max(1, Math.min(5, Number(requestedSquadSize) || 1));
    const roles = participant.program.squad?.roles ?? [];

    for (let squadIndex = 0; squadIndex < squadSize; squadIndex++) {
      const teamIndex = teamSpawnOrder.get(participant.teamId) ?? 0;
      const spawnPosition = getSpawnPositionForTeam(world, participant.teamId, teamIndex);
      teamSpawnOrder.set(participant.teamId, teamIndex + 1);
      const squadRole = roles.length > 0 ? roles[squadIndex % roles.length] : null;

      const robot = world.spawnRobot(
        participant.program.robotName,
        participant.program.robotClass,
        participant.teamId,
        participant.program.programId,
        spawnPosition,
        squadIndex,
        squadSize,
        squadRole,
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
  }

  // Create replay writer and capture the procedural arena layout
  const matchId = `match_${config.seed}_${++nextMatchSequence}`;
  const replayWriter = new ReplayWriter(matchId, config.seed, matchParticipants);
  replayWriter.captureArenaLayout(world);

  // Execute spawn handlers
  for (const [robotId, vm] of robotVMs) {
    vm.executeEvent("spawn");
  }

  // Main tick loop
  let winner = null;
  let reason = "max_ticks_reached";
  const suddenDeathStartTick = config.maxTicks;
  const suddenDeathMaxTicks = config.suddenDeathMaxTicks ?? 900;
  const absoluteMaxTicks = suddenDeathStartTick + suddenDeathMaxTicks;

  for (let tick = 0; tick < absoluteMaxTicks; tick++) {
    world.currentTick = tick;
    const inSuddenDeath = tick >= suddenDeathStartTick;

    // Phase 1: Update world timers/cooldowns
    updateCooldowns(world);

    if (inSuddenDeath) {
      for (const robot of world.getAliveRobots()) {
        applyDamage(world, robot, 1, "sudden_death");
      }
    }

    // Phase 1b: Execute VM timers (after/every blocks)
    for (const [robotId, vm] of robotVMs) {
      const robot = world.getRobot(robotId);
      if (!robot || !robot.alive) continue;
      const timerActions = vm.executeTimers(tick);
      // Timer actions get processed as utility actions
      for (const action of timerActions) {
        resolveUtilityAction(world, robot, action, robotStats);
      }
    }

    // Phase 1c: Spawn pickups periodically
    if (tick > 0 && tick % PICKUP_SPAWN_INTERVAL === 0) {
      spawnRandomPickup(world);
    }

    // Phase 1d: Expire taunt/overwatch/effects
    for (const robot of world.getAliveRobots()) {
      if (robot.tauntedBy && tick >= robot.tauntExpiresTick) {
        robot.tauntedBy = null;
      }
      if (robot.overwatchActive && tick >= robot.overwatchExpiresTick) {
        robot.overwatchActive = false;
      }
      robot.activeEffects = robot.activeEffects.filter(e => tick < e.expiresTick);
    }

    // Phase 1e: Decay old noise events
    world.noiseEvents = world.noiseEvents.filter(n => tick - n.tick <= NOISE_DECAY_TICKS);

    // Phase 2: Build sensor views (handled lazily by sensor gateway)
    // Phase 3 & 4: Execute robot programs and collect action intents
    const movementActions = new Map();
    const combatActions = new Map();
    const decisionTraces = new Map();

    for (const [robotId, vm] of robotVMs) {
      const robot = world.getRobot(robotId);
      if (!robot || !robot.alive) continue;

      // Overwatch prevents movement actions
      const inOverwatch = robot.overwatchActive && tick < robot.overwatchExpiresTick;

      // Execute tick handler
      const result = vm.executeEvent("tick", undefined, tick);

      if (result.budgetExceeded) {
        const stats = robotStats.get(robotId);
        stats.budgetExceeded++;
      }

      // Validate and categorize actions
      if (result.actions.length > 0) {
        const { movement, combat, utility } = categorizeActions(result.actions);

        // Build decision trace
        decisionTraces.set(robotId, {
          event: "tick",
          action: movement?.type ?? combat?.type ?? utility?.type ?? null,
          budgetUsed: result.instructionsUsed ?? 0,
        });

        // Process utility actions (place_mine, send_signal, mark_position, taunt, overwatch)
        if (utility) {
          resolveUtilityAction(world, robot, utility, robotStats);
        }

        // Store primary actions
        if (movement && !inOverwatch) {
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
      } else {
        decisionTraces.set(robotId, {
          event: "tick",
          action: null,
          budgetUsed: result.instructionsUsed ?? 0,
        });
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

    // Phase 7: Resolve attacks and abilities (+ generate noise)
    for (const robot of world.getAliveRobots()) {
      const combatAction = combatActions.get(robot.id);
      if (combatAction && ["attack", "fire_at", "burst_fire", "grenade", "use_ability", "shield"].includes(combatAction.type)) {
        resolveCombat(world, robot, combatAction);
        // Generate noise from combat
        if (combatAction.type === "grenade") {
          world.addNoise(robot.position, NOISE_GRENADE_RADIUS, robot.id, tick);
        } else if (["attack", "fire_at", "burst_fire"].includes(combatAction.type)) {
          world.addNoise(robot.position, NOISE_ATTACK_RADIUS, robot.id, tick);
        }
      }
      // Generate movement noise
      if (movementActions.has(robot.id)) {
        const moveType = movementActions.get(robot.id).type;
        if (moveType !== "stop" && moveType !== "turn_left" && moveType !== "turn_right") {
          world.addNoise(robot.position, NOISE_MOVE_RADIUS, robot.id, tick);
        }
      }
    }

    // Phase 7b: Detonate mines
    detonateMines(world);

    // Phase 7c: Collect pickups
    collectPickups(world, tick);

    // Phase 8: Apply damage/effects (projectiles, zones, depots, self-destruct)
    updateProjectiles(world);
    applyHealingZones(world);
    applyHazardZones(world);
    applyDepots(world);
    resolveSelfDestructs(world, tick);

    // Phase 8b: Update robot discovery memory for nearby map features
    updateDiscovery(world);

    // Phase 8c: Dispatch signals to allies
    dispatchSignals(world, robotVMs);

    // Update capture points
    for (const cp of world.controlPoints.values()) {
      // Gather which teams have robots in capture range
      const teamsInRange = new Set();
      for (const robot of world.getAliveRobots()) {
        if (distance(robot.position, cp.position) <= CAPTURE_RADIUS) {
          teamsInRange.add(robot.teamId);
        }
      }

      if (teamsInRange.size === 1) {
        // Uncontested — one team capturing
        const capturingTeam = [...teamsInRange][0];
        if (cp.owner !== capturingTeam) {
          // Reset progress if a different team starts capturing
          if (cp.capturingTeam !== undefined && cp.capturingTeam !== capturingTeam) {
            cp.captureProgress = 0;
          }
          cp.capturingTeam = capturingTeam;
          cp.captureProgress += CAPTURE_RATE;
          if (cp.captureProgress >= CAPTURE_WIN_THRESHOLD) {
            cp.owner = capturingTeam;
            cp.captureProgress = 0;
          }
        }
      } else if (teamsInRange.size > 1) {
        // Contested — progress decays toward zero
        cp.captureProgress = Math.max(0, cp.captureProgress - CAPTURE_RATE);
      } else {
        // No one in range — progress decays toward zero
        cp.captureProgress = Math.max(0, cp.captureProgress - CAPTURE_RATE * 0.5);
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
        // Also update the robot's own kill counter for the kills() sensor
        const killerRobot = world.getRobot(killedBy);
        if (killerRobot) killerRobot.kills = (killerRobot.kills ?? 0) + 1;
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

    // Phase 10: Write replay trace — merge movement and combat actions per robot
    const replayActions = new Map();
    for (const [robotId, action] of movementActions) {
      replayActions.set(robotId, { movement: action, combat: combatActions.get(robotId) ?? null });
    }
    for (const [robotId, action] of combatActions) {
      if (!replayActions.has(robotId)) {
        replayActions.set(robotId, { movement: null, combat: action });
      }
    }
    replayWriter.captureFrame(world, tickEvents, replayActions, decisionTraces);

    // Phase 11: Check win conditions
    const winResult = checkWinCondition(world);
    if (winResult.resolved) {
      winner = winResult.winner;
      reason = inSuddenDeath && winResult.reason === "elimination"
        ? "sudden_death_elimination"
        : winResult.reason;
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
  const rng = world.rng;

  // Spawn zones to keep clear
  const spawnZones = [
    vec2(w * 0.10, h * 0.50), // team 0
    vec2(w * 0.90, h * 0.50), // team 1
  ];

  function isTooCloseToSpawn(pos) {
    for (const sp of spawnZones) {
      if (distance(pos, sp) < SPAWN_CLEAR_RADIUS) return true;
    }
    return false;
  }

  function isTooCloseToExisting(pos, minDist, collection) {
    for (const item of collection.values()) {
      if (distance(pos, item.position) < minDist) return true;
    }
    return false;
  }

  // --- Control Points (2-3, spread across the map) ---
  const cpCount = rng.nextInt(2, 3);
  const cpSlots = [];
  // Divide map into horizontal slices for control points to ensure spread
  for (let i = 0; i < cpCount; i++) {
    const sliceWidth = w / cpCount;
    const minX = sliceWidth * i + sliceWidth * 0.2;
    const maxX = sliceWidth * (i + 1) - sliceWidth * 0.2;
    const x = rng.nextFloat(Math.max(12, minX), Math.min(w - 12, maxX));
    const y = rng.nextFloat(h * 0.25, h * 0.75);
    const pos = vec2(x, y);
    if (!isTooCloseToSpawn(pos)) {
      world.addControlPoint(pos, CAPTURE_RADIUS);
      cpSlots.push(pos);
    }
  }
  // Always ensure at least one center-ish control point
  if (cpSlots.length === 0) {
    const pos = vec2(w * 0.5, h * 0.5);
    world.addControlPoint(pos, CAPTURE_RADIUS);
    cpSlots.push(pos);
  }

  // --- Cover Objects (procedurally placed, varied sizes) ---
  const coverCount = rng.nextInt(MIN_COVER_COUNT, MAX_COVER_COUNT);
  for (let i = 0; i < coverCount; i++) {
    // Try up to 10 times to place without overlapping spawn zones
    for (let attempt = 0; attempt < 10; attempt++) {
      const x = rng.nextFloat(8, w - 8);
      const y = rng.nextFloat(8, h - 8);
      const pos = vec2(x, y);
      if (isTooCloseToSpawn(pos)) continue;
      if (isTooCloseToExisting(pos, 8, world.covers)) continue;

      // Varied shapes: narrow walls, wide barricades, pillars
      const shapeRoll = rng.nextFloat(0, 1);
      let cw, ch;
      if (shapeRoll < 0.3) {
        // Tall wall
        cw = rng.nextFloat(2, 4);
        ch = rng.nextFloat(8, 16);
      } else if (shapeRoll < 0.6) {
        // Wide barricade
        cw = rng.nextFloat(8, 14);
        ch = rng.nextFloat(2, 4);
      } else if (shapeRoll < 0.85) {
        // Medium block
        cw = rng.nextFloat(4, 8);
        ch = rng.nextFloat(4, 8);
      } else {
        // Pillar
        cw = rng.nextFloat(2, 4);
        ch = rng.nextFloat(2, 4);
      }

      const isDestructible = rng.nextFloat(0, 1) < DESTRUCTIBLE_COVER_RATIO;
      world.addCover(pos, cw, ch, isDestructible);
      break;
    }
  }

  // --- Healing Zones (scattered, never near spawns) ---
  const healCount = rng.nextInt(MIN_HEAL_ZONES, MAX_HEAL_ZONES);
  for (let i = 0; i < healCount; i++) {
    for (let attempt = 0; attempt < 15; attempt++) {
      const x = rng.nextFloat(12, w - 12);
      const y = rng.nextFloat(12, h - 12);
      const pos = vec2(x, y);
      if (isTooCloseToSpawn(pos)) continue;
      if (isTooCloseToExisting(pos, 12, world.healingZones)) continue;

      const radius = rng.nextFloat(HEAL_ZONE_RADIUS * 0.7, HEAL_ZONE_RADIUS * 1.3);
      world.addHealingZone(pos, radius, HEAL_ZONE_TICK_RATE);
      break;
    }
  }

  // --- Hazard Zones (dangerous areas to avoid or navigate around) ---
  const hazardCount = rng.nextInt(MIN_HAZARD_ZONES, MAX_HAZARD_ZONES);
  for (let i = 0; i < hazardCount; i++) {
    for (let attempt = 0; attempt < 15; attempt++) {
      const x = rng.nextFloat(15, w - 15);
      const y = rng.nextFloat(15, h - 15);
      const pos = vec2(x, y);
      if (isTooCloseToSpawn(pos)) continue;
      if (isTooCloseToExisting(pos, 10, world.hazards)) continue;
      // Don't overlap healing zones
      if (isTooCloseToExisting(pos, 8, world.healingZones)) continue;

      const radius = rng.nextFloat(HAZARD_ZONE_RADIUS * 0.8, HAZARD_ZONE_RADIUS * 1.4);
      world.addHazard(pos, radius, HAZARD_DAMAGE_PER_TICK);
      break;
    }
  }

  // --- Resupply Depots (symmetric, contestable map objectives) ---
  // Place DEPOT_COUNT depots in the neutral middle region, symmetrically
  // around the arena center so neither team starts with a free claim.
  for (let i = 0; i < DEPOT_COUNT; i++) {
    for (let attempt = 0; attempt < 20; attempt++) {
      // Split the horizontal midline into DEPOT_COUNT slots.
      const slot = (i + 0.5) / DEPOT_COUNT;
      const x = w * (0.35 + slot * 0.30); // between 35% and 65% horizontally
      const y = rng.nextFloat(h * 0.30, h * 0.70);
      const pos = vec2(x, y);
      if (isTooCloseToSpawn(pos)) continue;
      if (isTooCloseToExisting(pos, 10, world.depots)) continue;
      if (isTooCloseToExisting(pos, 6, world.hazards)) continue;
      world.addDepot(pos, DEPOT_RADIUS);
      break;
    }
  }
}

/** Any robot standing on a resupply depot gets ammo refilled and heat vented. */
function applyDepots(world) {
  for (const depot of world.depots.values()) {
    for (const robot of world.getAliveRobots()) {
      if (distance(robot.position, depot.position) <= depot.radius) {
        robot.ammo = Math.min(robot.maxAmmo ?? 0, (robot.ammo ?? 0) + DEPOT_AMMO_PER_TICK);
        robot.heat = Math.max(0, (robot.heat ?? 0) - DEPOT_HEAT_VENT_PER_TICK);
      }
    }
  }
}

function applyHealingZones(world) {
  for (const zone of world.healingZones.values()) {
    for (const robot of world.getAliveRobots()) {
      if (distance(robot.position, zone.position) <= zone.radius) {
        robot.health = Math.min(robot.maxHealth, robot.health + zone.healPerTick);
      }
    }
  }
}

function applyHazardZones(world) {
  for (const hazard of world.hazards.values()) {
    for (const robot of world.getAliveRobots()) {
      if (distance(robot.position, hazard.position) <= hazard.radius) {
        applyDamage(world, robot, hazard.damagePerTick, "hazard");
      }
    }
  }
}

/** Update each robot's discovery memory with nearby map features */
function updateDiscovery(world) {
  for (const robot of world.getAliveRobots()) {
    const visionRange = CLASS_STATS[robot.class]?.visionRange ?? DEFAULT_VISION_RANGE;

    for (const cover of world.covers.values()) {
      if (distance(robot.position, cover.position) <= visionRange) {
        robot.memory.discoveredCovers.set(cover.id, {
          id: cover.id,
          position: { x: cover.position.x, y: cover.position.y },
          width: cover.width,
          height: cover.height,
        });
      }
    }

    for (const zone of world.healingZones.values()) {
      if (distance(robot.position, zone.position) <= visionRange) {
        robot.memory.discoveredHealZones.set(zone.id, {
          id: zone.id,
          position: { x: zone.position.x, y: zone.position.y },
          radius: zone.radius,
        });
      }
    }

    for (const cp of world.controlPoints.values()) {
      if (distance(robot.position, cp.position) <= visionRange) {
        robot.memory.discoveredControlPoints.set(cp.id, {
          id: cp.id,
          position: { x: cp.position.x, y: cp.position.y },
          owner: cp.owner,
        });
      }
    }

    for (const hazard of world.hazards.values()) {
      if (distance(robot.position, hazard.position) <= visionRange) {
        robot.memory.discoveredHazards.set(hazard.id, {
          id: hazard.id,
          position: { x: hazard.position.x, y: hazard.position.y },
          radius: hazard.radius,
        });
      }
    }
  }
}

function getSpawnPositionForTeam(world, teamId, teamMemberIndex) {
  const { arenaWidth: w, arenaHeight: h } = world.config;
  const laneOffsets = [-12, -6, 0, 6, 12];
  const laneOffset = laneOffsets[teamMemberIndex % laneOffsets.length];
  const x = teamId % 2 === 0 ? w * 0.10 : w * 0.90;
  const y = Math.max(6, Math.min(h - 6, (h * 0.50) + laneOffset));
  return vec2(x, y);
}

/** Resolve utility actions (place_mine, send_signal, mark_position, taunt, overwatch) */
function resolveUtilityAction(world, robot, action, robotStats) {
  switch (action.type) {
    case "place_mine": {
      if (robot.minesPlaced >= MINE_MAX_PER_ROBOT) break;
      const cd = robot.cooldowns.get("mine") ?? 0;
      if (cd > 0) break;
      if (robot.energy < MINE_ENERGY_COST) break;
      world.addMine(robot.id, robot.teamId, robot.position, MINE_DAMAGE);
      robot.minesPlaced++;
      robot.cooldowns.set("mine", MINE_COOLDOWN);
      robot.energy = Math.max(0, robot.energy - MINE_ENERGY_COST);
      break;
    }
    case "send_signal": {
      if (world.currentTick < robot.signalCooldownTick) break;
      world.pendingSignals.push({
        senderId: robot.id,
        teamId: robot.teamId,
        data: action.data ?? null,
        position: { x: robot.position.x, y: robot.position.y },
        range: SIGNAL_RANGE,
        tick: world.currentTick,
      });
      robot.signalCooldownTick = world.currentTick + SIGNAL_COOLDOWN;
      break;
    }
    case "mark_position": {
      const name = action.data;
      if (!name || typeof name !== "string") break;
      robot.memory.waypoints.set(name, { x: robot.position.x, y: robot.position.y });
      break;
    }
    case "taunt": {
      const cd = robot.cooldowns.get("taunt") ?? 0;
      if (cd > 0) break;
      if (robot.energy < TAUNT_ENERGY_COST) break;
      // Taunt nearest visible enemy
      const enemies = [];
      for (const other of world.robots.values()) {
        if (!other.alive || other.teamId === robot.teamId) continue;
        if (distance(robot.position, other.position) <= TAUNT_RANGE) {
          enemies.push(other);
        }
      }
      if (enemies.length > 0) {
        enemies.sort((a, b) => distance(robot.position, a.position) - distance(robot.position, b.position));
        const target = enemies[0];
        target.tauntedBy = robot.id;
        target.tauntExpiresTick = world.currentTick + TAUNT_DURATION;
        robot.cooldowns.set("taunt", TAUNT_COOLDOWN);
        robot.energy = Math.max(0, robot.energy - TAUNT_ENERGY_COST);
      }
      break;
    }
    case "overwatch": {
      const cd = robot.cooldowns.get("overwatch") ?? 0;
      if (cd > 0) break;
      if (robot.energy < OVERWATCH_ENERGY_COST) break;
      robot.overwatchActive = true;
      robot.overwatchExpiresTick = world.currentTick + OVERWATCH_DURATION;
      robot.cooldowns.set("overwatch", OVERWATCH_COOLDOWN);
      robot.energy = Math.max(0, robot.energy - OVERWATCH_ENERGY_COST);
      break;
    }
    case "cloak": {
      // Toggle/start cloak. Hides robot from nearest_enemy/visible_enemies
      // except at very close range. Breaks on any offensive action or damage.
      const cd = robot.cooldowns.get("cloak") ?? 0;
      if (cd > 0) break;
      if (robot.energy < CLOAK_ENERGY_COST) break;
      robot.cloakActive = true;
      robot.cloakExpiresTick = world.currentTick + CLOAK_DURATION;
      robot.cooldowns.set("cloak", CLOAK_COOLDOWN);
      robot.energy = Math.max(0, robot.energy - CLOAK_ENERGY_COST);
      break;
    }
    case "self_destruct": {
      // Arm a detonation countdown. Only available below the HP threshold
      // so it's a desperation tool, not a spam weapon. Once armed it can't
      // be cancelled — this is what makes it dramatic.
      if (robot.selfDestructTick > 0) break;
      if (robot.health / robot.maxHealth > SELF_DESTRUCT_HEALTH_THRESHOLD) break;
      robot.selfDestructTick = world.currentTick + SELF_DESTRUCT_COUNTDOWN;
      break;
    }
  }
}

/** Detonate any armed self-destructs whose countdown has elapsed. */
function resolveSelfDestructs(world, tick) {
  for (const robot of world.getAliveRobots()) {
    // Robot may have been killed earlier in this same phase by another
    // detonation; skip stale entries so we don't detonate corpses.
    if (!robot.alive || robot.health <= 0) continue;
    if (!robot.selfDestructTick || robot.selfDestructTick > tick) continue;
    // Detonate: AoE damage to all robots (friendly fire included — sacrifice play)
    const center = robot.position;
    for (const other of world.getAliveRobots()) {
      if (other.id === robot.id) continue;
      if (distance(other.position, center) <= SELF_DESTRUCT_RADIUS) {
        applyDamage(world, other, SELF_DESTRUCT_DAMAGE, robot.id);
      }
    }
    // Also damage nearby destructible cover
    const coversToRemove = [];
    for (const [coverId, cover] of world.covers) {
      if (!cover.destructible) continue;
      if (distance(cover.position, center) <= SELF_DESTRUCT_RADIUS) {
        cover.health -= SELF_DESTRUCT_DAMAGE;
        if (cover.health <= 0) coversToRemove.push(coverId);
      }
    }
    for (const id of coversToRemove) world.covers.delete(id);
    // Finally destroy the self-destructing robot.
    applyDamage(world, robot, robot.health + 1, robot.id);
    robot.selfDestructTick = 0;
  }
}

/** Detonate mines when enemies step on them */
function detonateMines(world) {
  const toRemove = [];
  for (const [id, mine] of world.mines) {
    for (const robot of world.getAliveRobots()) {
      if (robot.teamId === mine.teamId) continue;
      if (distance(robot.position, mine.position) <= MINE_TRIGGER_RADIUS) {
        applyDamage(world, robot, mine.damage, mine.ownerId);
        toRemove.push(id);
        break;
      }
    }
  }
  for (const id of toRemove) {
    world.mines.delete(id);
  }
}

/** Check if robots are standing on pickups and apply effects */
function collectPickups(world, tick) {
  const toRemove = [];
  for (const [id, pickup] of world.pickups) {
    if (pickup.collected) continue;
    for (const robot of world.getAliveRobots()) {
      if (distance(robot.position, pickup.position) <= PICKUP_COLLECT_RADIUS) {
        pickup.collected = true;
        toRemove.push(id);
        // Apply pickup effect
        switch (pickup.type) {
          case "energy":
            robot.energy = Math.min(robot.maxEnergy, robot.energy + PICKUP_ENERGY_RESTORE);
            break;
          case "speed":
          case "damage":
          case "vision":
            robot.activeEffects.push({ type: pickup.type, expiresTick: tick + PICKUP_EFFECT_DURATION });
            break;
        }
        break;
      }
    }
  }
  for (const id of toRemove) {
    world.pickups.delete(id);
  }
}

/** Spawn a random pickup at a random location */
function spawnRandomPickup(world) {
  if (world.pickups.size >= PICKUP_MAX_ACTIVE) return;
  const { arenaWidth: w, arenaHeight: h } = world.config;
  const types = ["energy", "speed", "damage", "vision"];
  const type = types[world.rng.nextInt(0, types.length - 1)];
  const x = world.rng.nextFloat(10, w - 10);
  const y = world.rng.nextFloat(10, h - 10);
  world.addPickup({ x, y }, type);
}

/** Dispatch pending signals to ally robots as signal_received events */
function dispatchSignals(world, robotVMs) {
  for (const signal of world.pendingSignals) {
    for (const robot of world.getAliveRobots()) {
      if (robot.teamId !== signal.teamId) continue;
      if (robot.id === signal.senderId) continue;
      if (distance(robot.position, signal.position) > signal.range) continue;
      world.emitEvent({
        type: "signal_received",
        tick: world.currentTick,
        robotId: robot.id,
        data: {
          senderId: signal.senderId,
          data: signal.data,
          senderPosition: signal.position,
        },
      });
    }
  }
  world.pendingSignals = [];
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
