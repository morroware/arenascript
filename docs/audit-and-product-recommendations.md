# ArenaScript Audit & Product Improvement Plan

## Executive Summary

This audit reviewed the compiler/runtime, simulation engine, server orchestration layer, and front-end integration. The language and engine core are already in good shape and include a meaningful regression suite. The highest-impact issues identified were in the PHP multiplayer orchestration path, where lobby modes with more than two participants could silently execute as two-player matches or be mislabeled.

### Bugs fixed in this pass

1. **Unranked match mode coercion bug (PHP):**
   - `runUnrankedMatch` always forced `mode = 1v1_unranked`, even for `2v2` / `ffa` requests.
   - Impact: metadata/config mismatch and incorrect mode propagation.

2. **Lobby participant truncation bug (PHP):**
   - `startMatch` only passed the first two players to the runner, even when lobby mode allowed 4+ players.
   - Impact: dropped players at match start, invalid results for 2v2/FFA.

3. **Matchmaking fairness gap (PHP):**
   - Elo acceptance window only used player 1's queue wait time.
   - Impact: players who waited longer but were compared as player 2 could be matched later than intended.

## Architectural Observations

## Language (ArenaScript)

Strengths:
- Clean event-driven model for bot behavior.
- Good safety checks (duplicate state vars, unknown events, tokenizer/parser edge cases).
- Strong feature growth (squads, tactical primitives, sensors, mines, pickups).

Gaps / opportunities:
- Team authoring ergonomics for squads are still low-level.
- No explicit package/import model for shared utility logic.
- Limited debugging affordances in-script (breakpoint-esque tracing, deterministic replay bookmarks).

## Engine

Strengths:
- Deterministic tick architecture and replay model.
- Functional split by subsystem (`movement`, `combat`, `sensors`, `events`, `tick`).
- Runtime budgets and recursion/stack protections are present.

Gaps / opportunities:
- Add formal differential tests comparing JS and PHP server behavior while PHP engine remains partial.
- Expand property-based tests for invariants (health bounds, resource conservation, no NaN positions).

## Multiplayer/server

Strengths:
- Clear queue/rating/lobby abstractions.
- Server-authoritative orchestration pattern is correct directionally.

Gaps / opportunities:
- PHP layer still contains orchestration stub semantics and partial parity with JS behavior.
- Mode-specific validation should be centralized (required player counts, team shape).

## UI / Product UX

Current UX can be meaningfully improved with a "builder + IDE + arena" model:

### Recommended UX roadmap

1. **Team Builder (high priority)**
   - Add a dedicated Team Builder panel with:
     - role slots (frontline/flanker/support/scout),
     - per-slot script assignment,
     - shared constants profile,
     - quick clone/swap operations.
   - Include one-click generation for common formations.

2. **Split IDE + Arena Workspace (high priority)**
   - Introduce a layout mode:
     - left: full code IDE (tabs for squad members),
     - right: full-height live arena/replay,
     - bottom: compile/runtime diagnostics timeline.
   - Add synchronized replay scrubber + event log jump-to-line.

3. **Full-page Battle Viewer (high priority)**
   - Add dedicated route for battle visualization:
     - large canvas,
     - fog/LOS overlays,
     - health/energy strip per robot,
     - tactical markers (mines, grenades, scans).

4. **Debugging tools (medium priority)**
   - Deterministic seed pinning in UI.
   - Frame bookmarks (e.g., first damage, first death, objective capture start/end).
   - Per-bot decision trace (which event fired, action selected, budget used).

5. **Language quality-of-life (medium priority)**
   - Macro-like helpers for repeated conditional patterns.
   - Optional typed constants / lint hints.
   - Better diagnostics: "did you mean" suggestions for event/action names.

6. **Competitive systems (medium priority)**
   - Ranked season metadata and leaderboard history.
   - Matchmaking transparency UI (current estimated rating window).
   - Replay sharing links with immutable match hash.

## Engineering hardening backlog

1. Add API-level contract tests for lobby/matchmaking/ranked endpoints.
2. Add end-to-end fixture tests for `2v2` and `ffa` in both JS and PHP server paths.
3. Add static checks (PHPStan/Psalm + ESLint) and CI gate for regressions.
4. Add explicit schema validators for request payloads (program/constants/config).
5. Add telemetry counters: queue wait, abandonment, compile failures, replay load failures.

## Suggested implementation sequence

1. **Stabilize multiplayer correctness** (done in this patch for identified PHP issues).
2. **Ship Team Builder + workspace split** (largest UX lift with immediate impact).
3. **Add Battle Viewer route + replay diagnostics overlays**.
4. **Expand language ergonomics and debugging primitives**.
5. **Invest in ranked/live-service visibility tooling**.

