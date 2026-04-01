# ArenaScript

A deterministic robot arena combat engine with a custom domain-specific language (DSL) for programming autonomous robot behaviors. Write code in the ArenaScript language, compile it to bytecode, and watch your bots fight in a live arena visualization.

## Features

- **Custom DSL** - ArenaScript language with lexer, parser, semantic analyzer, and bytecode compiler
- **Sandboxed VM** - Stack-based bytecode interpreter with budget metering (prevents infinite loops)
- **Deterministic Engine** - 11-phase tick-based simulation with seeded PRNG for reproducible matches
- **Live Visualization** - Canvas-based arena rendering with replay animation
- **4 Robot Classes** - Brawler, Ranger, Tank, and Support with distinct stats
- **Ranked System** - Elo-based matchmaking and rating tiers (Bronze through Champion)
- **Tournaments** - Single elimination, round robin, and Swiss format support
- **Replay System** - Full match replay capture and playback
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
| **Types** | `string`, `number`, `boolean`, `id`, `id?` (nullable), `null` |
| **Declarations** | `let` for local variables, `set` for state mutations |
| **Control Flow** | `if`/`else`, `for`...`in` loops, `return` |
| **Operators** | `+`, `-`, `*`, `/`, `%`, `==`, `!=`, `<`, `>`, `<=`, `>=`, `and`, `or`, `not` |
| **Events** | `on spawn`, `on tick`, `on damaged`, `on low_health` |
| **Commands** | `attack`, `move_toward`, `move_to`, `retreat`, `shield`, `dash` |
| **Sensors** | `nearest_enemy()`, `scan()`, `scan_enemies()`, `last_seen_enemy()`, `nearest_ally()`, `nearest_control_point()`, `health()`, `energy()`, `can_attack()` |
| **Functions** | `fn name(params) { ... }` for custom functions |

### Robot Classes

| Class | HP | Energy | Speed | Damage | Range | Cooldown | Playstyle |
|-------|---:|-------:|------:|-------:|------:|---------:|-----------|
| **Brawler** | 120 | 80 | 2.2 | 14 | 3.5 | 4 ticks | Aggressive melee |
| **Ranger** | 80 | 100 | 2.0 | 10 | 8.0 | 6 ticks | Ranged kiting |
| **Tank** | 150 | 60 | 1.5 | 8 | 4.0 | 5 ticks | Defensive holding |
| **Support** | 90 | 120 | 1.8 | 6 | 6.0 | 7 ticks | Team support |

## Engine Architecture

The simulation runs a deterministic 11-phase tick loop:

1. **Budget Reset** - Reset per-robot instruction budgets
2. **Sensor Update** - Compute visibility and perception data
3. **Event Dispatch** - Fire pending events (spawn, damaged, low_health)
4. **VM Execution** - Run each robot's bytecode (tick handler)
5. **Action Validation** - Validate and categorize robot intents
6. **Movement Resolution** - Process movement with collision detection
7. **Combat Resolution** - Resolve attacks and apply damage
8. **Projectile Update** - Advance projectile positions and TTL
9. **Cooldown Update** - Decrement ability cooldowns
10. **Capture Update** - Process control point capture progress
11. **Replay Capture** - Record frame for replay system

### Key Constants

| Setting | Value |
|---------|-------|
| Arena Size | 100 x 100 units |
| Tick Rate | 30 ticks/sec |
| Max Match Duration | 3000 ticks (100 seconds) |
| CPU Budget | 1000 instructions/tick/robot |
| Base Health | 100 HP |
| LOS Range | 150 units |

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
