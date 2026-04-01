// ============================================================================
// World State Model — All entities and simulation state
// ============================================================================

import { SeededRNG } from "../shared/prng.js";
import { vec2 } from "../shared/vec2.js";
import { ROBOT_BASE_HEALTH, ROBOT_BASE_ENERGY, CLASS_STATS } from "../shared/config.js";

let nextId = 0;
export function generateId(prefix) {
  return `${prefix}_${++nextId}`;
}

export function resetIdCounter() {
  nextId = 0;
}

export class World {
  robots = new Map();
  projectiles = new Map();
  controlPoints = new Map();
  resources = new Map();
  healingZones = new Map();
  covers = new Map();
  hazards = new Map();
  currentTick = 0;
  config;
  rng;
  pendingEvents = [];

  constructor(config) {
    this.config = config;
    this.rng = new SeededRNG(config.seed);
  }

  spawnRobot(
    name,
    robotClass,
    teamId,
    programId,
    position,
    squadIndex = 0,
    squadSize = 1,
    squadRole = null,
  ) {
    const id = generateId("robot");
    const stats = CLASS_STATS[robotClass] ?? {
      health: ROBOT_BASE_HEALTH,
      energy: ROBOT_BASE_ENERGY,
      moveSpeed: 2.0,
      attackDamage: 10,
      attackRange: 5.0,
      attackCooldown: 5,
    };

    // Spawn at given position or random position within arena bounds
    const pos = position ?? vec2(
      this.rng.nextFloat(5, this.config.arenaWidth - 5),
      this.rng.nextFloat(5, this.config.arenaHeight - 5),
    );

    const robot = {
      id,
      name,
      class: robotClass,
      position: pos,
      velocity: vec2(0, 0),
      heading: vec2(1, 0),
      health: stats.health,
      maxHealth: stats.health,
      energy: stats.energy,
      maxEnergy: stats.energy,
      cooldowns: new Map(),
      memory: {
        lastSeenEnemy: null,
      },
      alive: true,
      teamId,
      programId,
      squadIndex,
      squadSize,
      squadRole,
    };

    this.robots.set(id, robot);
    return robot;
  }

  spawnProjectile(ownerId, position, velocity, damage, ttl) {
    const id = generateId("proj");
    const proj = { id, ownerId, position: { ...position }, velocity: { ...velocity }, damage, ttl };
    this.projectiles.set(id, proj);
    return proj;
  }

  addControlPoint(position, radius) {
    const id = generateId("cp");
    const cp = { id, position, radius, owner: null, captureProgress: 0 };
    this.controlPoints.set(id, cp);
    return cp;
  }

  addCover(position, width, height) {
    const id = generateId("cover");
    const cover = { id, position, width, height };
    this.covers.set(id, cover);
    return cover;
  }

  addHealingZone(position, radius, healPerTick = 2) {
    const id = generateId("heal");
    const zone = { id, position, radius, healPerTick };
    this.healingZones.set(id, zone);
    return zone;
  }

  getRobot(id) {
    return this.robots.get(id);
  }

  getAliveRobots() {
    return [...this.robots.values()].filter(r => r.alive);
  }

  getAliveRobotsByTeam(teamId) {
    return this.getAliveRobots().filter(r => r.teamId === teamId);
  }

  getTeamIds() {
    const teams = new Set();
    for (const r of this.robots.values()) {
      teams.add(r.teamId);
    }
    return [...teams];
  }

  emitEvent(event) {
    this.pendingEvents.push(event);
  }

  drainEvents() {
    const events = this.pendingEvents;
    this.pendingEvents = [];
    return events;
  }
}
