# ArenaScript Language Reference

Complete reference for the ArenaScript domain-specific language (DSL).

## Table of Contents

- [Program Structure](#program-structure)
- [Header](#header)
- [Meta Block](#meta-block)
- [Constants](#constants)
- [State Block](#state-block)
- [Event Handlers](#event-handlers)
- [Functions](#functions)
- [Variables](#variables)
- [Types](#types)
- [Operators](#operators)
- [Control Flow](#control-flow)
- [Built-in Commands](#built-in-commands)
- [Built-in Sensors](#built-in-sensors)
- [Examples](#examples)

---

## Program Structure

Every ArenaScript program follows this structure:

```
robot "<name>" version "<version>"

meta { ... }      // Required: robot metadata
squad { ... }     // Optional: team composition (1-5 bots from one script)
const { ... }     // Optional: compile-time constants
state { ... }     // Optional: persistent state variables

on <event> { ... }   // Event handlers
fn <name>() { ... }  // Custom functions
```

## Header

The header declares the robot name and program version:

```
robot "MyBot" version "1.0"
```

Both the name and version are string literals (quoted).

## Meta Block

The meta block defines robot metadata. The `class` field determines your robot's stats:

```
meta {
  author: "YourName"
  class: "brawler"
}
```

### Available Classes

| Class | Description |
|-------|-------------|
| `"brawler"` | High damage, high speed, lower range |
| `"ranger"` | Long range, moderate stats |
| `"tank"` | High health, slow, defensive |
| `"support"` | High energy, balanced |

## Constants

Compile-time constants that cannot be changed during execution:

```
const {
  ENGAGE_RANGE = 8
  SAFE_HEALTH = 30
  MAX_RETRIES = 3
}
```

Constants are inlined at compile time and do not consume runtime budget.

## Squad Block

Use `squad` to spawn a coordinated mini-team from one ArenaScript program.

```
squad {
  size: 3
  roles: "anchor", "flank", "support"
}
```

- `size` must be an integer from `1` to `5`.
- `roles` is optional; if present, roles are assigned by index and repeated cyclically if needed.
- Without `squad`, each participant spawns one robot (legacy behavior).

### Team-aware Sensors

| Sensor | Description |
|--------|-------------|
| `team_size()` | Returns the squad size for this script instance |
| `my_index()` | Zero-based index of this robot inside the squad |
| `my_role()` | Role string from `roles`, or empty string |

## State Block

Persistent variables that survive between ticks. Must include type annotations and default values:

```
state {
  mode: string = "patrol"
  target_id: id? = null
  retreating: boolean = false
  damage_count: number = 0
}
```

State variables are modified using the `set` keyword inside event handlers.

## Event Handlers

Event handlers are the core of robot behavior. They execute in response to game events.

### `on spawn`

Fires once when the robot is first created:

```
on spawn {
  set mode = "hunt"
}
```

### `on tick`

Fires every simulation tick (30 times per second). This is where main logic lives:

```
on tick {
  let enemy = nearest_enemy()
  if enemy != null {
    attack enemy
  }
}
```

### `on damaged`

Fires when the robot takes damage. Receives an event parameter:

```
on damaged(event) {
  set mode = "retreat"
}
```

### `on low_health`

Fires when health drops below the low health threshold (25 HP):

```
on low_health {
  retreat
}
```

## Functions

Define reusable logic with `fn`:

```
fn should_retreat() {
  return health() < 30
}

on tick {
  if should_retreat() {
    retreat
  }
}
```

Functions can accept parameters:

```
fn is_in_range(target, range) {
  return distance_to(target.position) < range
}
```

## Variables

### Local Variables

Declared with `let`, scoped to the current block:

```
let enemy = nearest_enemy()
let dist = distance_to(enemy.position)
```

### State Mutations

State variables are updated with `set`:

```
set mode = "attack"
set damage_count = damage_count + 1
```

You cannot use `let` to modify state variables or `set` to create local variables.

## Types

| Type | Description | Example |
|------|-------------|---------|
| `number` | Integer or float | `42`, `3.14` |
| `string` | Text | `"hello"` |
| `boolean` | True or false | `true`, `false` |
| `null` | No value | `null` |
| `id` | Entity identifier | returned by sensors |
| `id?` | Nullable entity identifier | `null` or an id |

## Operators

### Arithmetic

| Op | Description |
|----|-------------|
| `+` | Addition |
| `-` | Subtraction / negation |
| `*` | Multiplication |
| `/` | Division |
| `%` | Modulo |

### Comparison

| Op | Description |
|----|-------------|
| `==` | Equal |
| `!=` | Not equal |
| `<` | Less than |
| `>` | Greater than |
| `<=` | Less than or equal |
| `>=` | Greater than or equal |

### Logical

| Op | Description |
|----|-------------|
| `and` | Logical AND |
| `or` | Logical OR |
| `not` | Logical NOT |

## Control Flow

### If / Else

```
if health() < 30 {
  retreat
} else if can_attack(enemy) {
  attack enemy
} else {
  move_toward enemy.position
}
```

### For Loops

```
for enemy in visible_enemies() {
  if can_attack(enemy) {
    attack enemy
    return
  }
}
```

### Return

Exit from the current handler or function:

```
on tick {
  if health() < 10 {
    retreat
    return
  }
  // ... rest of logic
}
```

## Built-in Commands

Commands are actions your robot performs. Each has cooldowns and energy costs.

| Command | Description |
|---------|-------------|
| `attack <target>` | Attack a target entity (must be in range) |
| `move_toward <position>` | Move toward a position |
| `move_to <position>` | Move to a specific position |
| `move_forward` | Move in the robot's current heading direction |
| `move_backward` | Move opposite the robot's current heading |
| `turn_left` | Rotate heading left (no translation this tick) |
| `turn_right` | Rotate heading right (no translation this tick) |
| `strafe_left` | Move laterally left relative to current heading |
| `strafe_right` | Move laterally right relative to current heading |
| `stop` | Cancel current movement intent |
| `retreat` | Move away from the nearest threat |
| `shield` | Activate a damage shield (3 tick duration, 30 tick cooldown) |
| `fire_at <target>` | Fire a projectile at a target (8 dmg, 15.0 range, 8 tick cooldown) |
| `burst_fire <target>` | Fire a 3-shot spread volley (short-mid range pressure) |
| `grenade <target>` | Detonate AoE damage around a target position |
| `use_ability` | Trigger class/ability hook (engine-dependent behavior) |
| `mark_target` | Mark enemy intent target (tactical command) |
| `capture` | Prioritize objective capture action |
| `ping` | Emit tactical ping marker |
| `place_mine` | Place a mine at current location |
| `send_signal <value>` | Broadcast a squad signal to nearby allies |
| `mark_position <position>` | Write a remembered waypoint position |
| `taunt` | Apply taunt effect in range |
| `overwatch` | Enter overwatch stance with temporary bonuses |
| `fire_light <target>` | Fast, low-damage, long-range shot (4 dmg, 18 range, 4 tick CD, 1 ammo). Hard-to-dodge chip damage. |
| `fire_heavy <target>` | Slow, high-damage shot (22 dmg, 14 range, 14 tick CD, 4 ammo). High heat, slow bullet speed. |
| `zap` | Short-range energy discharge (4 unit radius, 18 dmg to enemies, 5 dmg to self). Desperation melee. |
| `vent_heat` | Skip this tick's combat to aggressively cool the heat sink. |
| `cloak` | Become invisible to enemy sensors (60 tick duration). Broken by attacking, taking damage, or being within 4 units of an enemy. |
| `self_destruct` | Arm a 30-tick countdown. Detonates for 60 AoE damage in 7-unit radius, destroying self. Only available below 35% HP. Cannot be cancelled. |

### Resource Economy (Heat + Ammo)

Every combat action now feeds into a three-resource model: **health**, **heat**, and **ammo**.

- **Heat** builds from firing weapons and using abilities. At 100 the robot is *overheated* and cannot fire until it cools below 60. Different robot classes dissipate heat at different rates (tanks overheat easily, brawlers cool fastest).
- **Ammo** is finite per-spawn and only replenishes at resupply depots. Each weapon has a different ammo cost. Melee `attack` and `zap` cost no ammo.
- **Resupply depots** are neutral map objects placed in the arena middle. Standing on one refills ammo and vents heat each tick — contested map objectives.

## Built-in Sensors

Sensors query the game world. They consume budget (max 30 sensor calls per tick).

| Sensor | Returns | Description |
|--------|---------|-------------|
| `nearest_enemy()` | entity or `null` | Closest visible enemy |
| `scan(range?)` | entity or `null` | Actively scan nearby enemies (ignores LOS, max 22 units) |
| `scan_enemies(range?)` | list | All enemies detected by active scan |
| `last_seen_enemy()` | entity or `null` | Last remembered enemy contact with `age` and `last_seen_tick` |
| `has_recent_enemy_contact(max_age?)` | boolean | Whether memory contains recent enemy contact |
| `nearest_ally()` | entity or `null` | Closest visible ally |
| `visible_allies()` | list | All allies within line-of-sight |
| `enemy_count_in_range(range?)` | number | Count visible enemies in range |
| `nearest_control_point()` | position | Nearest capture point |
| `nearest_enemy_control_point()` | position | Nearest enemy-held control point |
| `nearest_cover()` | position or `null` | Closest cover object |
| `nearest_resource()` | entity or `null` | Closest resource node |
| `nearest_heal_zone()` | zone or `null` | Nearest healing zone with `position` and `radius` |
| `nearest_hazard()` | zone or `null` | Nearest hazard zone |
| `nearest_sound()` | sound or `null` | Most relevant recent sound cue |
| `nearest_mine()` | mine or `null` | Closest detectable mine |
| `nearest_pickup()` | pickup or `null` | Closest pickup |
| `health()` | number | Current health |
| `max_health()` | number | Max health for robot class |
| `health_percent()` | number | Current health percentage |
| `energy()` | number | Current energy |
| `position()` | position | Current world position |
| `velocity()` | vector | Current movement vector |
| `heading()` | number | Current heading/orientation |
| `cooldown(action?)` | number | Remaining cooldown info |
| `can_attack(target)` | boolean | Whether target is visible, in range, and off cooldown |
| `enemy_visible()` | boolean | Convenience check: whether any enemy is currently visible |
| `line_of_sight(position)` | boolean | LOS test against a position |
| `wall_ahead(distance?)` | boolean | Whether heading path intersects arena bounds or cover soon |
| `damage_percent()` | number | Percent damage taken (0-100) |
| `random(min, max)` | number | Deterministic integer random in inclusive range |
| `distance_to(position)` | number | Distance from robot to a position |
| `current_tick()` | number | Current simulation tick index |
| `visible_enemies()` | list | All enemies within line-of-sight |
| `team_size()` | number | Squad size for this script instance (1-5) |
| `my_index()` | number | Zero-based squad index for this robot |
| `my_role()` | string | Assigned squad role string (or empty string) |
| `is_in_heal_zone()` | boolean | Whether robot is currently in a heal zone |
| `is_in_hazard()` | boolean | Whether robot is currently in a hazard |
| `arena_width()` | number | Arena width |
| `arena_height()` | number | Arena height |
| `spawn_position()` | position | Original spawn position |
| `recall_position(label?)` | position or `null` | Read remembered waypoint |
| `discovered_count()` | number | Count of discovered entities/objectives |
| `angle_to(position)` | number | Relative angle to position |
| `is_facing(position, tolerance?)` | boolean | Facing check |
| `enemy_heading(enemy)` | number | Heading of enemy |
| `is_enemy_facing_me(enemy, tolerance?)` | boolean | Whether enemy faces this robot |
| `ally_health(ally)` | number | Ally health lookup |
| `kills()` | number | Current kill count |
| `time_alive()` | number | Ticks alive so far |
| `has_effect(name)` | boolean | Whether robot has named status effect |
| `is_taunted()` | boolean | Whether robot is taunted |
| `is_in_overwatch()` | boolean | Whether robot is in overwatch |
| `heat()` | number | Current heat level (0 to max_heat) |
| `max_heat()` | number | Heat cap before overheating (100) |
| `heat_percent()` | number | Heat as a 0-100 percentage |
| `overheated()` | boolean | Whether combat actions are currently disabled due to heat |
| `ammo()` | number | Current ammo remaining |
| `max_ammo()` | number | Max ammo capacity for this robot class |
| `ammo_percent()` | number | Ammo as a 0-100 percentage |
| `is_cloaked()` | boolean | Whether cloak is currently active |
| `cloak_remaining()` | number | Ticks of cloak remaining (0 if inactive) |
| `self_destruct_armed()` | boolean | Whether self-destruct countdown is ticking |
| `self_destruct_remaining()` | number | Ticks until detonation (0 if not armed) |
| `nearest_depot()` | depot or `null` | Nearest resupply depot with `position`, `radius`, `distance` |
| `is_on_depot()` | boolean | Whether robot is currently standing inside a resupply depot |
| `hive_get(key)` | value or `null` | Read a value from the shared team memory |
| `hive_set(key, value)` | value | Write a value to the shared team memory (visible to all squad members) |
| `hive_has(key)` | boolean | Whether the team has stored a value under `key` |

### Entity Properties

Entities returned by sensors have these properties:

| Property | Type | Description |
|----------|------|-------------|
| `.position` | position | Entity's current position |
| `.position.x` | number | X coordinate |
| `.position.y` | number | Y coordinate |
| `.health` | number | Entity's current health |
| `.id` | id | Entity's unique identifier |

## Examples

### Aggressive Brawler

```
robot "Bruiser" version "1.0"

meta {
  author: "Player1"
  class: "brawler"
}

const {
  ENGAGE_RANGE = 8
}

state {
  mode: string = "hunt"
}

on spawn {
  set mode = "hunt"
}

on tick {
  let enemy = nearest_enemy()
  if enemy != null {
    if can_attack(enemy) {
      attack enemy
    } else {
      move_toward enemy.position
    }
  } else {
    move_to nearest_control_point()
  }
}

on damaged(event) {
  set mode = "fight"
}
```

### Kiting Ranger

```
robot "Kiter" version "1.0"

meta {
  author: "Player2"
  class: "ranger"
}

const {
  SAFE_HEALTH = 30
}

state {
  retreating: boolean = false
}

on spawn {
  set retreating = false
}

on tick {
  let enemy = nearest_enemy()

  if enemy == null {
    move_to nearest_control_point()
    return
  }

  if health() < SAFE_HEALTH {
    set retreating = true
    retreat
    return
  }

  set retreating = false

  if can_attack(enemy) {
    attack enemy
  } else {
    move_toward enemy.position
  }
}

on low_health {
  set retreating = true
}
```

### Defensive Tank

```
robot "Fortress" version "1.0"

meta {
  author: "Player3"
  class: "tank"
}

state {
  holding: boolean = false
}

on spawn {
  move_to nearest_control_point()
}

on tick {
  let enemy = nearest_enemy()
  if enemy != null {
    if can_attack(enemy) {
      attack enemy
    }
  }
  if not holding {
    move_to nearest_control_point()
  }
}

on damaged {
  shield
}
```

### Support Healer

```
robot "Healer" version "1.0"

meta {
  author: "Player4"
  class: "support"
}

state {
  mode: string = "follow"
}

on tick {
  let ally = nearest_ally()
  let enemy = nearest_enemy()

  if enemy != null and can_attack(enemy) {
    attack enemy
  } else if ally != null {
    move_toward ally.position
  } else {
    move_to nearest_control_point()
  }
}
```

## Execution Limits

To ensure fair play, each robot has a per-tick budget:

| Resource | Limit |
|----------|------:|
| Instructions | 1,000 per tick |
| Function calls | 50 per tick |
| Sensor calls | 30 per tick |
| Memory operations | 200 per tick |

Exceeding the budget terminates the current tick's execution for that robot (it does not crash the robot).
