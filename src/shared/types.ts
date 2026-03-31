// ============================================================================
// ArenaScript — Core Type Definitions
// ============================================================================

/** 2D position in arena space */
export interface Vec2 {
  x: number;
  y: number;
}

/** Unique identifier for entities */
export type EntityId = string;

/** Robot class determines capabilities */
export type RobotClass = "brawler" | "ranger" | "tank" | "support";

/** Direction as a normalized vector */
export type Direction = Vec2;

// --- World Entities ---

export interface RobotState {
  id: EntityId;
  name: string;
  class: RobotClass;
  position: Vec2;
  velocity: Vec2;
  heading: Direction;
  health: number;
  maxHealth: number;
  energy: number;
  maxEnergy: number;
  cooldowns: Map<string, number>;
  alive: boolean;
  teamId: number;
  programId: string;
}

export interface Projectile {
  id: EntityId;
  ownerId: EntityId;
  position: Vec2;
  velocity: Vec2;
  damage: number;
  ttl: number;
}

export interface ControlPoint {
  id: EntityId;
  position: Vec2;
  radius: number;
  owner: number | null; // teamId or null
  captureProgress: number;
}

export interface ResourceNode {
  id: EntityId;
  position: Vec2;
  amount: number;
}

export interface CoverObject {
  id: EntityId;
  position: Vec2;
  width: number;
  height: number;
}

export interface Hazard {
  id: EntityId;
  position: Vec2;
  radius: number;
  damage: number;
}

// --- Action Intents ---

export type ActionType =
  | "move_to"
  | "move_toward"
  | "strafe_left"
  | "strafe_right"
  | "stop"
  | "attack"
  | "fire_at"
  | "use_ability"
  | "shield"
  | "retreat"
  | "mark_target"
  | "capture"
  | "ping";

export interface ActionIntent {
  robotId: EntityId;
  type: ActionType;
  target?: Vec2 | EntityId;
  ability?: string;
}

// --- Events ---

export type GameEventType =
  | "spawn"
  | "tick"
  | "damaged"
  | "enemy_seen"
  | "enemy_lost"
  | "cooldown_ready"
  | "low_health"
  | "destroyed";

export interface GameEvent {
  type: GameEventType;
  tick: number;
  robotId: EntityId;
  data?: Record<string, unknown>;
}

// --- Match ---

export type MatchStatus = "pending" | "running" | "completed" | "cancelled";
export type MatchMode = "1v1_ranked" | "1v1_unranked" | "2v2" | "ffa" | "tournament";

export interface MatchConfig {
  mode: MatchMode;
  arenaWidth: number;
  arenaHeight: number;
  maxTicks: number;
  tickRate: number;
  seed: number;
}

export interface MatchRecord {
  matchId: string;
  config: MatchConfig;
  participants: MatchParticipant[];
  status: MatchStatus;
  winner: number | null; // teamId
  startedAt: number;
  endedAt?: number;
  replayId?: string;
  engineVersion: string;
}

export interface MatchParticipant {
  robotId: EntityId;
  programId: string;
  teamId: number;
  playerId: string;
  eloAtStart: number;
}

// --- Ranking ---

export type RankTier =
  | "bronze"
  | "silver"
  | "gold"
  | "platinum"
  | "diamond"
  | "champion";

export interface PlayerRating {
  playerId: string;
  elo: number;
  tier: RankTier;
  wins: number;
  losses: number;
  draws: number;
  matchHistory: string[]; // matchIds
}

// --- Replay ---

export interface ReplayFrame {
  tick: number;
  robots: Array<{
    id: EntityId;
    position: Vec2;
    health: number;
    energy: number;
    action?: ActionIntent;
  }>;
  projectiles: Array<{ id: EntityId; position: Vec2 }>;
  events: GameEvent[];
}

export interface ReplayData {
  metadata: {
    matchId: string;
    engineVersion: string;
    seed: number;
    tickCount: number;
    participants: MatchParticipant[];
  };
  frames: ReplayFrame[];
}

// --- Tournament ---

export type TournamentFormat = "single_elimination" | "round_robin" | "swiss";
export type TournamentStatus = "registration" | "in_progress" | "completed";

export interface Tournament {
  id: string;
  name: string;
  format: TournamentFormat;
  status: TournamentStatus;
  participants: TournamentParticipant[];
  rounds: TournamentRound[];
  createdAt: number;
}

export interface TournamentParticipant {
  playerId: string;
  programId: string;
  seed: number;
  wins: number;
  losses: number;
  eliminated: boolean;
}

export interface TournamentRound {
  roundNumber: number;
  matches: TournamentMatch[];
  completed: boolean;
}

export interface TournamentMatch {
  matchId: string;
  participant1Index: number;
  participant2Index: number;
  winner?: number; // participant index
  completed: boolean;
}

// --- Compiler / Program ---

export interface CompiledProgram {
  programId: string;
  sourceHash: string;
  languageVersion: string;
  robotName: string;
  robotClass: RobotClass;
  bytecode: Uint8Array;
  stateSlots: StateSlot[];
  eventHandlers: Map<GameEventType, number>; // event -> bytecode offset
  functions: Map<string, number>; // name -> bytecode offset
}

export interface StateSlot {
  name: string;
  type: string;
  initialValue: unknown;
}
