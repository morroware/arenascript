# Architecture Guide

Technical documentation for the ArenaScript engine internals.

## Overview

ArenaScript is composed of four layers:

```
┌──────────────────────────────────────────────┐
│  Frontend (index.html, css/, js/app.js)      │  Browser UI
├──────────────────────────────────────────────┤
│  Language Pipeline (js/lang/)                │  Source → Bytecode
├──────────────────────────────────────────────┤
│  Runtime (js/runtime/)                       │  Bytecode VM
├──────────────────────────────────────────────┤
│  Engine (js/engine/)                         │  Simulation
├──────────────────────────────────────────────┤
│  Server / API (js/server/, api/)             │  Competitive Systems
└──────────────────────────────────────────────┘
```

---

## Language Pipeline (`js/lang/`)

The compiler transforms ArenaScript source code into bytecode through four stages:

### 1. Lexer (`tokens.js`)

Converts source text into a token stream. Handles:
- Keywords (`robot`, `on`, `if`, `let`, `set`, `fn`, etc.)
- Literals (numbers, strings, booleans, null)
- Operators and punctuation
- Comments (stripped during tokenization)
- Newline-significant tokenization

### 2. Parser (`parser.js`)

Recursive descent parser that builds an Abstract Syntax Tree (AST) from tokens.

Key AST nodes (defined in `ast.js`):
- `RobotDeclaration` - Top-level program node
- `MetaBlock`, `ConstBlock`, `StateBlock` - Declarations
- `EventHandler` - Event handler definitions (`on tick`, `on spawn`, etc.)
- `FunctionDeclaration` - Custom function definitions
- `IfStatement`, `ForStatement` - Control flow
- `LetStatement`, `SetStatement` - Variable operations
- `CommandStatement` - Robot actions (`attack`, `move_toward`, etc.)
- `BinaryExpression`, `UnaryExpression` - Operators
- `CallExpression`, `MemberExpression` - Function calls and property access

### 3. Semantic Analyzer (`semantic.js`)

Validates the AST for correctness:
- Type checking on state variables
- Scope resolution (constants, state, locals)
- Valid event handler names
- Command argument validation
- Duplicate declaration detection
- Produces diagnostics (errors and warnings)

### 4. Compiler (`compiler.js`)

Transforms validated AST into a compact bytecode program:
- Generates bytecode instructions (see `runtime/opcodes.js`)
- Builds constant pool for literals
- Maps event handlers to bytecode entry points
- Outputs a `CompiledProgram` object consumed by the VM

### Pipeline Orchestrator (`pipeline.js`)

The `compile(source)` function runs all four stages in sequence and returns:

```javascript
{
  success: boolean,
  program: CompiledProgram,   // if success
  constants: Array,           // constant pool
  diagnostics: Array,         // warnings
  errors: Array               // error messages if failed
}
```

### Shared Validation (`js/shared/validation.js`)

Centralized validators gate match setup data before execution:
- `validateMatchMode(mode)`
- `validateParticipantCount(mode, count)`
- `validateMatchConfig(config)`
- `validateParticipant(participant)`
- `validateMatchRequest(request)`

`validateMatchConfig` enforces finite, positive arena dimensions and rejects malformed numeric inputs (including `NaN` and `Infinity`) early.

---

## Runtime (`js/runtime/`)

### Opcodes (`opcodes.js`)

Defines the bytecode instruction set used by the VM. Instructions are stack-based operations including:
- Stack manipulation (push, pop, dup)
- Arithmetic and comparison
- Control flow (jump, jump-if-false)
- Variable load/store
- Function calls
- Sensor and command dispatch

### VM (`vm.js`)

Stack-based bytecode interpreter that executes compiled robot programs:

- **Instruction dispatch** - Fetch-decode-execute cycle
- **Stack machine** - Operands pushed/popped from an evaluation stack
- **Sensor gateway** - Interface to query world state (injected by engine)
- **Budget enforcement** - Tracks instruction count, function calls, sensor calls
- **Event dispatch** - Jumps to bytecode entry points for event handlers
- **Constant pool** - Lookup table for literal values and user constants

### Budget System (`budget.js`)

Enforces per-tick execution limits to prevent infinite loops and ensure fairness:

| Resource | Limit |
|----------|------:|
| Instructions | 1,000 |
| Function calls | 50 |
| Sensor calls | 30 |
| Memory operations | 200 |

When a budget is exceeded, execution halts for that robot's current tick (non-fatal).

---

## Simulation Engine (`js/engine/`)

### World Model (`world.js`)

