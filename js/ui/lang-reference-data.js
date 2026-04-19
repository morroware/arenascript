// ============================================================================
// Language Reference — Curated docs for the in-app reference drawer.
// ============================================================================
//
// Structured data — each section has a label (shown as a pill) and a list
// of entries. Keep descriptions tight; the drawer is meant for quick lookup
// while coding, not a tutorial. For a deep dive, docs/language-reference.md
// has the full narrative.
// ============================================================================

export const LANG_REFERENCE = [
  {
    id: "syntax",
    label: "Syntax",
    entries: [
      {
        name: "robot \"Name\" version \"1.0\"",
        sig: "top of file",
        desc: "Required. Declares the bot's display name and a version string. Both are free-form strings.",
        example: `robot "MyBot" version "1.0"`,
      },
      {
        name: "meta { ... }",
        sig: "metadata block",
        desc: "Author + class. `class` must be brawler, ranger, tank, or support.",
        example: `meta {\n  author: "Me"\n  class: "ranger"\n}`,
      },
      {
        name: "const { ... }",
        sig: "compile-time constants",
        desc: "Immutable numeric/string values evaluated at compile time. Can reference earlier consts.",
        example: `const {\n  ENGAGE_RANGE = 8\n  PANIC_HP = 30\n}`,
      },
      {
        name: "state { ... }",
        sig: "persistent per-bot state",
        desc: "Typed slots that survive across ticks. Mutate with `set`. Types: number, boolean, string, id, vector, position, list<T>.",
        example: `state {\n  mode: string = "hunt"\n  dodge_until: number = 0\n}`,
      },
      {
        name: "squad { size: N, roles: [...] }",
        sig: "squad composition",
        desc: "Requests multiple instances per participant (1-5) with named roles for coordination.",
        example: `squad {\n  size: 3\n  roles: "leader", "wing", "wing"\n}`,
      },
      {
        name: "let / set",
        sig: "variable declaration + mutation",
        desc: "`let` declares a local. `set` reassigns a local OR a state variable. Constants are immutable.",
        example: `let d = distance_to(enemy.position)\nset mode = "fight"`,
      },
    ],
  },
  {
    id: "control",
    label: "Control flow",
    entries: [
      {
        name: "if / else if / else",
        sig: "conditional branching",
        desc: "All three branches supported. Conditions can use `and`, `or`, `not`.",
      },
      {
        name: "while cond { ... }",
        sig: "v1.1 — condition loop",
        desc: "Loops while `cond` is truthy. Use `break` / `continue` inside. Subject to the per-tick instruction budget.",
        example: `let i = 0\nwhile i < 5 {\n  if i == 3 { break }\n  set i = i + 1\n}`,
      },
      {
        name: "for x in list { ... }",
        sig: "bounded iteration",
        desc: "Iterates every element in a list returned by a sensor (visible_enemies(), scan_enemies(), etc.).",
        example: `for e in visible_enemies() {\n  if e.health < 30 { fire_at e.position }\n}`,
      },
      {
        name: "break / continue",
        sig: "v1.1 — loop control",
        desc: "Immediately leave a loop (break) or skip to the next iteration (continue). Only valid inside for/while.",
      },
      {
        name: "after N { ... }",
        sig: "one-shot delay",
        desc: "Run the body once after N ticks have elapsed.",
      },
      {
        name: "every N { ... }",
        sig: "recurring timer",
        desc: "Run the body every N ticks, forever.",
      },
      {
        name: "return [value]",
        sig: "exit current event/function",
        desc: "Returns from the current handler or function. Optional value for functions.",
      },
    ],
  },
  {
    id: "expr",
    label: "Expressions",
    entries: [
      {
        name: "list[i]",
        sig: "v1.1 — index access",
        desc: "Zero-based list indexing. Negative indices count from the end. Out-of-bounds returns null.",
        example: `let first = visible_enemies()[0]\nlet last_enemy = visible_enemies()[-1]`,
      },
      {
        name: "\"a\" + x",
        sig: "v1.1 — string concat",
        desc: "Runtime string concatenation when either side is a string. Numbers format to 2dp, lists/objects render as placeholders.",
        example: `let msg = "hp=" + health()`,
      },
      {
        name: "obj.property",
        sig: "member access",
        desc: "Reads a property from an entity handle. Common fields: id, position, health, heading, velocity, class.",
      },
      {
        name: "and / or / not",
        sig: "short-circuit boolean ops",
        desc: "Logical operators. `not` is unary. Short-circuit evaluation — the right side only runs if needed.",
      },
      {
        name: "+ - * / %",
        sig: "arithmetic",
        desc: "Standard numeric math. Division by zero returns 0 (deterministic).",
      },
      {
        name: "== != < <= > >=",
        sig: "comparison",
        desc: "Yields boolean. `==` / `!=` also work on entity ids and strings.",
      },
    ],
  },
  {
    id: "events",
    label: "Events",
    entries: [
      { name: "on spawn {}", sig: "fires once", desc: "Runs when your bot enters the arena. Good for waypoint + timer setup." },
      { name: "on tick {}", sig: "every tick", desc: "The main decision loop. Subject to the instruction budget." },
      { name: "on damaged(event) {}", sig: "hit reaction", desc: "`event.data.damage` + `event.data.sourceId` available. Ideal for dodge/shield triggers." },
      { name: "on low_health {}", sig: "threshold", desc: "Fires when health first crosses the low threshold." },
      { name: "on destroyed {}", sig: "epitaph", desc: "Last call. Great place to `send_signal` to squadmates." },
      { name: "on enemy_seen(event) / on enemy_lost(event)", sig: "vision edge", desc: "Fires when a newly visible enemy enters or leaves your cone." },
      { name: "on cooldown_ready(event) {}", sig: "cooldown edge", desc: "`event.data.actionName` tells you which ability is ready." },
      { name: "on signal_received(event) {}", sig: "team comms", desc: "`event.data.data` is the signal payload, `event.senderPosition` has the broadcast origin." },
    ],
  },
  {
    id: "perception",
    label: "Perception",
    entries: [
      { name: "nearest_enemy()", sig: "-> enemy?", desc: "Closest visible enemy (or null). Subject to line of sight." },
      { name: "visible_enemies()", sig: "-> list<enemy>", desc: "All enemies currently visible, sorted by distance." },
      { name: "visible_allies()", sig: "-> list<ally>", desc: "All friendly bots you can see." },
      { name: "scan(range)", sig: "active ping", desc: "Expanding active scan that updates your memory of enemy positions." },
      { name: "enemy_velocity(enemy)", sig: "v1.1 — -> vector?", desc: "Current velocity of an enemy handle. Use with predict_position() to lead shots." },
      { name: "predict_position(enemy, ticks)", sig: "v1.1 — -> position?", desc: "Linear extrapolation of where an enemy will be N ticks from now. Clamped to the arena." },
      { name: "incoming_projectile()", sig: "v1.1 — -> obj?", desc: "Returns the projectile closest to hitting you, with direction, distance, ticks_to_impact, damage. null if nothing incoming." },
      { name: "damage_direction()", sig: "v1.1 — -> vector?", desc: "Unit vector from you toward your most recent attacker. Stable for ~30 ticks after a hit." },
      { name: "last_damage_tick()", sig: "v1.1 — -> number", desc: "Tick number at which you last took damage, or -1." },
      { name: "threat_level()", sig: "v1.1 — -> 0..100", desc: "Composite scalar combining HP loss, visible enemy count, overheat, low ammo, recent damage. Good for single-switch mode selection." },
      { name: "nearest_sound()", sig: "-> sound?", desc: "Closest recent noise event (footstep, weapon)." },
      { name: "line_of_sight(pos)", sig: "-> boolean", desc: "True if you can see the given point through walls/cover." },
    ],
  },
  {
    id: "state",
    label: "State",
    entries: [
      { name: "health() / max_health() / health_percent()", desc: "Your HP, max HP, and percent remaining (0-100)." },
      { name: "energy() / heat() / heat_percent() / overheated()", desc: "Resource economy: heat gates firing once it hits the cap." },
      { name: "ammo() / max_ammo() / ammo_percent()", desc: "Finite ammunition. Only refilled by stepping into resupply depots." },
      { name: "position() / velocity() / heading()", desc: "Your own kinematic state." },
      { name: "current_tick() / time_alive() / kills()", desc: "Timing + scoring." },
      { name: "is_cloaked() / cloak_remaining()", desc: "Active cloaking state." },
      { name: "self_destruct_armed() / self_destruct_remaining()", desc: "Armed-detonation countdown." },
    ],
  },
  {
    id: "movement",
    label: "Movement",
    entries: [
      { name: "move_to pos", desc: "Pathfind toward a specific point." },
      { name: "move_toward target", desc: "Head in the direction of an entity or position." },
      { name: "move_forward / move_backward", desc: "Translate along your current heading." },
      { name: "turn_left / turn_right", desc: "Rotate in place." },
      { name: "strafe_left / strafe_right", desc: "Sidestep without changing heading — great for dodging." },
      { name: "retreat", desc: "Move directly away from the last known enemy position." },
      { name: "stop", desc: "Halt movement for this tick." },
    ],
  },
  {
    id: "combat",
    label: "Combat",
    entries: [
      { name: "attack target", desc: "Close-range melee strike, no ammo cost, low heat." },
      { name: "fire_at pos", desc: "Default ranged attack. 2 ammo, medium heat." },
      { name: "fire_light pos", desc: "Cheap rapid-fire, low ammo + low heat, modest damage." },
      { name: "fire_heavy pos", desc: "Expensive, slow, high-damage shot. 3 ammo, lots of heat." },
      { name: "burst_fire pos", desc: "Three-round burst, 6 ammo, lots of heat." },
      { name: "grenade pos", desc: "Area-of-effect arc, 8 ammo. Best against clumped enemies." },
      { name: "zap", desc: "Melee-range energy discharge, no ammo, self-damages 10% HP." },
      { name: "shield", desc: "Restores ~20% HP. Long cooldown." },
      { name: "cloak [duration]", desc: "Go invisible. Breaks on attack/damage." },
      { name: "vent_heat", desc: "Sacrifice this tick's combat slot to dump heat aggressively." },
      { name: "self_destruct", desc: "Arm a 5-second countdown detonation. Only available at <=35% HP." },
    ],
  },
  {
    id: "squad",
    label: "Squad & hive",
    entries: [
      { name: "team_size() / my_index() / my_role()", desc: "Your position within the squad and what role the program requested." },
      { name: "squad_center()", sig: "-> position", desc: "Centroid of all alive squadmates. Use for rally/retreat logic." },
      { name: "lowest_health_ally()", sig: "-> ally?", desc: "The ally most in danger — target for healers or body-blockers." },
      { name: "count_enemies_near(pos, r) / count_allies_near(pos, r)", desc: "Quick density checks for formations and cluster attacks." },
      { name: "hive_get(key) / hive_set(key, value) / hive_has(key)", desc: "Shared per-team key/value store. Use it to broadcast targets or role handoffs." },
      { name: "send_signal data", desc: "Broadcast a short message to nearby allies. Received via on signal_received." },
    ],
  },
  {
    id: "math",
    label: "Math",
    entries: [
      { name: "abs, min, max, clamp, floor, ceil, round, sign", desc: "Standard numeric helpers." },
      { name: "sqrt, pow, lerp, pi", desc: "More math. `lerp(a,b,t)` clamps t to 0..1." },
      { name: "sin, cos, atan2, deg_to_rad, rad_to_deg", sig: "v1.1", desc: "Trig functions for trajectory work." },
      { name: "distance_between(a, b)", desc: "Euclidean distance between two positions." },
      { name: "angle_between(a, b)", sig: "-> degrees", desc: "Integer degrees from a to b." },
      { name: "direction_to(pos)", sig: "-> vector", desc: "Unit vector from you to pos." },
      { name: "make_position(x, y)", desc: "Build a position object clamped to arena bounds." },
      { name: "length(list) / list_empty(list)", sig: "v1.1", desc: "List length + emptiness check. Also: `list.length` short-hand." },
      { name: "random(lo, hi)", desc: "Integer in [lo, hi]. Deterministic per match seed." },
      { name: "rand_float(lo, hi)", sig: "beta", desc: "Uniform float in [lo, hi). Deterministic per match seed." },
      { name: "chance(p)", sig: "beta — -> boolean", desc: "True with probability p (0..1). Convenience wrapper for stochastic branching." },
      { name: "hypot(x, y) / mod(a, b)", sig: "beta", desc: "`mod` returns a mathematical remainder (always non-negative). `hypot` is sqrt(x² + y²)." },
      { name: "dot(a, b) / normalize(v)", sig: "beta", desc: "Vector dot product; unit-length normalization. Zero-vector normalizes to (0,0)." },
      { name: "vec_add(a, b) / vec_scale(v, s)", sig: "beta", desc: "Compose vectors without reaching into x/y by hand." },
    ],
  },
  {
    id: "stdlib",
    label: "Lists & strings",
    entries: [
      { name: "list_contains(list, x)", sig: "beta — -> boolean", desc: "True if `x` is an element. Matches entities by id." },
      { name: "index_of(list, x)", sig: "beta — -> number", desc: "Zero-based index of the first match, or -1." },
      { name: "list_first(list) / list_last(list)", sig: "beta", desc: "Ergonomic shortcuts for [0] and [-1]. Return null when empty." },
      { name: "list_sum(list)", sig: "beta — -> number", desc: "Sum the numeric values in a list. Non-numeric entries coerce to 0." },
      { name: "string_contains(str, sub)", sig: "beta — -> boolean", desc: "Substring test. An empty needle is always true." },
      { name: "starts_with(str, prefix) / ends_with(str, suffix)", sig: "beta", desc: "Prefix / suffix match. Useful when parsing signal payloads." },
    ],
  },
  {
    id: "debug",
    label: "Debug",
    entries: [
      {
        name: "log(msg, [value])",
        sig: "beta — diagnostic",
        desc: "Prints to the UI console after the match, prefixed with the bot name and tick. No effect on simulation state. Capped at 500 lines per match; use `every N` or `if` to gate noisy logs.",
        example: `on tick {\n  if threat_level() > 60 {\n    log("PANIC hp=" + health())\n  }\n}`,
      },
    ],
  },
];
