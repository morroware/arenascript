// ============================================================================
// Game Balance Constants & Configuration
// ============================================================================
export const ENGINE_VERSION = "0.1.0";
export const LANGUAGE_VERSION = "1.0";
// --- Arena ---
export const ARENA_WIDTH = 140;
export const ARENA_HEIGHT = 140;
// --- Tick ---
export const TICK_RATE = 30; // ticks per second
export const MAX_TICKS = 3000; // 100 seconds
// --- Robot Defaults ---
export const ROBOT_BASE_HEALTH = 100;
export const ROBOT_BASE_ENERGY = 100;
export const ROBOT_MOVE_SPEED = 2.0; // units per tick
export const ROBOT_RADIUS = 1.0;
// --- Combat ---
export const ATTACK_DAMAGE = 10;
export const ATTACK_RANGE = 5.0;
export const ATTACK_COOLDOWN = 5; // ticks
export const ATTACK_ENERGY_COST = 10;
export const FIRE_AT_DAMAGE = 8;
export const FIRE_AT_RANGE = 15.0;
export const FIRE_AT_COOLDOWN = 8;
export const BURST_FIRE_DAMAGE = 5;
export const BURST_FIRE_RANGE = 12.0;
export const BURST_FIRE_COOLDOWN = 10;
export const GRENADE_DAMAGE = 16;
export const GRENADE_RADIUS = 3.5;
export const GRENADE_RANGE = 16.0;
export const GRENADE_COOLDOWN = 18;
export const BURST_FIRE_ENERGY_COST = 15;
export const GRENADE_ENERGY_COST = 20;
export const SHIELD_ENERGY_COST = 15;
export const PROJECTILE_SPEED = 4.0;
export const PROJECTILE_TTL = 20; // ticks
// --- Perception ---
export const LOS_RANGE = 150.0;
export const DEFAULT_VISION_RANGE = 35.0;
export const LOW_HEALTH_THRESHOLD = 25;
export const ACTIVE_SCAN_RANGE = 22.0;
export const ACTIVE_SCAN_MEMORY_TICKS = 45;
// --- Abilities ---
export const SHIELD_DURATION = 3; // ticks
export const SHIELD_COOLDOWN = 30;
export const DASH_DISTANCE = 5.0;
export const DASH_COOLDOWN = 20;
// --- Budget ---
export const BUDGET_INSTRUCTIONS = 1000;
export const BUDGET_FUNCTION_CALLS = 50;
export const BUDGET_SENSOR_CALLS = 30;
export const BUDGET_MEMORY_OPS = 200;
// --- Capture ---
export const CAPTURE_RATE = 0.02; // per tick while in range
export const CAPTURE_RADIUS = 3.0;
export const CAPTURE_WIN_THRESHOLD = 1.0;
export const HEAL_ZONE_RADIUS = 4.0;
export const HEAL_ZONE_TICK_RATE = 2;
// --- Hazards ---
export const HAZARD_ZONE_RADIUS = 3.5;
export const HAZARD_DAMAGE_PER_TICK = 1;
// --- Procedural Arena ---
export const MIN_COVER_COUNT = 6;
export const MAX_COVER_COUNT = 12;
export const MIN_HEAL_ZONES = 2;
export const MAX_HEAL_ZONES = 4;
export const MIN_HAZARD_ZONES = 1;
export const MAX_HAZARD_ZONES = 3;
export const SPAWN_CLEAR_RADIUS = 15; // keep area around spawns clear of obstacles
// --- Ranked ---
export const INITIAL_ELO = 1000;
export const ELO_K_FACTOR = 32;
export const ELO_K_FACTOR_HIGH = 16; // for ratings > 2400
export const RANK_THRESHOLDS = {
    bronze: 0,
    silver: 1000,
    gold: 1200,
    platinum: 1400,
    diamond: 1600,
    champion: 1800,
};
export const CLASS_STATS = {
    brawler: {
        health: 120,
        energy: 80,
        moveSpeed: 2.2,
        attackDamage: 14,
        attackRange: 3.5,
        attackCooldown: 4,
        visionRange: 28.0,
    },
    ranger: {
        health: 80,
        energy: 100,
        moveSpeed: 2.0,
        attackDamage: 10,
        attackRange: 8.0,
        attackCooldown: 6,
        visionRange: 40.0,
    },
    tank: {
        health: 150,
        energy: 60,
        moveSpeed: 1.5,
        attackDamage: 8,
        attackRange: 4.0,
        attackCooldown: 5,
        visionRange: 24.0,
    },
    support: {
        health: 90,
        energy: 120,
        moveSpeed: 1.8,
        attackDamage: 6,
        attackRange: 6.0,
        attackCooldown: 7,
        visionRange: 32.0,
    },
};
