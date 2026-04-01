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
| `retreat` | Move away from the nearest threat |
| `shield` | Activate a damage shield (3 tick duration, 30 tick cooldown) |
| `dash` | Quick movement burst (5.0 distance, 20 tick cooldown) |
| `fire_at <target>` | Fire a projectile at a target (8 dmg, 15.0 range, 8 tick cooldown) |

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
| `nearest_control_point()` | position | Nearest capture point |
| `health()` | number | Current health |
| `energy()` | number | Current energy |
| `can_attack(target)` | boolean | Whether target is visible, in range, and off cooldown |
| `distance_to(position)` | number | Distance from robot to a position |
| `visible_enemies()` | list | All enemies within line-of-sight |
| `visible_allies()` | list | All allies within line-of-sight |

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
