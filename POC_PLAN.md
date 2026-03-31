# ArenaScript — Game Engine PoC Plan

## Overview

This PoC implements the core ArenaScript platform end-to-end: a deterministic DSL
compiler, sandboxed bytecode VM, tick-based simulation engine, replay system,
multiplayer match orchestration, and ranked tournament infrastructure.

The goal is a **playable vertical slice** — two or more bots fighting in a
deterministic arena with ranked results and replayable matches.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  ArenaScript Source (.as)                                    │
│  robot "Bruiser" version "1.0"                              │
│  on tick { attack nearest_enemy() }                         │
└────────────────────┬────────────────────────────────────────┘
                     │
          ┌──────────▼──────────┐
          │   Language Layer     │
          │  Lexer → Parser →   │
          │  AST → Semantic →   │
          │  IR Compiler         │
          └──────────┬──────────┘
                     │  bytecode
          ┌──────────▼──────────┐
          │   Runtime Layer      │
          │  Bytecode VM         │
          │  Per-robot isolation │
          │  Budget accounting   │
          │  Sensor/Action gates │
          └──────────┬──────────┘
                     │  action intents
          ┌──────────▼──────────┐
          │   Simulation Engine  │
          │  World model         │
          │  Tick scheduler      │
          │  Movement/collision  │
          │  Combat/LOS          │
          │  Event emission      │
          │  Replay writer       │
          └──────────┬──────────┘
                     │
     ┌───────────────┼───────────────┐
     │               │               │
     ▼               ▼               ▼
┌─────────┐   ┌───────────┐   ┌───────────┐
│ Replay   │   │ Ranked    │   │Tournament │
│ System   │   │ Matches   │   │ System    │
└─────────┘   └───────────┘   └───────────┘
```

---

## Module Breakdown

### 1. `src/lang/` — Language Pipeline

| File | Purpose |
|------|---------|
| `tokens.ts` | Token types and lexer |
| `parser.ts` | Recursive descent parser → AST |
| `ast.ts` | AST node type definitions |
| `semantic.ts` | Type checking, scope resolution, validation |
| `compiler.ts` | AST → bytecode IR compilation |

**Key decisions:**
- Recursive descent parser (grammar is small, no need for parser generators)
- Pratt parsing for expression precedence
- Compact bytecode IR for budget metering and determinism
- All 6 primitive types + domain types from spec

### 2. `src/runtime/` — Bytecode VM

| File | Purpose |
|------|---------|
| `vm.ts` | Stack-based bytecode interpreter |
| `opcodes.ts` | Instruction set definition |
| `budget.ts` | Execution budget accounting |

**Key decisions:**
- Stack-based VM (simpler than register-based for a DSL)
- Budget decremented on every instruction dispatch
- Per-robot isolated execution context
- Deterministic: no host-dependent behavior

### 3. `src/engine/` — Simulation Engine

| File | Purpose |
|------|---------|
| `world.ts` | World state model (entities, positions, health) |
| `tick.ts` | Tick scheduler — the 11-phase tick loop |
| `movement.ts` | Movement resolution and collision |
| `combat.ts` | Attack resolution, damage, abilities |
| `los.ts` | Line-of-sight and visibility |
| `sensors.ts` | Sensor gateway (perception layer) |
| `actions.ts` | Action gateway (intent collection) |
| `events.ts` | Event generation and dispatch |
| `replay.ts` | Deterministic replay writer/reader |

**Key decisions:**
- Fixed-step tick simulation (no variable dt)
- 2D grid/continuous hybrid — positions are continuous, but collision is simple AABB
- Seeded PRNG for any randomness (spread patterns, etc.)
- Sensor gateway enforces fog-of-war / LOS before returning data
- Actions are intents, resolved by engine after all robots execute

### 4. `src/server/` — Competitive Backend

| File | Purpose |
|------|---------|
| `matchmaking.ts` | Queue management, Elo-based pairing |
| `ranked.ts` | Elo rating system, rank tiers |
| `tournament.ts` | Tournament brackets (single-elim, round-robin, swiss) |
| `match-runner.ts` | Server-authoritative match execution |
| `lobby.ts` | Multiplayer lobby and match orchestration |

**Key decisions:**
- Elo rating with K-factor decay
- Rank tiers: Bronze → Silver → Gold → Platinum → Diamond → Champion
- Tournament formats: single elimination, round robin, swiss
- Server-authoritative: client can preview, but ranked results come from server sim

### 5. `src/shared/` — Shared Types

| File | Purpose |
|------|---------|
| `types.ts` | Core type definitions used across all layers |
| `prng.ts` | Seeded deterministic PRNG |
| `config.ts` | Game balance constants and configuration |

---

## Tick Execution Order (per spec)

```
1.  Update world timers / cooldowns
2.  Build sensor views for each robot
3.  Execute robot programs (VM)
4.  Collect action intents
5.  Resolve movement
6.  Resolve collisions / occupancy
7.  Resolve attacks / abilities
8.  Apply damage / effects / status
9.  Emit events (damaged, enemy_seen, etc.)
10. Write replay trace
11. Check win conditions
```

---

## Ranked Match Flow

```
Player A submits bot → Compile → IR validated
Player B submits bot → Compile → IR validated
                ↓
        Matchmaking queue
        (Elo-based pairing)
                ↓
        Server creates match
        (seeded arena, both programs loaded)
                ↓
        Deterministic simulation runs
        (N ticks until win condition)
                ↓
        Results recorded
        ├── Replay persisted
        ├── Elo updated
        └── Match record stored
```

---

## Tournament System

### Supported Formats
- **Single Elimination**: Classic bracket, losers eliminated
- **Round Robin**: Every bot plays every other bot, most wins takes it
- **Swiss**: Paired by similar record each round, efficient for large fields

### Tournament Flow
```
Registration phase → Seeding (by Elo) → Generate bracket/pairings
    → Run rounds (each match is a full server-authoritative sim)
    → Update standings → Next round or declare winner
```

---

## Multiplayer Architecture

- **Lobby system**: Players create/join lobbies, select bots
- **Match types**: 1v1 ranked, 1v1 unranked, 2v2 team, free-for-all, tournament
- **Spectator mode**: Watch live matches via replay stream
- **Match orchestration**: Server queues, runs, and stores all competitive matches

---

## Game Balance Constants (PoC defaults)

| Parameter | Value |
|-----------|-------|
| Arena size | 100×100 units |
| Tick rate | 30 ticks/sec |
| Max ticks per match | 3000 (100 sec) |
| Robot base health | 100 |
| Robot move speed | 2.0 units/tick |
| Attack damage | 10 |
| Attack range | 5.0 units |
| Attack cooldown | 5 ticks |
| LOS range | 20.0 units |
| Budget per tick | 1000 instructions |

---

## PoC Success Criteria

1. **Compiler works**: Parse ArenaScript source → AST → bytecode
2. **VM executes**: Bytecode runs deterministically with budget limits
3. **Arena simulates**: Bots move, fight, and die in a tick-based loop
4. **Replays work**: Match can be reconstructed from replay data
5. **Ranked matches**: Elo ratings update after server-authoritative matches
6. **Tournaments run**: Bracket generation, match execution, standings
7. **Multiplayer ready**: Lobby creation, matchmaking queue, match orchestration
8. **Deterministic**: Same inputs → identical replay every time
