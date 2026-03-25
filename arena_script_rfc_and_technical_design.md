# ArenaScript — RFC and Technical Design

## Document 1: RFC-Style Specification

# RFC: ArenaScript v1.0
**Status:** Draft
**Authors:** OpenAI / Project Team
**Intended Audience:** Product, game design, engine, frontend, tooling, and platform teams
**Last Updated:** March 24, 2026

---

## 1. Abstract
ArenaScript is a deterministic, sandboxed domain-specific language for authoring autonomous robot behaviors in a web-based arena combat game. Users write programs that control robots in competitive matches. The language is designed to be easy to learn, safe to execute at scale, and extensible as gameplay mechanics evolve.

This RFC defines the goals, non-goals, syntax principles, type system, execution model, runtime constraints, standard capabilities, validation rules, and compatibility strategy for ArenaScript v1.0.

---

## 2. Motivation
Competitive programming games succeed when they balance three concerns: accessibility for new users, depth for advanced users, and operational safety for the platform. ArenaScript exists to provide a purpose-built language that can meet these goals better than embedding a general-purpose language directly in the browser runtime.

ArenaScript is intended to:
- lower the barrier to entry for players
- create strategic depth through limited but expressive primitives
- ensure deterministic and fair simulation
- support rich tooling such as linting, replay inspection, and step debugging
- allow future game modes, robot classes, and arena mechanics to be added without rethinking the language core

---

## 3. Goals
### 3.1 Primary Goals
1. Provide a beginner-friendly programming model for autonomous arena robots.
2. Guarantee deterministic match outcomes for identical inputs.
3. Enforce strict execution safety and sandboxing.
4. Support browser-native authoring, validation, simulation, and replay.
5. Create a language core that remains stable while the game expands.

### 3.2 Secondary Goals
1. Support clean inline documentation and discoverability in editors.
2. Enable readable code reviews and tournament debugging.
3. Permit tactical styles such as aggression, kiting, guarding, retreat, and objective capture.

---

## 4. Non-Goals
ArenaScript v1.0 does not attempt to:
- serve as a general-purpose programming language
- provide filesystem, network, DOM, or timer access
- support unrestricted loops or arbitrary recursion
- permit runtime code generation or self-modifying programs
- expose hidden match state beyond game-authorized perception rules
- support user-defined modules, imports, or packages in v1.0

---

## 5. Terminology
**Arena**: The game map and simulation environment.

**Robot**: A single controllable autonomous unit driven by one ArenaScript program.

**Tick**: The smallest discrete unit of simulation time.

**Sensor**: A read-only built-in function that reveals permitted game state.

**Action**: A command or intent submitted by a robot for execution by the simulation.

**State**: Persistent mutable robot-owned data retained across ticks.

**Event**: A runtime callback triggered by a simulation condition.

**Execution Budget**: A bounded amount of computation available to a robot on a tick.

---

## 6. Design Principles
### 6.1 Learnability First
Programs should read clearly and align with a simple mental model: sense, decide, act.

### 6.2 Determinism by Default
A match replay must be reproducible from identical source code, map seed, engine version, and initial conditions.

### 6.3 Safety by Construction
The language runtime must not depend on untrusted direct execution of arbitrary JavaScript.

### 6.4 Tactical Expressiveness
The language should enable practical combat behaviors without requiring advanced language knowledge.

### 6.5 Extensible Core
The language should accept future sensors, actions, events, and unit capabilities with minimal disruption.

---

## 7. Program Structure
A valid ArenaScript program consists of a top-level robot declaration followed by zero or more metadata, constants, state declarations, event handlers, and functions.

### 7.1 Example
```arenascript
robot "Skirmisher" version "1.0"

meta {
  author: "Player123"
  class: "ranger"
}

const {
  ENGAGE_RANGE = 8
  RETREAT_HEALTH = 20
}

state {
  target_id: id? = null
  mode: string = "patrol"
  last_seen_tick: number = 0
}

on spawn {
  set mode = "patrol"
}

on tick {
  let enemy = nearest_enemy()

  if enemy != null and can_attack(enemy) {
    set target_id = enemy.id
    set last_seen_tick = current_tick()
    attack enemy
  } else if enemy != null and distance_to(enemy) < ENGAGE_RANGE {
    move_toward enemy.position
  } else {
    patrol()
  }
}

fn patrol() {
  move_to nearest_control_point()
}
```

### 7.2 Top-Level Blocks
ArenaScript v1.0 supports the following top-level constructs:
- `robot`
- `meta`
- `const`
- `state`
- `on <event>`
- `fn`

---

## 8. Syntax Rules
### 8.1 General Style
- Keywords are lowercase.
- Identifiers use `snake_case`.
- Blocks use braces.
- Mutation requires the explicit `set` keyword.
- Function declarations use `fn`.
- Event handlers use `on`.

### 8.2 Comments
ArenaScript should support single-line comments in v1.0:
```arenascript
// pursue enemy if in range
```
Block comments may be introduced in a later version.

### 8.3 Statements
Supported statement categories in v1.0:
- variable declaration (`let`)
- state assignment (`set`)
- conditionals (`if`, `else if`, `else`)
- bounded iteration (`for`)
- action statements
- function calls
- `return`

---

## 9. Type System
ArenaScript uses a simple static type system with compile-time validation.

### 9.1 Primitive Types
- `number`
- `boolean`
- `string`
- `id`
- `vector`
- `direction`

