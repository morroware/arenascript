<?php
// ============================================================================
// Game Balance Constants & Configuration
// ============================================================================

const ENGINE_VERSION = '0.1.0';
const LANGUAGE_VERSION = '1.0';

// --- Arena ---
const ARENA_WIDTH = 100;
const ARENA_HEIGHT = 100;

// --- Tick ---
const TICK_RATE = 30; // ticks per second
const MAX_TICKS = 3000; // 100 seconds

// --- Robot Defaults ---
const ROBOT_BASE_HEALTH = 100;
const ROBOT_BASE_ENERGY = 100;
const ROBOT_MOVE_SPEED = 2.0; // units per tick
const ROBOT_RADIUS = 1.0;

// --- Combat ---
const ATTACK_DAMAGE = 10;
const ATTACK_RANGE = 5.0;
const ATTACK_COOLDOWN = 5; // ticks
const ATTACK_ENERGY_COST = 10;

const FIRE_AT_DAMAGE = 8;
const FIRE_AT_RANGE = 15.0;
const FIRE_AT_COOLDOWN = 8;
const PROJECTILE_SPEED = 4.0;
const PROJECTILE_TTL = 20; // ticks

// --- Perception ---
const LOS_RANGE = 150.0;
const LOW_HEALTH_THRESHOLD = 25;

// --- Abilities ---
const SHIELD_DURATION = 3; // ticks
const SHIELD_COOLDOWN = 30;
const DASH_DISTANCE = 5.0;
const DASH_COOLDOWN = 20;

// --- Budget ---
const BUDGET_INSTRUCTIONS = 1000;
const BUDGET_FUNCTION_CALLS = 50;
const BUDGET_SENSOR_CALLS = 30;
const BUDGET_MEMORY_OPS = 200;

// --- Capture ---
const CAPTURE_RATE = 0.02; // per tick while in range
const CAPTURE_RADIUS = 3.0;
const CAPTURE_WIN_THRESHOLD = 1.0;

// --- Ranked ---
const INITIAL_ELO = 1000;
const ELO_K_FACTOR = 32;
const ELO_K_FACTOR_HIGH = 16; // for ratings > 2400

const RANK_THRESHOLDS = [
    'bronze'   => 0,
    'silver'   => 1000,
    'gold'     => 1200,
    'platinum' => 1400,
    'diamond'  => 1600,
    'champion' => 1800,
];

// --- Robot Class Stats ---
const CLASS_STATS = [
    'brawler' => [
        'health'         => 120,
        'energy'         => 80,
        'moveSpeed'      => 2.2,
        'attackDamage'   => 14,
        'attackRange'    => 3.5,
        'attackCooldown' => 4,
    ],
    'ranger' => [
        'health'         => 80,
        'energy'         => 100,
        'moveSpeed'      => 2.0,
        'attackDamage'   => 10,
        'attackRange'    => 8.0,
        'attackCooldown' => 6,
    ],
    'tank' => [
        'health'         => 150,
        'energy'         => 60,
        'moveSpeed'      => 1.5,
        'attackDamage'   => 8,
        'attackRange'    => 4.0,
        'attackCooldown' => 5,
    ],
    'support' => [
        'health'         => 90,
        'energy'         => 120,
        'moveSpeed'      => 1.8,
        'attackDamage'   => 6,
        'attackRange'    => 6.0,
        'attackCooldown' => 7,
    ],
];
