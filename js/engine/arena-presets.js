// ============================================================================
// Arena Presets — 5 hand-crafted competitive arenas
// ============================================================================
//
// Each preset is a fixed, symmetric layout designed with a unique tactical
// identity so that bot authors can tune strategies per arena:
//
//   crucible    — Balanced, symmetric, the default for learning.
//   inferno     — Hazard-heavy; rewards aggressive positioning and vent timing.
//   fortress    — Dense cover; rewards stealth, LoS management, and flanks.
//   gauntlet    — Linear corridor; rewards breakthroughs and fire discipline.
//   plains      — Wide open; rewards long-range combat and map control.
//
// All arenas are authored for a 140×140 playfield with team spawns at
// (14, 70) and (126, 70) (the defaults used by the tick scheduler). Every
// layout is mirror-symmetric along the vertical axis for strict fairness.
// Any feature is allowed as long as it keeps a ≥15 unit distance from both
// spawns (SPAWN_CLEAR_RADIUS).
//
// Cover shape tags:
//   "wall"     — tall thin vertical barrier, great for side cover
//   "barricade"— wide thin horizontal barrier, blocks line-of-sight front/back
//   "block"    — boxy medium cover, good omnidirectional
//   "pillar"   — small point cover
//
// Features missing from a given preset should simply be omitted or empty.
// ============================================================================

import {
  CAPTURE_RADIUS,
  HEAL_ZONE_RADIUS,
  HEAL_ZONE_TICK_RATE,
  HAZARD_ZONE_RADIUS,
  HAZARD_DAMAGE_PER_TICK,
  DEPOT_RADIUS,
} from "../shared/config.js";

// Default preset if none specified
export const DEFAULT_ARENA_ID = "crucible";

// Shorthand cover helper: produces a cover record from (x, y, w, h, destructible).
function cover(x, y, w, h, destructible = false) {
  return { x, y, w, h, destructible };
}

// Shorthand control point / zone / depot helpers
function cp(x, y) { return { x, y, radius: CAPTURE_RADIUS }; }
function heal(x, y, radius = HEAL_ZONE_RADIUS) {
  return { x, y, radius, healPerTick: HEAL_ZONE_TICK_RATE };
}
function hazard(x, y, radius = HAZARD_ZONE_RADIUS) {
  return { x, y, radius, damagePerTick: HAZARD_DAMAGE_PER_TICK };
}
function depot(x, y, radius = DEPOT_RADIUS) { return { x, y, radius }; }

// ============================================================================
// Arena 1: THE CRUCIBLE — Balanced symmetric classic
// ============================================================================
// Three horizontal control points, symmetric lane covers, two safe heal zones
// in opposite corners, two contested depots on diagonal. No hazards. The
// default pick and the training ground for new bot authors.
const CRUCIBLE = {
  id: "crucible",
  name: "The Crucible",
  tagline: "Balanced · 3 CPs · No hazards",
  description:
    "A fair, symmetric arena with three horizontal control points, mirrored cover "
    + "lanes, and two diagonal depots. The default competitive map — no tricks, "
    + "just positioning, resource management, and combat skill.",
  difficulty: "Standard",
  recommendedModes: ["duel_1v1", "squad_2v2"],
  covers: [
    // Side wall pillars near each flank control point
    cover(35, 55, 3, 10),
    cover(35, 85, 3, 10),
    cover(105, 55, 3, 10),
    cover(105, 85, 3, 10),
    // Horizontal barricades north/south of center — create flanking choices
    cover(70, 40, 14, 3),
    cover(70, 100, 14, 3),
    // Destructible central blocks flanking the center CP
    cover(55, 70, 4, 4, true),
    cover(85, 70, 4, 4, true),
  ],
  controlPoints: [cp(35, 70), cp(70, 70), cp(105, 70)],
  healingZones: [heal(45, 25), heal(95, 115)],
  hazards: [],
  depots: [depot(55, 115), depot(85, 25)],
};