### 9.2 Domain Types
- `robot_ref`
- `enemy`
- `ally`
- `projectile`
- `resource_node`
- `control_point`
- `event`
- `position`

### 9.3 Nullable Types
Types may be nullable using `?`, for example:
- `id?`
- `enemy?`
- `position?`

### 9.4 Collections
Bounded collection types are supported:
- `list<enemy>`
- `list<ally>`
- `list<position>`

Collections returned by sensors are immutable in v1.0.

### 9.5 Type Rules
- Null values cannot be dereferenced.
- Implicit coercion is limited and should be minimized.
- Built-ins and actions define their accepted argument types explicitly.
- Invalid access should fail at compile time when statically provable.

---

## 10. Variables, Constants, and State
### 10.1 Constants
Constants are declared in a `const` block and are immutable.

```arenascript
const {
  SAFE_DISTANCE = 6
}
```

### 10.2 Local Variables
Local variables are block-scoped.

```arenascript
let enemy = nearest_enemy()
```

### 10.3 Persistent State
Persistent data is declared in a `state` block and remains available across ticks.

```arenascript
state {
  mode: string = "idle"
  patrol_index: number = 0
}
```

### 10.4 Assignment
Only state variables are persistently mutable.

```arenascript
set mode = "engage"
set patrol_index = patrol_index + 1
```

---

## 11. Control Flow
### 11.1 Conditionals
```arenascript
if health() < 20 {
  retreat()
} else {
  engage()
}
```

### 11.2 Iteration
Only bounded loops are permitted.

```arenascript
for enemy in visible_enemies() {
  if can_attack(enemy) {
    attack enemy
    return
  }
}
```

### 11.3 Restricted Constructs
The following are not allowed in v1.0:
- unrestricted `while` loops
- unbounded recursion
- dynamic iteration over unbounded user-created structures

---

## 12. Functions
### 12.1 Declaration
```arenascript
fn should_engage(enemy: enemy) -> boolean {
  return distance_to(enemy) <= 8 and health() > 25
}
```

### 12.2 Rules
- Functions may declare typed parameters.
- Functions may declare return types.
- Recursion is disallowed in v1.0.
- Closures and anonymous functions are disallowed in v1.0.
- Function-local memory is bounded by runtime limits.

---

## 13. Events
### 13.1 Standard Events
ArenaScript v1.0 standardizes the following events:
- `spawn`
- `tick`
- `damaged`
- `enemy_seen`
- `enemy_lost`
- `cooldown_ready`
- `low_health`
- `destroyed`

### 13.2 Event Handlers
```arenascript
on damaged(event) {
  if event.source != null {
    set target_id = event.source.id
  }
}
```

### 13.3 Event Ordering
The engine must define a strict ordering. Recommended ordering:
1. spawn initialization
2. tick handlers
3. action submission
4. movement and combat resolution
5. event emission
6. next tick begins

---

## 14. Sensors
Sensors are pure read-only built-ins and must obey line-of-sight, fog-of-war, and other visibility rules.

### 14.1 Self Sensors
- `health() -> number`
- `max_health() -> number`
- `energy() -> number`
- `position() -> position`
- `velocity() -> vector`
- `heading() -> direction`
- `cooldown(action_name: string) -> number`

### 14.2 Enemy Sensors
- `nearest_enemy() -> enemy?`
- `visible_enemies() -> list<enemy>`
- `enemy_count_in_range(range: number) -> number`

### 14.3 Ally Sensors
- `nearest_ally() -> ally?`
- `visible_allies() -> list<ally>`

### 14.4 Arena Sensors
- `nearest_cover() -> position?`
- `nearest_resource() -> resource_node?`
- `nearest_control_point() -> control_point?`
- `distance_to(target) -> number`
- `line_of_sight(target) -> boolean`
- `current_tick() -> number`

### 14.5 Capability Rule
Additional sensors may be gated by robot class, equipment, or match mode.

---

## 15. Actions
Actions express robot intent. The engine resolves actions according to simulation rules.

### 15.1 Core Actions
**Movement**
- `move_to position`
- `move_toward target`
- `strafe_left`
- `strafe_right`
- `stop`

**Combat**
- `attack target`
- `fire_at position`
- `use_ability "dash"`
- `shield`
- `retreat`

**Objective / Utility**
- `mark_target target`
- `capture control_point`
- `ping`

### 15.2 Action Semantics
Each action must define:
- required arguments
- allowed target types
- cost
- cooldown
- cast or windup time if applicable
- success conditions
- failure conditions
- emitted events

### 15.3 Submission Rules
Recommended v1.0 rule: one primary action and one movement intent may be committed per tick.

---

## 16. Execution Model
### 16.1 Deterministic Tick Execution
Each robot is evaluated under a bounded execution budget once per tick. The engine must guarantee deterministic scheduling and resolution.

### 16.2 Tick Budget
The platform should budget at least the following dimensions:
- instruction steps
- function calls
- sensor calls
- memory reads and writes
- list iteration cost

### 16.3 Budget Failure Behavior
When a robot exceeds its budget:
- remaining instructions are skipped for that tick
- the robot retains prior valid state
- a debug warning may be recorded
- repeated abuse may be penalized by platform policy

---

## 17. Error Handling
### 17.1 Compile-Time Errors
Examples include:
- syntax errors
- unknown identifiers
- invalid event signatures
- type mismatches
- invalid action arguments

### 17.2 Runtime Warnings
Examples include:
- null target action ignored
- action on cooldown
- insufficient energy
- blocked movement
- budget exceeded

