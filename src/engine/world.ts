// ============================================================================
// World State Model — All entities and simulation state
// ============================================================================

import type {
  RobotState, Projectile, ControlPoint, ResourceNode,
  CoverObject, Hazard, EntityId, Vec2, MatchConfig, GameEvent,
} from "../shared/types.js";
import { SeededRNG } from "../shared/prng.js";
import { vec2 } from "../shared/vec2.js";
import { ROBOT_BASE_HEALTH, ROBOT_BASE_ENERGY, CLASS_STATS } from "../shared/config.js";
import type { RobotClass } from "../shared/types.js";

let nextId = 0;
export function generateId(prefix: string): EntityId {
  return `${prefix}_${++nextId}`;
}

export function resetIdCounter(): void {
  nextId = 0;
}

export class World {
  robots: Map<EntityId, RobotState> = new Map();
  projectiles: Map<EntityId, Projectile> = new Map();
  controlPoints: Map<EntityId, ControlPoint> = new Map();
  resources: Map<EntityId, ResourceNode> = new Map();
  covers: Map<EntityId, CoverObject> = new Map();
  hazards: Map<EntityId, Hazard> = new Map();
  currentTick = 0;
  config: MatchConfig;
  rng: SeededRNG;
  pendingEvents: GameEvent[] = [];

  constructor(config: MatchConfig) {
    this.config = config;
    this.rng = new SeededRNG(config.seed);
  }

  spawnRobot(
    name: string,
    robotClass: RobotClass,
    teamId: number,
    programId: string,
    position?: Vec2,
  ): RobotState {
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

    const robot: RobotState = {
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
      alive: true,
      teamId,
      programId,
    };

    this.robots.set(id, robot);
    return robot;
  }

  spawnProjectile(ownerId: EntityId, position: Vec2, velocity: Vec2, damage: number, ttl: number): Projectile {
    const id = generateId("proj");
    const proj: Projectile = { id, ownerId, position: { ...position }, velocity: { ...velocity }, damage, ttl };
    this.projectiles.set(id, proj);
    return proj;
  }

  addControlPoint(position: Vec2, radius: number): ControlPoint {
    const id = generateId("cp");
    const cp: ControlPoint = { id, position, radius, owner: null, captureProgress: 0 };
    this.controlPoints.set(id, cp);
    return cp;
  }

  addCover(position: Vec2, width: number, height: number): CoverObject {
    const id = generateId("cover");
    const cover: CoverObject = { id, position, width, height };
    this.covers.set(id, cover);
    return cover;
  }

  getRobot(id: EntityId): RobotState | undefined {
    return this.robots.get(id);
  }

  getAliveRobots(): RobotState[] {
    return [...this.robots.values()].filter(r => r.alive);
  }

  getAliveRobotsByTeam(teamId: number): RobotState[] {
    return this.getAliveRobots().filter(r => r.teamId === teamId);
  }

  getTeamIds(): number[] {
    const teams = new Set<number>();
    for (const r of this.robots.values()) {
      teams.add(r.teamId);
    }
    return [...teams];
  }

  emitEvent(event: GameEvent): void {
    this.pendingEvents.push(event);
  }

  drainEvents(): GameEvent[] {
    const events = this.pendingEvents;
    this.pendingEvents = [];
    return events;
  }
}
