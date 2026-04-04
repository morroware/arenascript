# ArenaScript

A deterministic robot arena combat engine with a custom domain-specific language (DSL) for programming autonomous robot behaviors. Write code in the ArenaScript language, compile it to bytecode, and watch your bots fight in a live arena visualization.

## Features

- **Custom DSL** - ArenaScript language with lexer, parser, semantic analyzer, and bytecode compiler
- **Sandboxed VM** - Stack-based bytecode interpreter with budget metering (prevents infinite loops)
- **Deterministic Engine** - Multi-phase tick-based simulation with seeded PRNG for reproducible matches
- **Resource Economy** - Heat + ammo + energy + HP create real strategic tradeoffs every tick
- **Resupply Depots** - Contested neutral objectives that refill ammo and vent heat
- **Information Warfare** - Cloaking with break-on-damage/attack + directional scan sensors
- **Hive Memory** - Shared team key/value store for real squad coordination
- **Advanced Combat** - Light/heavy projectile variants, short-range zap, armed self-destruct
- **Centralized Validation** - Mode/config/participant request validation (NaN/Infinity rejected)
- **Dynamic Arenas** - Seeded randomized cover layouts, healing zones, hazards, and depots
- **Live Visualization** - Canvas-based arena rendering with replay animation
- **4 Robot Classes** - Brawler, Ranger, Tank, and Support with distinct stats, heat, and ammo profiles
- **Squad System** - 1-5 bots per team with role assignment
- **Ranked System** - Elo-based matchmaking and rating tiers (Bronze through Champion)
- **Tournaments** - Single elimination, round robin, and Swiss format support
- **Replay System** - Full match replay capture including heat/ammo/cloak state
- **PHP Backend** - API endpoints for matchmaking, lobbies, rankings, and tournaments

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla JavaScript (ES2022 modules), HTML, CSS |
| Backend | PHP |
| Build | None required - runs directly in the browser |

No build tools, no bundlers, no package managers needed.

## Quick Start

1. Serve the project with any web server:
   ```bash
   # PHP built-in server
   php -S localhost:8000

   # Python
   python3 -m http.server 8000

   # Node.js (npx)
   npx serve .
   ```

2. Open `http://localhost:8000` in your browser

3. Select a bot preset or write your own ArenaScript program

4. Click **Compile**, then **Run Match**

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Enter` | Compile |
| `Ctrl+Shift+Enter` | Run Match |
| `Tab` | Insert 2 spaces in editor |

## Project Structure

```
arenascript/
├── index.html              # Single-page application
├── css/
│   └── style.css           # Dark theme UI stylesheet
├── js/
│   ├── app.js              # Main frontend application
│   ├── demo.js             # Node.js CLI demo
│   ├── lang/               # DSL compiler pipeline
│   │   ├── tokens.js       # Lexer / tokenizer
│   │   ├── ast.js          # AST node definitions
│   │   ├── parser.js       # Recursive descent parser
│   │   ├── semantic.js     # Type checking & scope resolution
│   │   ├── compiler.js     # AST → bytecode compiler
│   │   └── pipeline.js     # High-level compile orchestrator
│   ├── runtime/            # Bytecode execution
│   │   ├── opcodes.js      # Instruction set definitions
│   │   ├── vm.js           # Stack-based bytecode VM
│   │   └── budget.js       # Execution budget accounting
│   ├── engine/             # Simulation engine
│   │   ├── world.js        # World state (entities, positions, health)
│   │   ├── tick.js         # 11-phase tick loop (core game loop)
│   │   ├── actions.js      # Action intent collection
│   │   ├── sensors.js      # Perception layer (fog-of-war)
│   │   ├── movement.js     # Movement & AABB collision detection
│   │   ├── combat.js       # Attack resolution & damage
│   │   ├── los.js          # Line-of-sight computation
│   │   ├── events.js       # Event generation & dispatch
│   │   └── replay.js       # Deterministic replay writer/reader
│   ├── server/             # Competitive systems
│   │   ├── matchmaking.js  # Queue management & Elo pairing
│   │   ├── ranked.js       # Elo ratings & rank tiers
│   │   ├── tournament.js   # Tournament brackets
│   │   ├── match-runner.js # Server-side match execution
│   │   └── lobby.js        # Multiplayer lobby management
│   └── shared/             # Common utilities
│       ├── config.js       # Game balance constants
│       ├── types.js        # Core type definitions
│       ├── prng.js         # Seeded deterministic PRNG
│       └── vec2.js         # 2D vector math
└── api/                    # PHP backend endpoints
    ├── config.php          # Game configuration
    ├── matchmaking.php     # Queue management & pairing
    ├── ranked.php          # Elo rating calculations
    ├── tournament.php      # Tournament bracket generation
    ├── match-runner.php    # Match execution & result storage
    └── lobby.php           # Lobby creation & joining
```

## ArenaScript Language

ArenaScript is a domain-specific language for programming robot behaviors. Programs are event-driven: you define handlers that execute each tick.

### Program Structure

```
robot "MyBot" version "1.0"