### 17.3 Platform Safety Requirement
A faulty program must never terminate the match or destabilize the engine.

---

## 18. Security and Sandbox
ArenaScript programs must not access:
- browser APIs
- the DOM
- timers
- networking
- external storage
- other players’ source code at runtime

The recommended implementation is compilation to a restricted intermediate representation interpreted by a dedicated VM or engine-owned runtime.

---

## 19. Versioning and Compatibility
### 19.1 Required Version Declaration
Every program must declare a language version.

```arenascript
robot "Raptor" version "1.0"
```

### 19.2 Compatibility Policy
- Minor versions may add sensors, actions, or warnings.
- Major versions may alter semantics.
- Existing bots should continue to run against their declared language version whenever operationally feasible.

### 19.3 Deprecation
Deprecated constructs should produce warnings before removal and should be accompanied by migration guidance.

---

## 20. Extensibility Model
ArenaScript is designed so the engine can add new capabilities without changing the language structure.

### 20.1 Extensible Areas
- robot classes
- actions
- sensors
- events
- status effects
- arena object types
- competitive modes

### 20.2 Capability Gating
Capabilities may be enabled per class or mode and should be discoverable at compile time where possible.

---

## 21. Grammar Direction (Informative)
The following is an illustrative grammar shape, not a normative parser definition.

```ebnf
program         = robot_decl, meta_block?, const_block?, state_block?, { handler | function } ;
robot_decl      = "robot", string, "version", string ;
meta_block      = "meta", block ;
const_block     = "const", block ;
state_block     = "state", block ;
handler         = "on", identifier, param_list?, block ;
function        = "fn", identifier, param_list, return_type?, block ;
statement       = let_stmt | set_stmt | if_stmt | for_stmt | action_stmt | return_stmt | expr_stmt ;
```

---

## 22. Example Programs
### 22.1 Basic Aggressor
```arenascript
robot "Bruiser" version "1.0"

on tick {
  let enemy = nearest_enemy()

  if enemy != null {
    if can_attack(enemy) {
      attack enemy
    } else {
      move_toward enemy.position
    }
  }
}
```

### 22.2 Cautious Ranged Bot
```arenascript
robot "Kiter" version "1.0"

const {
  SAFE_HEALTH = 25
  ATTACK_RANGE = 7
}

on tick {
  let enemy = nearest_enemy()

  if enemy == null {
    move_to nearest_control_point()
    return
  }

  if health() < SAFE_HEALTH {
    move_to nearest_cover()
    return
  }

  if distance_to(enemy) <= ATTACK_RANGE and can_attack(enemy) {
    attack enemy
  } else {
    move_toward enemy.position
  }
}
```

---

## 23. Open Questions
The following items remain to be finalized for production release:
1. Final tick rate and simulation cadence
2. Exact budget numbers per robot per tick
3. Which events are required in MVP versus post-MVP
4. Whether deterministic randomness is included in v1.0
5. Class-specific APIs versus universal-only MVP API
6. Exact replay schema and debugging surface

---

## 24. IANA / Registry Considerations
None.

---

## 25. Security Considerations
The main security risks are resource exhaustion, sandbox escape, hidden-state leakage, and nondeterministic execution. ArenaScript v1.0 addresses these through restricted syntax, a bounded execution model, engine-owned simulation, and capability-gated built-ins.

---

## 26. Conclusion
ArenaScript v1.0 defines a practical, professional foundation for a browser-based autonomous robot arena game. It is intentionally small, strongly constrained, and implementation-friendly, while leaving room for future capability growth.

---

## Document 2: Technical Design Document

# ArenaScript v1.0 — Technical Design Document
**Status:** Draft
**Audience:** Engineering and technical product stakeholders
**Last Updated:** March 24, 2026

---

## 1. Purpose
This document describes the recommended implementation approach for ArenaScript v1.0, including architecture, compiler pipeline, VM/runtime design, simulation integration, tooling requirements, data models, operational concerns, and phased delivery.

Where the RFC defines the language contract, this document defines how to build and operate the system.

---

## 2. System Overview
ArenaScript is best implemented as a multi-stage pipeline integrated into a deterministic match engine.

Recommended high-level flow:
1. User authors source code in a browser editor.
2. Source is tokenized and parsed into an AST.
3. Semantic analysis validates symbols, types, event signatures, and capability usage.
4. The AST is lowered into an intermediate representation (IR) or bytecode.
5. The runtime executes that IR inside a sandboxed deterministic VM.
6. The match engine resolves actions and world state per tick.
7. Replay logs and debug traces are emitted for playback and diagnostics.

---

## 3. Architecture
### 3.1 Major Components
1. **Editor and UX Layer**
   - browser editor
   - syntax highlighting
   - autocomplete
   - inline diagnostics
   - code formatting
   - docs panel

2. **Language Services Layer**
   - tokenizer
   - parser
   - AST model
   - semantic analyzer
   - linter
   - formatter

3. **Compilation Layer**
   - AST to IR lowering
   - constant folding
   - symbol resolution
   - capability table generation

4. **Runtime Layer**
   - deterministic VM/interpreter
   - per-robot memory frame
   - budget accounting
   - sensor call gateway
   - action submission gateway

5. **Simulation Layer**
   - world state model
   - tick scheduler
   - movement resolution
   - collision and line-of-sight
   - combat and effect resolution
   - event generation

