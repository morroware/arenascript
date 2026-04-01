# ArenaScript Audit & Product Improvement Plan

## Executive Summary

This is a living engineering audit for ArenaScript (compiler/runtime, simulation engine, multiplayer orchestration, and product UX).

Current status:
- Core compiler/runtime/engine behavior is covered by a regression suite and deterministic replay checks.
- Multiplayer orchestration now supports multi-participant unranked starts through `runUnrankedMatchWithParticipants`.
- Match setup validation is centralized in `js/shared/validation.js` and now rejects non-finite arena dimensions (`NaN`, `Infinity`) to prevent malformed configs from reaching engine code.

### Recently addressed defects

1. **Unranked mode coercion (PHP) — resolved**
   - `runUnrankedMatch` no longer rewrites non-ranked modes incorrectly.

2. **Lobby participant truncation (PHP) — resolved**
   - Lobby starts can pass all ready players into unranked participant-aware runner path.

3. **Queue fairness asymmetry (PHP) — resolved**
   - Match window now considers both players' queue wait expansion.

4. **Non-finite arena dimension acceptance (JS validation) — resolved**
   - `validateMatchConfig` now enforces finite positive `arenaWidth` / `arenaHeight`.

### Improvements shipped in this pass

5. **Engine invariant test suite — shipped**
   - Property-based tests covering: health bounds, no NaN positions, energy bounds, arena boundary enforcement, dead-robot consistency, deterministic replay, and frame generation (`js/tests/engine-invariant-tests.js`, 8 tests).

6. **API contract & E2E test suite — shipped**
   - 36 tests covering lobby lifecycle, matchmaking queue/pairing, Elo calculations, rank tiers, rating store, validation contracts, plus end-to-end 2v2 and FFA match execution (`js/tests/api-contract-tests.js`).

7. **Per-bot decision trace capture — shipped**
   - Engine tick loop now captures which event fired, action selected, and budget consumed per robot per tick.
   - Decision traces are stored in replay frames for post-match analysis.

8. **Enhanced Battle Viewer — shipped**
   - Energy bars rendered below health bars for each robot.
   - Shield/overwatch action indicators (glowing/dotted rings).
   - Damage numbers float above robots on hit.
   - Grenade explosion blast radius overlay.
   - "DESTROYED" flash on robot elimination.
   - Decision trace overlay toggled via "Traces" button (shows action + budget per robot).

9. **Team Builder UI — shipped**
   - New sidebar panel with up to 5 role/script slots.
   - Role selection (frontline, flanker, support, scout) per slot.
   - Script assignment per slot from available presets.
   - Auto-mirrors team size for opponents and runs match.

10. **Full-page Battle Viewer — shipped**
    - "Expand" toggle hides editor/sidebar/console for large-canvas battle viewing.
    - Canvas auto-resizes to fill viewport; match results float as overlay.

11. **Debugging tools — shipped**
    - Decision trace overlay in arena view (action + budget per bot per tick).
    - Replay bookmark buttons (first damage, first kill) already present in controls.

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

1. **Team Builder (high priority)** — **Shipped**
   - Dedicated Team Builder panel in sidebar with:
     - role slots (frontline/flanker/support/scout),
     - per-slot script assignment from presets,
     - add/remove slots (up to 5),
     - auto-mirror opponent generation and one-click match run.
   - *Remaining*: shared constants profile, quick clone/swap operations.

2. **Split IDE + Arena Workspace (high priority)** — **Shipped (baseline)**
   - Layout already has: left IDE, right arena, bottom console.
   - Resizable split with drag handle.
   - Replay scrubber with event log and bookmark jump-to-line.
   - *Remaining*: tabs for squad members, diagnostics timeline.

3. **Full-page Battle Viewer (high priority)** — **Shipped**
   - "Expand" toggle hides editor/sidebar/console for full-viewport canvas.
   - Health + energy bars per robot.
   - Tactical markers: mines, pickups, grenade blasts, shield/overwatch rings, damage numbers.
   - Match results as floating overlay in full-page mode.
   - *Remaining*: fog/LOS overlays, scan area visualization.

4. **Debugging tools (medium priority)** — **Shipped**
   - Deterministic seed pinning in UI (seed input field).
   - Frame bookmarks: first damage, first kill (buttons in replay controls).
   - Per-bot decision trace overlay: event fired, action selected, budget used (toggle via "Traces" button).
   - Decision traces stored in replay frames for offline analysis.
   - *Remaining*: capture start/end bookmarks, step-through breakpoint mode.

5. **Language quality-of-life (medium priority)** — **Partially shipped**
   - "Did you mean" suggestions for misspelled event/action/sensor/type names (semantic analyzer).
   - *Remaining*: macro-like helpers, typed constants, lint hints.

6. **Competitive systems (medium priority)** — **Infrastructure shipped**
   - Elo rating system, rank tiers, leaderboard.
   - Matchmaking queue with Elo-range pairing.
   - *Remaining*: season metadata UI, matchmaking transparency widget, replay sharing links.

## Engineering hardening backlog

1. ~~Add API-level contract tests for lobby/matchmaking/ranked endpoints.~~ **Done** — 36 tests in `js/tests/api-contract-tests.js`.
2. ~~Add end-to-end fixture tests for `2v2` and `ffa` in both JS and PHP server paths.~~ **Done** — E2E 2v2 and FFA tests pass in JS; PHP paths pending parity.
3. Add static checks (PHPStan/Psalm + ESLint) and CI gate for regressions. *(pending)*
4. ~~Add explicit schema validators for request payloads (program/constants/config).~~ **Done** — `js/shared/validation.js` covers config, participants, match requests.
5. ~~Add telemetry counters: queue wait, abandonment, compile failures, replay load failures.~~ **Done** — `js/shared/telemetry.js` with counters integrated into `app.js`.

## Suggested implementation sequence

1. **Stabilize multiplayer correctness** — Done (PHP issues fixed).
2. **Ship Team Builder + workspace split** — Done (Team Builder panel, resize handle, full-page toggle).
3. **Add Battle Viewer + replay diagnostics overlays** — Done (energy bars, tactical markers, decision traces, bookmarks).
4. **Expand language ergonomics and debugging primitives** — Partially done ("did you mean", seed pinning, decision traces). Remaining: macros, typed constants.
5. **Invest in ranked/live-service visibility tooling** — Infrastructure done (Elo, tiers, matchmaking, telemetry). Remaining: season UI, transparency widget.