meta {
  author: "YourName"
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

### Language Features

| Feature | Description |
|---------|-------------|
| **Types** | `number`, `boolean`, `string`, `id`, `vector`, `position`, `list<T>`, nullable `T?` |
| **Declarations** | `let` for locals, `set` for state mutations, `const` for constants, `state` block for persistent vars |
| **Control Flow** | `if`/`else if`/`else`, `for`...`in` loops, `return`, `after`/`every` timer blocks |
| **Operators** | `+`, `-`, `*`, `/`, `%`, `==`, `!=`, `<`, `>`, `<=`, `>=`, `and`, `or`, `not` |
| **Events** | `on spawn`, `on tick`, `on damaged`, `on low_health`, `on destroyed`, `on enemy_seen`, `on enemy_lost`, `on cooldown_ready`, `on signal_received` |
| **Movement** | `move_to`, `move_toward`, `move_forward`, `move_backward`, `turn_left`, `turn_right`, `strafe_left`, `strafe_right`, `stop`, `retreat` |
| **Combat** | `attack`, `fire_at`, `fire_light`, `fire_heavy`, `burst_fire`, `grenade`, `zap`, `shield`, `vent_heat` |
| **Utility** | `cloak`, `self_destruct`, `place_mine`, `send_signal`, `mark_position`, `taunt`, `overwatch`, `capture`, `ping` |
| **Perception sensors** | `nearest_enemy`, `visible_enemies`, `scan`, `scan_enemies`, `last_seen_enemy`, `enemy_heading`, `is_enemy_facing_me`, `nearest_ally`, `visible_allies`, `nearest_sound` |
| **Resource sensors** | `health`, `energy`, `heat`, `ammo`, `heat_percent`, `ammo_percent`, `overheated` |
| **State sensors** | `is_cloaked`, `cloak_remaining`, `self_destruct_armed`, `self_destruct_remaining`, `is_taunted`, `is_in_overwatch`, `has_effect` |
| **Map sensors** | `nearest_depot`, `is_on_depot`, `nearest_control_point`, `nearest_cover`, `nearest_heal_zone`, `nearest_hazard`, `nearest_mine`, `nearest_pickup` |
| **Team memory** | `hive_get(key)`, `hive_set(key, value)`, `hive_has(key)` — shared per-team key/value store |
| **Functions** | `fn name(params) { ... }` for custom helper functions |

See [docs/language-reference.md](docs/language-reference.md) for the full sensor and command reference with examples.

### Robot Classes

| Class | HP | Energy | Speed | Damage | Range | Ammo | Heat Dissipation | Playstyle |
|-------|---:|-------:|------:|-------:|------:|-----:|-----------------:|-----------|
| **Brawler** | 120 | 80 | 2.2 | 14 | 3.5 | 50 | 2.2x (fastest) | Aggressive melee, rarely overheats |
| **Ranger** | 80 | 100 | 2.0 | 10 | 8.0 | 100 | 1.0x (baseline) | Ranged kiting, largest ammo pool |
| **Tank** | 150 | 60 | 1.5 | 8 | 4.0 | 80 | 0.7x (slowest) | Defensive holding, overheats fast |
| **Support** | 90 | 120 | 1.8 | 6 | 6.0 | 70 | 1.5x | Team support, good heat management |

### Resource Economy

Beyond HP and energy, every combat action feeds into a **heat + ammo** resource model:

- **Heat** builds from firing and ability use. At 100 the robot is *overheated* and cannot fire until it cools below 60.
- **Ammo** is finite per-spawn and only refills at **resupply depots** placed neutrally in the middle of each arena.
- **Melee attack** and **zap** cost no ammo — close-quarters options when ranged runs dry.
- **vent_heat** trades the combat slot this tick for aggressive cooling.

This creates a constant "fight-now vs. retreat-to-resupply vs. conserve-and-cool" decision loop that runs on top of normal positioning and target selection.

## Engine Architecture

The simulation runs a deterministic multi-phase tick loop. Each tick processes, in order:

1. **Cooldown + heat update** — decrement cooldowns, decay heat, handle overheat recovery, upkeep cloak
2. **Timer execution** — fire any elapsed `after` / `every` blocks
3. **Pickup spawn + effect expiry + noise decay** — passive world tick
4. **VM execution** — run each robot's `on tick` handler and collect intents
5. **Movement resolution** — apply velocity, resolve collisions
6. **Combat resolution** — attacks, projectile spawns, noise emission
7. **Mine detonation + pickup collection**
8. **Damage & effects** — advance projectiles, apply heal/hazard zones, apply resupply depots, resolve armed self-destructs
9. **Discovery + signal dispatch + control point capture**
10. **Event dispatch** — fire `damaged` / `low_health` / `destroyed` / etc. handlers
11. **Replay capture + win condition check** (with sudden-death timeout resolution)

See [docs/architecture.md](docs/architecture.md) for full details on each phase.

### Key Constants

| Setting | Value |
|---------|-------|
| Arena Size | 140 x 140 units |
| Tick Rate | 30 ticks/sec |
| Max Match Duration | 3000 ticks (100 seconds) + up to 900 ticks sudden death |
| CPU Budget | 1000 instructions/tick/robot |
| LOS Range | 150 units |
| Heat Cap | 100 (recovery threshold 60) |

## Ranked System

The competitive system uses Elo ratings with the following tiers:

| Tier | Rating |
|------|-------:|
| Bronze | 0+ |
| Silver | 1000+ |
| Gold | 1200+ |
| Platinum | 1400+ |
| Diamond | 1600+ |
| Champion | 1800+ |

K-factor is 32 for ratings below 2400, and 16 above.

## PHP API

The backend provides REST endpoints for multiplayer features:

| Endpoint | Purpose |
|----------|---------|
| `api/config.php` | Retrieve game balance configuration |
| `api/matchmaking.php` | Enqueue players and find Elo-based pairings |
| `api/ranked.php` | Calculate and update Elo ratings |
| `api/tournament.php` | Generate brackets (single-elim, round-robin, Swiss) |
| `api/match-runner.php` | Execute matches server-side and store results |
| `api/lobby.php` | Create/join lobbies, supports 1v1, 2v2, and FFA modes |

## License

All rights reserved.