6. **Observability Layer**
   - replay logs
   - tick traces
   - variable snapshots
   - performance counters
   - tournament analytics

---

## 4. Recommended Stack
### 4.1 MVP Stack
- **Frontend/editor:** TypeScript + Monaco Editor
- **Compiler/services:** TypeScript shared between frontend and backend if possible
- **Simulation engine:** TypeScript for fast iteration, or Rust/WASM if performance becomes a bottleneck
- **Persistence:** relational store for bots, matches, rankings, and replay metadata
- **Replay format:** JSON or compact binary event log with versioned schema

### 4.2 Reasoning
A TypeScript-first stack reduces time to first playable experience and simplifies shared validation logic between browser and server. If scale or competitive throughput requires it, the runtime and world simulation can later be migrated to Rust/WASM while preserving the language contract.

---

## 5. Source Model and Compilation Pipeline
### 5.1 Stages
1. Lexing
2. Parsing
3. AST construction
4. Semantic analysis
5. IR generation
6. Optional optimization
7. Runtime packaging

### 5.2 Lexing
The lexer should produce stable tokens for:
- keywords
- identifiers
- literals
- punctuation
- comments
- operators

The lexer should also record source spans for all tokens to enable precise diagnostics and editor hovers.

### 5.3 Parsing
A recursive descent parser is recommended because the grammar is intentionally small and easy to maintain. Pratt parsing may be used for expression precedence.

### 5.4 AST
Recommended AST families:
- ProgramNode
- RobotDeclNode
- MetaBlockNode
- ConstBlockNode
- StateBlockNode
- EventHandlerNode
- FunctionDeclNode
- StatementNode subclasses
- ExpressionNode subclasses

Each node should include:
- type discriminator
- source span
- child nodes
- optional semantic annotations

### 5.5 Semantic Analysis
The semantic analyzer should perform:
- scope and symbol resolution
- type checking
- event signature validation
- capability validation
- nullability checks where possible
- recursion detection
- boundedness checks for loops and collections

### 5.6 IR Design
A compact IR is recommended over executing the AST directly.

Potential instruction families:
- load/store
- literal construction
- comparison and arithmetic
- call_builtin
- call_user_fn
- jump / branch
- iterate_bounded
- submit_action
- return

Advantages of IR:
- easier budget metering
- easier deterministic serialization
- easier future optimization
- simpler runtime implementation than AST-walking with ad hoc behavior

---

## 6. Runtime Design
### 6.1 VM Model
Each robot instance should run inside an isolated runtime context containing:
- compiled program reference
- persistent state frame
- current tick local frame
- budget counters
- action submission buffer
- debug trace buffer (optional / mode-dependent)

### 6.2 State Storage
Persistent state should be stored in a compact typed slot layout determined at compile time.

Recommended structure:
- state slot table generated at compile time
- fixed-size per-robot storage array
- nullable bitmask or tagged union support

### 6.3 Execution Budget Accounting
The VM should decrement budget on:
- instruction dispatch
- built-in calls
- loop iterations
- list traversal
- user-function entry
- state mutation

Budget policy should be deterministic and independent of host machine speed.

### 6.4 Sensor Gateway
Robots should not read world state directly. All perception must pass through a sensor gateway that:
- applies visibility rules
- enforces capability gating
- returns typed domain objects or value snapshots
- increments sensor-call budget cost

### 6.5 Action Gateway
Actions should be submitted as intents rather than directly mutating world state. The gateway should:
- validate target and eligibility
- record requested action for the tick
- allow only legal action quotas
- generate warnings for invalid submissions

---

## 7. Simulation Engine Integration
### 7.1 Tick Phases
Recommended per-tick order:
1. update world timers/cooldowns
2. build sensor views for each robot as needed
3. execute robot programs
4. collect action intents
5. resolve movement
6. resolve collisions and occupancy
7. resolve attacks and abilities
8. apply damage/effects/status changes
9. emit events
10. write replay trace
11. check win conditions

### 7.2 Determinism Requirements
To keep results reproducible:
- use fixed tick steps
- use stable iteration order
- avoid host-dependent floating-point divergence where possible
- prefer fixed-point or carefully normalized numeric operations for critical simulation calculations
- use seeded PRNG if randomness exists

### 7.3 World Model
Recommended world entities:
- robots
- projectiles
- control points
- resources
- cover objects
- hazards
- match metadata

Each entity should carry a stable ID and versioned serialized schema.

---

## 8. Data Model Recommendations
### 8.1 Compiled Program Record
Fields:
- program_id
- source_version
- language_version
- source_hash
- AST/IR hash
- capability manifest
- compile diagnostics
- creation timestamp

### 8.2 Match Record
Fields:
- match_id
- ruleset version
- arena seed
- participating robot program IDs
- engine version
- outcome
- replay reference
- performance counters

### 8.3 Replay Schema
Replay should include:
- metadata header
- participant manifest
- seed and version info
- per-tick action log
- per-tick state deltas or viewable summary data
- event timeline
- end condition

Replay storage should favor deterministic reconstruction over full world snapshots when possible.

---

## 9. Tooling and Developer Experience
### 9.1 Editor Requirements
- syntax highlighting
- autocomplete for built-ins and events
- hover documentation
- inline compile errors
- quick fixes where appropriate
- formatter integration
- starter templates

### 9.2 Debugger Requirements
- step through ticks
- inspect robot state
- inspect emitted actions
- inspect sensor results
- view cooldown and resource timelines
- compare match runs across versions