// ============================================================================
// Arena 2: INFERNO — Hazard-heavy aggressive
// ============================================================================
// A hot zone of acid pools forces mobility. Sparse cover, central high-value
// control point, compensating heal zones. Rewards bots that manage heat well
// and rotate around the hazards.
const INFERNO = {
  id: "inferno",
  name: "Inferno",
  tagline: "Hazardous · 3 CPs · Mobility focused",
  description:
    "Acid pools carve up the battlefield. Sparse cover and a high-value center "
    + "control point punish static play while heal zones near each spawn reward "
    + "bots that can rotate between safety and aggression.",
  difficulty: "Advanced",
  recommendedModes: ["duel_1v1", "squad_2v2"],
  covers: [
    cover(70, 40, 6, 3),
    cover(70, 100, 6, 3),
    cover(45, 70, 3, 3, true),
    cover(95, 70, 3, 3, true),
    cover(33, 45, 4, 4),
    cover(107, 95, 4, 4),
    cover(33, 95, 4, 4),
    cover(107, 45, 4, 4),
  ],
  controlPoints: [cp(70, 70), cp(70, 35), cp(70, 105)],
  healingZones: [heal(35, 20, 4.5), heal(105, 120, 4.5), heal(35, 120, 3.5), heal(105, 20, 3.5)],
  hazards: [
    hazard(55, 55, 4),
    hazard(85, 85, 4),
    hazard(55, 85, 4),
    hazard(85, 55, 4),
    hazard(70, 70, 3), // small center hazard overlapping center CP (high risk/reward)
  ],
  depots: [depot(70, 25), depot(70, 115)],
};

// ============================================================================
// Arena 3: FORTRESS — Dense cover corridors
// ============================================================================
// A labyrinth of cover walls. Narrow lanes, many flanking options, stealth
// plays shine. Two defensible control points on the flanks, two safe heal
// zones, two central depots. No hazards — pure positioning warfare.
const FORTRESS = {
  id: "fortress",
  name: "Fortress",
  tagline: "Dense cover · 2 CPs · Stealth friendly",
  description:
    "A labyrinth of walls and barricades creates overlapping sightlines and "
    + "flanking routes. Defensible flank control points, no hazards, and dense "
    + "cover reward patient positioning, cloak, and overwatch play.",
  difficulty: "Tactical",
  recommendedModes: ["duel_1v1", "squad_2v2"],
  covers: [
    // Outer perimeter walls
    cover(40, 40, 3, 12),
    cover(40, 100, 3, 12),
    cover(100, 40, 3, 12),
    cover(100, 100, 3, 12),
    // Middle barricades forming a grid of lanes
    cover(55, 55, 10, 2),
    cover(55, 85, 10, 2),
    cover(85, 55, 10, 2),
    cover(85, 85, 10, 2),
    // Central vertical walls protecting mid corridor
    cover(70, 30, 3, 8),
    cover(70, 110, 3, 8),
    // Destructible inner blocks near the flanks
    cover(30, 50, 4, 4, true),
    cover(30, 90, 4, 4, true),
    cover(110, 50, 4, 4, true),
    cover(110, 90, 4, 4, true),
    // Small pillars at mid — partial sightline breaks
    cover(62, 70, 3, 3),
    cover(78, 70, 3, 3),
  ],
  controlPoints: [cp(40, 70), cp(100, 70)],
  healingZones: [heal(30, 30), heal(110, 110)],
  hazards: [],
  depots: [depot(70, 50), depot(70, 90)],
};