Manages all game state:
- Robot entities (position, health, energy, cooldowns, team, class)
- Projectile entities (position, velocity, TTL, owner)
- Control points (position, capture progress per team)
- Entity ID generation

### Tick Loop (`tick.js`)

The core game loop runs a deterministic 11-phase tick:

```
Phase 1:  Budget Reset         - Reset per-robot instruction budgets
Phase 2:  Sensor Update        - Compute visibility and fog-of-war
Phase 3:  Event Dispatch       - Fire pending events (spawn, damaged, low_health)
Phase 4:  VM Execution         - Run each robot's tick handler bytecode
Phase 5:  Action Validation    - Validate and categorize collected robot intents
Phase 6:  Movement Resolution  - Process movement with AABB collision detection
Phase 7:  Combat Resolution    - Resolve attacks and apply damage
Phase 8:  Projectile Update    - Advance projectiles, check hits, expire TTL
Phase 9:  Cooldown Update      - Decrement ability cooldowns
Phase 10: Capture Update       - Process control point capture progress
Phase 11: Replay Capture       - Record frame snapshot for replay system
```

The `runMatch(setup)` function runs ticks until a win condition is met or max ticks reached.

**Win conditions:**
- All robots on one team are eliminated
- A team reaches capture threshold on control points
- Max ticks reached (draw, or winner by remaining HP)

### Movement (`movement.js`)

- Resolves movement intents into position changes
- AABB collision detection against arena boundaries
- Robot-to-robot collision resolution
- Respects class-specific move speeds

### Combat (`combat.js`)

- Validates attack targets (range, cooldown, energy)
- Applies damage based on class stats
- Handles projectile creation for `fire_at` commands
- Updates projectile positions and checks for hits
- Manages cooldown timers for all abilities

### Line of Sight (`los.js`)

Computes visibility between entities for fog-of-war mechanics. Robots can only perceive entities within their LOS range (150 units).

### Sensors (`sensors.js`)

Gateway layer between robot VMs and the world. Provides:
- `nearest_enemy()` / `nearest_ally()` - Nearest visible entity queries
- `nearest_control_point()` - Closest capture point
- `health()` / `energy()` - Self status queries
- `can_attack()` - Attack feasibility check
- `visible_enemies()` / `visible_allies()` - List queries

All sensor results are filtered through line-of-sight and include tactical/perception helpers used by newer language features (signals, mines, pickups, team role context).

### Actions (`actions.js`)

Collects and validates robot action intents:
- Each robot can submit one action per tick
- Actions are validated against game rules (range, cooldown, energy)
- Invalid actions are silently dropped
- Categorized into movement, combat, and ability actions

### Events (`events.js`)

Event system that triggers robot event handlers:
- `spawn` - Fires once when robot enters the arena
- `damaged` - Fires when robot takes damage (includes event data)
- `low_health` - Fires when health drops below 25 HP
- Visibility tracking for enter/exit line-of-sight events

### Replay (`replay.js`)

Captures match state each tick for replay:
- Robot positions, health, and team IDs per frame
- Compact frame format for efficient storage
- Reader/writer pattern for serialization

---

## Competitive Systems

### Client-Side (`js/server/`)

JavaScript implementations of competitive features that can run in the browser:

- **matchmaking.js** - Elo-based queue pairing with expanding search range
- **ranked.js** - Elo rating calculations and rank tier assignment
- **tournament.js** - Bracket generation (single elimination, round robin, Swiss)
- **match-runner.js** - Match orchestration wrapping the tick engine
- **lobby.js** - Multiplayer lobby management (1v1, 2v2, FFA)

### Server-Side (`api/`)

PHP backend endpoints that mirror the client-side logic for authoritative server execution:

- **config.php** - Shared game balance constants
- **matchmaking.php** - Server-authoritative queue and pairing
- **ranked.php** - Elo calculations with K-factor adjustment
- **tournament.php** - Bracket generation with seeded PRNG for reproducibility
- **match-runner.php** - Server-side match execution
- **lobby.php** - Lobby lifecycle management

---

## Determinism

The engine is fully deterministic. Given the same inputs (robot programs, configuration, seed), every match produces identical results. This is achieved through:

1. **Seeded PRNG** (`shared/prng.js`) - All randomness uses a deterministic seed
2. **Fixed-order processing** - Robots are processed in consistent order each tick
3. **No floating-point ambiguity** - Careful use of integer math where possible
4. **Replay verification** - Replay system can verify determinism by re-running matches

---

## Configuration (`shared/config.js`)

All game balance constants are centralized in a single configuration file. This includes arena dimensions, tick rate, robot stats, combat values, budget limits, and ranked system parameters. The PHP backend mirrors these constants in `api/config.php`.