### 9.3 Documentation Surface
The docs system should expose every built-in with:
- signature
- description
- allowed contexts
- example usage
- failure conditions
- capability requirements

---

## 10. Security and Abuse Prevention
### 10.1 Threat Model
Primary risks:
- sandbox escape
- CPU exhaustion
- memory abuse
- deterministic exploitation
- hidden information leakage
- denial-of-service through pathological code patterns

### 10.2 Mitigations
- no direct JS eval of user logic in production
- compile-time restrictions on recursion and unbounded loops
- budget accounting in the VM
- fixed state size caps
- bounded list size and iteration
- capability-gated built-ins
- replayable server-authoritative simulation for ranked play

### 10.3 Trust Boundary
For competitive modes, the server should be authoritative for compilation, validation, and match execution. Client-side execution may be used for local preview but must not define ranked results.

---

## 11. Performance Considerations
### 11.1 Scaling Targets
The platform should estimate and benchmark:
- robots per match
- ticks per second
- matches simulated concurrently
- editor validation latency
- replay storage footprint

### 11.2 Optimization Opportunities
- compile-time constant folding
- interned strings and identifiers
- slot-based state access
- bytecode dispatch tables
- replay delta compression
- cached sensor query plans for repeated built-ins

### 11.3 Browser Responsiveness
For local preview, simulation should run off the main UI thread when feasible, such as through Web Workers or WASM worker execution.

---

## 12. Testing Strategy
### 12.1 Language Tests
- lexer golden tests
- parser golden tests
- AST shape tests
- semantic validation tests
- formatter idempotence tests

### 12.2 Runtime Tests
- deterministic execution tests
- budget accounting tests
- sensor visibility tests
- illegal action handling tests
- nullability safety tests

### 12.3 Simulation Tests
- combat resolution correctness
- movement/collision correctness
- line-of-sight consistency
- event ordering correctness
- seed reproducibility tests

### 12.4 Integration Tests
- source-to-replay end-to-end tests
- cross-version compatibility tests
- tournament batch stability tests

---

## 13. Rollout Plan
### Phase 1: Rules and DSL Lock
Deliver:
- game ruleset definition
- v1 syntax and built-in catalog
- MVP event model
- budget model

### Phase 2: Compiler and Editor Foundation
Deliver:
- lexer/parser/AST
- semantic validator
- in-browser diagnostics
- syntax highlighting

### Phase 3: Runtime and Local Simulation
Deliver:
- IR/VM
- world model
- local replay viewer
- deterministic preview matches

### Phase 4: Server-Authoritative Matches
Deliver:
- compile service
- authoritative simulation service
- replay persistence
- ranking and validation pipeline

### Phase 5: Competitive and Content Systems
Deliver:
- tutorial bots
- challenge ladders
- telemetry dashboards
- balance tooling
- version migration support

---

## 14. MVP Scope Recommendation
### Include
- one robot per script
- `spawn`, `tick`, and `damaged` events
- persistent state
- conditionals and bounded loops
- a small typed standard library
- a limited set of actions and sensors
- deterministic replays
- editor linting and examples

### Defer
- multi-robot squad control
- user-defined modules
- inheritance or traits
- advanced collections
- asynchronous mechanics
- shared team memory
- extensive randomness primitives

---

## 15. Open Engineering Decisions
1. AST interpreter vs bytecode VM for first release
2. TypeScript-only runtime vs early Rust/WASM investment
3. JSON replay format vs binary compact format
4. Fixed-point math vs controlled floating-point
5. Extent of compile-time nullability enforcement
6. Whether local preview uses the exact server runtime package

Recommended answer for MVP:
- bytecode or compact IR VM if team capacity allows, otherwise disciplined AST interpreter with a clear path to IR
- TypeScript-first implementation
- JSON replay for easier debugging, with binary migration later if needed
- deterministic numeric policy defined early

---

## 16. Recommended Team Deliverables
### Product / Design
- robot classes and capabilities
- map and ruleset definitions
- core gameplay loops
- tutorial progression

### Language / Platform
- formal grammar
- built-in catalog
- diagnostics spec
- versioning policy

### Engine
- simulation loop
- combat/movement systems
- determinism guarantees
- replay writer/reader

### Frontend / Tooling
- editor integration
- docs browser
- debugger UI
- replay visualization

---

## 17. Conclusion
ArenaScript should be implemented as a purpose-built compiled DSL backed by a deterministic sandboxed runtime. That architecture best supports fairness, extensibility, browser tooling, and competitive operation. A narrow but polished MVP will be substantially more valuable than a broad but unstable first release.

---

## Appendix A: Suggested Next Docs
1. Formal EBNF grammar
2. Built-ins reference
3. Runtime rules reference
4. Replay schema spec
5. Versioning and migration guide
6. Editor diagnostics style guide

---

## Document 3: CTO / Engineering Review Version

# ArenaScript Platform — Engineering Review Document
**Status:** Draft for technical leadership review  
**Audience:** CTO, engineering leadership, staff engineers, product leadership  
**Last Updated:** March 24, 2026

---

## 1. Executive Summary
ArenaScript is a purpose-built DSL and execution platform for a browser-based robot arena game in which users author autonomous bots that compete in deterministic matches. The recommended architecture is a constrained compiled language, backed by a deterministic simulation engine and a server-authoritative match pipeline for competitive play.