// ============================================================================
// Arena 4: THE GAUNTLET — Linear corridor chokepoints
// ============================================================================
// Horizontal lanes separated by long barricades push bots into the central
// corridor. Hazards at the choke points punish reckless advances. Rewards
// breakthroughs, grenades, and coordinated pushes.
const GAUNTLET = {
  id: "gauntlet",
  name: "The Gauntlet",
  tagline: "Linear · 3 CPs · Chokepoint hazards",
  description:
    "Long barricades funnel combat into the central corridor. Choke-point "
    + "hazards and a hard-earned middle control point reward breakthrough tactics, "
    + "area denial, and well-timed grenade play.",
  difficulty: "Tactical",
  recommendedModes: ["duel_1v1", "squad_2v2"],
  covers: [
    // Long horizontal barricades separating top/middle/bottom lanes
    cover(50, 45, 16, 3),
    cover(90, 45, 16, 3),
    cover(50, 95, 16, 3),
    cover(90, 95, 16, 3),
    // Central corridor walls (north/south of center)
    cover(70, 20, 4, 6),
    cover(70, 120, 4, 6),
    // Small cover flanking the center CP — reachable from both top/bottom lanes
    cover(55, 70, 3, 3, true),
    cover(85, 70, 3, 3, true),
    // Flank depots need some cover nearby
    cover(32, 30, 4, 4),
    cover(108, 110, 4, 4),
    cover(32, 110, 4, 4),
    cover(108, 30, 4, 4),
  ],
  controlPoints: [cp(40, 70), cp(70, 70), cp(100, 70)],
  healingZones: [heal(30, 30), heal(110, 110)],
  hazards: [
    hazard(70, 58, 3.5),
    hazard(70, 82, 3.5),
  ],
  depots: [depot(70, 30), depot(70, 110)],
};

// ============================================================================
// Arena 5: OPEN PLAINS — Wide open long-range
// ============================================================================
// Minimal cover, four quadrant control points, one central healing oasis.
// Rewards long-range weapons (fire_heavy), vision bonuses, and map control.
const PLAINS = {
  id: "plains",
  name: "Open Plains",
  tagline: "Wide open · 4 CPs · Long-range",
  description:
    "A wide open battlefield with only four pillars of cover and four quadrant "
    + "control points. A central healing oasis becomes the contested prize. "
    + "Rewards long-range combat, vision control, and fast mobility.",
  difficulty: "Advanced",
  recommendedModes: ["duel_1v1", "squad_2v2"],
  covers: [
    cover(50, 50, 3, 3),
    cover(90, 50, 3, 3),
    cover(50, 90, 3, 3),
    cover(90, 90, 3, 3),
    // Two central destructible blocks near the heal oasis to provide minimal LoS breaks
    cover(66, 70, 3, 3, true),
    cover(74, 70, 3, 3, true),
  ],
  controlPoints: [cp(35, 35), cp(105, 35), cp(35, 105), cp(105, 105)],
  healingZones: [heal(70, 70, 5.5)],
  hazards: [],
  depots: [depot(70, 30), depot(70, 110)],
};

// ============================================================================
// Registry + accessors
// ============================================================================

export const ARENA_PRESETS = {
  [CRUCIBLE.id]: CRUCIBLE,
  [INFERNO.id]: INFERNO,
  [FORTRESS.id]: FORTRESS,
  [GAUNTLET.id]: GAUNTLET,
  [PLAINS.id]: PLAINS,
};

/** Ordered list used by UI so the selector is stable and deterministic. */
export const ARENA_PRESET_ORDER = [
  "crucible",
  "inferno",
  "fortress",
  "gauntlet",
  "plains",
];

/**
 * Returns the preset object for a given id, or the default preset if the
 * id is unknown/missing. Never returns null so callers don't have to
 * null-check.
 */
export function getArenaPreset(id) {
  if (id && Object.prototype.hasOwnProperty.call(ARENA_PRESETS, id)) {
    return ARENA_PRESETS[id];
  }
  return ARENA_PRESETS[DEFAULT_ARENA_ID];
}

/** True if the given id refers to a known arena preset. */
export function isKnownArenaId(id) {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(ARENA_PRESETS, id);
}