The strategic recommendation is to ship a narrow but polished MVP rather than a broad first release. The platform’s long-term value depends less on language breadth and more on four properties:
- excellent first-run developer experience
- deterministic and replayable match execution
- strong sandboxing and anti-abuse controls
- a language and runtime model that can evolve without breaking the ecosystem

The most important product and engineering decision is to avoid executing arbitrary user JavaScript directly in the competitive runtime. ArenaScript should instead compile into a restricted IR or bytecode interpreted by an engine-owned runtime.

### 1.1 Leadership Recommendation
Proceed with a **TypeScript-first MVP** using:
- TypeScript parser, validator, and language services
- deterministic simulation engine in TypeScript
- compact IR or bytecode interpreter
- browser editor with local preview
- server-authoritative ranked match execution

Plan for a possible future migration of the runtime and simulation hot path to **Rust/WASM** only if performance or concurrency limits justify the added complexity.

### 1.2 Why This Matters
This platform sits at the intersection of game systems, compilers, sandboxing, and creator tools. If done well, it creates a durable moat:
- users learn the platform’s language and strategy model
- replay/debug tooling increases retention
- deterministic competition supports rankings, tournaments, and content creation
- extensibility enables new robot classes, maps, and seasonal rulesets without replacing the platform

---

## 2. Product Framing for Technical Leadership
This is not just a game feature. It is a small programmable platform with three coupled surfaces:
1. **Authoring surface**: editor, docs, validation, examples, tutorials
2. **Runtime surface**: deterministic execution, fairness, sandboxing, replayability
3. **Competitive surface**: ranking, balance, anti-abuse, versioning, migration

Weakness in any one of these surfaces will reduce the viability of the whole system.

### 2.1 Core Bet
Users will tolerate a constrained language if the system is:
- easy to start
- strategically deep
- debuggable
- fair

Users will not tolerate:
- nondeterministic results
- opaque failures
- weak docs
- broken compatibility for saved bots

---

## 3. Business and Platform Goals
### 3.1 Near-Term Goals
- launch a compelling programmable arena MVP
- allow users to write a functioning bot within minutes
- support ranked and unranked matches
- make debugging legible enough for social sharing and competitive iteration

### 3.2 Medium-Term Goals
- seasonal content updates
- new robot classes and arena modes
- tournaments and replay-based community features
- classroom / coding challenge usability

### 3.3 Long-Term Goals
- durable ecosystem of user-authored bots
- community guides, strategy sharing, and spectating
- stable language/runtime platform with versioned rulesets

---

## 4. Recommended Architecture at a Glance
```text
+-----------------------+       +-------------------------+
| Browser Editor / UI   |       | Documentation / Samples |
| - Monaco integration  |       | - Built-ins reference   |
| - Linting / hovers    |       | - Tutorials             |
| - Local simulation    |       | - Starter templates     |
+-----------+-----------+       +------------+------------+
            |                                    |
            v                                    v
+------------------------------------------------------------+
| Language Services                                            |
| - Lexer  - Parser  - AST  - Semantic checks  - Formatter   |
+-------------------------------+----------------------------+
                                |
                                v
+------------------------------------------------------------+
| Compilation Layer                                            |
| - AST lowering                                               |
| - Capability validation                                      |
| - IR / bytecode generation                                   |
+-------------------------------+----------------------------+
                                |
                                v
+------------------------------------------------------------+
| Deterministic Runtime                                         |
| - Per-robot VM                                                |
| - Budget accounting                                           |
| - Sensor gateway                                              |
| - Action gateway                                              |
+-------------------------------+----------------------------+
                                |
                                v
+------------------------------------------------------------+
| Simulation Engine                                             |
| - Tick scheduler                                              |
| - Movement / combat / LOS                                     |
| - Event emission                                              |
| - Replay writer                                               |
+-------------------------------+----------------------------+
                                |
             +------------------+-------------------+
             |                                      |
             v                                      v
+-------------------------+          +------------------------------+
| Local Preview / Sandbox |          | Server-Authoritative Matches |
| Fast iteration          |          | Ranked play / tournaments    |
+-------------------------+          +------------------------------+
```

### 4.1 Architectural Decision Summary
| Decision | Recommendation | Rationale |
|---|---|---|
| User code execution | No direct JS in ranked runtime | Better sandboxing, determinism, anti-abuse |
| Language representation | AST compiled to IR/bytecode | Easier metering, debugging, future optimization |
| Server authority | Required for ranked play | Fairness and replay trust |
| MVP stack | TypeScript-first | Fastest path to usable platform |
| Performance migration | Rust/WASM later if needed | Avoid early complexity tax |
| Replay model | Versioned event log | Supports debugging and deterministic playback |

---

## 5. System Components and Ownership
### 5.1 Editor and Tooling Surface
Scope:
- source editing
- syntax highlighting
- autocomplete
- inline diagnostics
- templates and examples
- local preview matches

Suggested ownership:
- frontend/platform tooling engineers

Key requirement:
The editor experience must feel modern and forgiving. This is critical for adoption.

### 5.2 Language Services
Scope:
- lexer
- parser
- AST model
- semantic validation
- linter
- formatter
- docs metadata integration

Suggested ownership:
- platform/compiler-oriented engineers

Key requirement:
Validation must be precise, fast, and consistent between client and server.

### 5.3 Runtime / VM
Scope:
- IR or bytecode interpreter
- persistent state model
- budget accounting
- built-in dispatch
- action submission

Suggested ownership:
- engine/platform engineers

Key requirement:
Budget accounting must be deterministic and independent of machine performance.

### 5.4 Simulation Engine
Scope:
- tick loop
- movement
- targeting and line-of-sight
- combat resolution
- status effects
- event generation
- replay creation

Suggested ownership:
- gameplay/engine engineers

Key requirement:
Simulation semantics must be explicit, testable, and stable across versions.

### 5.5 Competitive Backend
Scope:
- authoritative compilation
- authoritative simulation
- match queueing
- ranking systems
- replay storage
- ruleset versioning

Suggested ownership:
- backend/platform engineers

Key requirement:
Ranked outcomes must be trusted and reproducible.

---

## 6. Delivery Strategy
### 6.1 Recommended Delivery Philosophy
Ship in layers, each useful on its own:
1. language + local preview
2. deterministic runtime + replay
3. server-authoritative ranked play
4. balancing, competitive systems, and content tooling

This reduces risk compared with attempting the entire platform at once.

### 6.2 Milestone Plan
#### Milestone 0 — Product and Rules Lock
**Duration:** 2–4 weeks  
**Goal:** Remove ambiguity before implementation.

Deliverables:
- match rules
- robot classes for MVP
- sensor/action catalog
- DSL feature lock for v1
- execution budget policy draft
- replay/debug goals

Exit criteria:
- no unresolved ambiguity in core tick semantics
- written approval from product, design, and engineering leads

#### Milestone 1 — Language and Local Authoring Foundation
**Duration:** 4–6 weeks  
**Goal:** Users can write code and get meaningful feedback.

Deliverables:
- lexer/parser/AST
- semantic validator
- Monaco integration
- syntax highlighting
- diagnostics and formatter
- example bots

Exit criteria:
- valid programs parse and validate consistently
- invalid programs produce understandable inline diagnostics

#### Milestone 2 — Runtime and Local Simulation MVP
**Duration:** 4–8 weeks  
**Goal:** Programs can drive bots in deterministic local matches.

Deliverables:
- IR or runtime interpreter
- world model
- tick scheduler
- action/sensor gateway
- replay logging
- local match playback

Exit criteria:
- same inputs always produce same replay
- bots can complete end-to-end matches locally

#### Milestone 3 — Server-Authoritative Competitive Pipeline
**Duration:** 4–8 weeks  
**Goal:** Ranked matches are secure and replayable.

Deliverables:
- authoritative compile service
- authoritative simulation service
- replay storage pipeline
- match queueing
- ranked result ingestion
- versioned ruleset enforcement

Exit criteria:
- server and client agree on compile results for same source version
- ranked outcomes can be reproduced from replay metadata

#### Milestone 4 — Beta Hardening and Balance
**Duration:** 3–6 weeks  
**Goal:** Prepare for wider exposure.

Deliverables:
- anti-stalling rules
- telemetry dashboards
- performance tuning
- abuse guardrails
- tutorial improvements
- matchmaking balance checks

Exit criteria:
- no major fairness or stability blockers
- acceptable median onboarding success metrics

### 6.3 Suggested Overall MVP Window
A realistic MVP range is **4 to 6 months** for a focused team, depending on feature ambition and existing engine/editor infrastructure.

---

## 7. Staffing Recommendation
### 7.1 Lean MVP Team
A lean but credible team would be:
- **1 engineering lead / architect**
- **1 gameplay or simulation engineer**
- **1 platform/compiler engineer**
- **1 frontend/tooling engineer**
- **1 product designer or technical UX designer**
- **shared QA / test support**
- **part-time product manager**

This is enough to ship a disciplined MVP if scope remains narrow.

### 7.2 More Robust Team
For faster iteration and safer delivery:
- **1 engineering manager or tech lead**
- **2 gameplay/engine engineers**
- **2 platform/compiler/backend engineers**
- **2 frontend/tooling engineers**
- **1 designer**
- **1 PM**
- **1 QA / SDET**
- **optional DevOps / infra support**

### 7.3 Skills Required
The project benefits disproportionately from engineers with crossover skills in:
- compilers / parsers
- game simulation
- deterministic systems
- browser tooling
- platform and security thinking

---

## 8. Major Technical Risks
### 8.1 Risk Register
| Risk | Why it matters | Likelihood | Impact | Mitigation |
|---|---|---:|---:|---|
| Nondeterministic runtime | Breaks trust, replays, rankings | Medium | Very high | Deterministic numeric policy, stable iteration order, authoritative server execution |
| Scope creep in language design | Delays MVP and weakens polish | High | High | Lock v1 early, defer modules/advanced features |
| Weak editor UX | Users fail to onboard | Medium | High | Invest early in diagnostics, examples, hovers, templates |
| Direct execution security issues | Abuse or sandbox escape | Low/Med if careless | Very high | No direct JS in ranked runtime, VM-based execution |
| Replay/debug complexity underestimated | Hard to diagnose bugs and balance | Medium | High | Define replay schema and debug requirements early |
| Performance bottlenecks | Limits concurrency and match throughput | Medium | Medium/High | Keep MVP simple, benchmark early, migrate hot path later if necessary |
| Balance instability | Competitive meta becomes stale or unfair | High | Medium/High | Telemetry, narrow initial action set, fast ruleset iteration |
| Compatibility debt | Old bots break across releases | Medium | High | Version declaration, ruleset pinning, migration policy |

### 8.2 Highest-Risk Areas
The highest-risk areas are not parser implementation details. They are:
- deterministic simulation correctness
- clear action resolution semantics
- editor usability for beginners
- compatibility/versioning discipline

---

## 9. Tradeoff Analysis
### 9.1 TypeScript vs Rust/WASM at Start
**TypeScript-first advantages**
- fastest implementation path
- shared validation logic across editor and backend
- easier onboarding for web-heavy teams
- faster iteration on DSL and gameplay semantics

**Rust/WASM-first advantages**
- potentially stronger performance ceiling
- stronger memory safety story
- more natural path for heavy simulation scaling

**Recommendation**
Start in TypeScript unless there is already a strong internal Rust/WASM competency and a proven need. Most risk in this project is semantic and product risk, not raw compute risk.

### 9.2 AST Interpreter vs Bytecode/IR VM
**AST interpreter advantages**
- simpler prototype
- fewer early moving parts

**IR/bytecode advantages**
- cleaner budget accounting
- easier deterministic execution model
- better future optimization path
- simpler replayable execution traces

**Recommendation**
Use a compact IR or bytecode if the team can afford it. Otherwise start with a disciplined AST interpreter but preserve a migration path.

### 9.3 Client-Only vs Server-Authoritative Competitive Runtime
**Client-only advantages**
- lower backend complexity
- easier early prototyping

**Server-authoritative advantages**
- trusted rankings
- better anti-abuse
- unified replay truth
- easier version control and incident handling

**Recommendation**
Client-only is acceptable for preview and learning. Ranked play must be server-authoritative.

---

## 10. Operational Requirements
### 10.1 Observability
At minimum the system should track:
- compile success/failure rates
- validator latency
- local simulation latency
- server simulation throughput
- budget overrun frequency
- action failure rates
- tutorial completion rates
- dominant strategy indicators

### 10.2 SLO / Reliability Thinking
Suggested internal targets for MVP:
- editor diagnostics should feel near-instant for ordinary bots
- local simulation should remain responsive on common laptops
- ranked simulation jobs should be reproducible and auditable
- replay availability should be high for ranked matches

### 10.3 Incident Readiness
Be ready for incidents involving:
- nondeterministic results between environments
- ruleset version drift
- replay corruption
- runaway simulation cost from pathological bot patterns
- exploitative dominant strategies that require emergency balance action

---

## 11. Success Metrics
### 11.1 Product Metrics
- percent of new users who successfully submit a working bot
- time to first successful bot
- average number of bot revisions in first session
- replay views per match
- retention of bot authors after first week

### 11.2 Engineering Metrics
- compile latency
- local preview latency
- server simulation cost per match
- replay generation success rate
- validator consistency between environments
- number of version-compat incidents

### 11.3 Competitive Health Metrics
- diversity of winning strategies
- pick/win rates by robot class
- match duration distribution
- stall/draw frequency
- exploit report frequency

---

## 12. Recommended MVP Scope Boundaries
To reduce risk, the MVP should include:
- one robot per script
- a small fixed action catalog
- a small fixed sensor catalog
- 2 to 3 essential events (`spawn`, `tick`, `damaged`)
- persistent local state
- conditionals, bounded loops, simple functions
- deterministic replay and debugging basics

The MVP should not include:
- squad scripting
- shared team memory
- advanced module systems
- user extensions/plugins
- inheritance / trait systems
- large mutable collections
- timing-sensitive async behavior

This restraint is essential. The platform will be judged more on clarity and reliability than on feature count in v1.

---

## 13. Governance and Versioning Policy
### 13.1 Version Discipline
Every bot should declare:
- language version
- ruleset version if applicable

### 13.2 Change Management
Recommended release categories:
- **content changes**: new maps, cosmetic additions, tutorials
- **capability additions**: new class-specific sensors/actions
- **balance changes**: cooldowns, damage, costs, detection ranges
- **semantic/runtime changes**: execution model, built-in behavior, event ordering

Semantic/runtime changes require the highest scrutiny and strongest migration plan.

### 13.3 Review Process
Suggested review gates for platform changes:
- product review
- gameplay review
- runtime determinism review
- backward-compatibility review
- documentation readiness review

---

## 14. Recommended Org Questions Before Commit
Leadership should explicitly answer:
1. Is this a lightweight game feature or a durable creator platform?
2. Will ranked competition be a major product pillar?
3. How much backward compatibility is leadership willing to preserve?
4. Is the organization ready to invest in tooling and docs, not just gameplay?
5. Does the team want a fast MVP or a stronger long-term engine foundation?

The answers materially affect staffing, architecture, and roadmap.

---

## 15. Final Recommendation
ArenaScript is worth building if the intent is to create a durable programmable game surface, not a novelty feature. The architecture should prioritize deterministic correctness, developer experience, and server-authoritative trust over early feature breadth.

The highest-confidence approach is:
- TypeScript-first implementation
- constrained DSL compiled to IR/bytecode
- deterministic simulation engine
- browser-first editor and replay tools
- narrow MVP scope
- strong versioning and observability from the start

The single biggest strategic mistake would be over-expanding v1 before the platform proves that users can successfully author, debug, and trust their bots.

---

## 16. Suggested Next Deliverables
For leadership or engineering review, the next most useful artifacts would be:
1. a one-page **architecture decision record (ADR)** set for the biggest tradeoffs
2. a **staffing and resourcing matrix** by milestone
3. a **risk tracker / pre-mortem**
4. a **formal EBNF grammar**
5. a **server-authoritative runtime sequence diagram**
6. a **MVP backlog with epics and acceptance criteria**

