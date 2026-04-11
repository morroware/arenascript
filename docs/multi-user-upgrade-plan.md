# ArenaScript Massive Multi-User + UI Excellence Upgrade Plan

## 1) Current-State Review (What exists today)

### Frontend / UX
- Single-page vanilla JS app with three main tabs (Builder, Arena, My Bots), one large monolithic `index.html`, and stateful behavior in `js/app.js`.
- Bot library is browser-local only (`localStorage`) and not tied to authenticated user accounts.
- UI has strong base structure but no design system tokenization, no component-level visual regression guardrails, and limited accessibility/process rigor.

### Backend / Identity
- PHP API endpoints exist for auth, lobbies, matchmaking, ranked, tournaments, and match reporting.
- Identity is currently anonymous bearer token issuance via `POST /api/auth.php` and header forwarding (`X-Arena-Player`).
- Persistence is file-backed JSON (`api/.storage`) using `JsonStore`; no relational schema, no durable account model, no role-based administration.

### Trust/Security Model
- Client-side match simulation is authoritative and server validates only payload shape/consistency.
- No full account lifecycle (email/password reset/session revocation), no RBAC, no moderation/admin audit trail.

---

## 2) Target Product Goals

1. **True multi-user platform**
   - User registration/login, profiles, sessions, and secure credential handling.
2. **MySQL-backed durable data model**
   - Replace JSON file stores with relational persistence and transactional integrity.
3. **Saved bots, teams, and version history**
   - Per-user bot library with drafts, publishes, tags, and sharing controls.
4. **Admins/moderators + operations tooling**
   - Role-based administration, abuse controls, and auditable actions.
5. **"Perfect" UI execution**
   - High-end UX polish, accessibility, responsive quality, consistency, and measurable quality gates.

---

## 3) Architecture Direction

## 3.1 Data Layer: MySQL First
Introduce a data access boundary in PHP (`Repository`/`Service` pattern) and migrate endpoint logic off `JsonStore`.

### Core MySQL schema (v1)
- `users`
  - `id`, `email` (unique), `username` (unique), `password_hash`, `status`, `created_at`, `updated_at`, `last_login_at`
- `sessions`
  - `id`, `user_id`, `token_hash`, `ip`, `user_agent`, `expires_at`, `revoked_at`, `created_at`
- `roles`
  - `id`, `name` (`user`, `moderator`, `admin`)
- `user_roles`
  - `user_id`, `role_id`
- `bots`
  - `id`, `owner_user_id`, `name`, `slug`, `visibility` (`private`, `unlisted`, `public`), `active_version_id`, `created_at`, `updated_at`
- `bot_versions`
  - `id`, `bot_id`, `version_label`, `source_code`, `compiled_program_json`, `constants_json`, `language_version`, `created_by_user_id`, `created_at`
- `bot_tags`
  - `id`, `bot_id`, `tag`
- `matches`
  - `id`, `mode`, `seed`, `tick_count`, `winner_team`, `reason`, `reported_by_user_id`, `created_at`
- `match_participants`
  - `id`, `match_id`, `user_id`, `team_id`, `bot_version_id`, `result`, `elo_before`, `elo_after`
- `ratings`
  - `user_id`, `queue`, `elo`, `wins`, `losses`, `draws`, `provisional_games`, `updated_at`
- `lobbies`
  - `id`, `host_user_id`, `mode`, `status`, `settings_json`, `created_at`, `updated_at`
- `lobby_players`
  - `id`, `lobby_id`, `user_id`, `slot_index`, `ready_state`, `submitted_bot_version_id`
- `tournaments`, `tournament_entries`, `tournament_rounds`, `tournament_matches`
- `admin_audit_log`
  - `id`, `actor_user_id`, `action`, `entity_type`, `entity_id`, `metadata_json`, `created_at`

### Database quality requirements
- Strict foreign keys.
- Transaction usage for ranked updates, matchmaking dequeue/match creation, and lobby state transitions.
- Indexed hot paths:
  - `ratings(queue, elo)`, `lobbies(status)`, `matches(created_at)`, `bot_versions(bot_id, created_at)`.

## 3.2 Auth + Security
- Replace anonymous token model with:
  - Registration + email/password login.
  - Argon2id password hashes.
  - Rotating session tokens (store token hash in DB; set secure cookie or Authorization bearer token).
- Add:
  - CSRF protection for cookie flows.
  - Rate limiting (login and match-report endpoints).
  - Account verification/reset flows (phase 2 if email infra pending).

## 3.3 RBAC (Users/Admins)
- Role checks in endpoint middleware (`as_require_role('admin')`).
- Moderator/Admin capabilities:
  - Ban/suspend accounts.
  - Hide abusive public bots.
  - Recalculate ladder batch jobs.
  - View audit logs and suspicious match patterns.

## 3.4 Simulation Integrity (Roadmap)
- Phase 1: keep current client-submitted results, add stronger anti-tamper heuristics and anomaly scoring.
- Phase 2: build server re-simulation worker (Node process or queue workers) and compare deterministic outputs for ranked matches.

---

## 4) UI Excellence Program ("Perfect UI" focus)

## 4.1 Product UX redesign scope
- New information architecture:
  - **Home/Dashboard**: account status, recent matches, quick actions.
  - **Bot Studio**: code editor + versions + metadata + test run panel.
  - **Arena/Replay**: match runner + replay analysis timeline.
  - **Ladder**: rankings, filters, profile drill-down.
  - **Admin Console** (role-protected): moderation and system controls.

## 4.2 Design System
- Create reusable design tokens in CSS variables:
  - color semantic tokens, spacing scale, typography scale, radii, elevation, motion curves.
- Normalize components:
  - buttons, fields, tabs, cards, tables, modals, toasts, empty states, skeleton loaders.
- Dark/light theme readiness with WCAG AA contrast minimum.

## 4.3 UX quality bar
- Accessibility:
  - Keyboard-only complete flows, logical tab order, focus-visible states, ARIA correctness.
  - Screen-reader labels for all interactive controls and live regions for compile/run feedback.
- Responsiveness:
  - first-class layouts for 320px mobile through ultrawide.
- Performance:
  - target p75 interaction latency <100ms for common UI actions.
- Reliability:
  - graceful API-error boundaries, retries for idempotent fetches, offline draft recovery.

## 4.4 Frontend architecture modernization
- Split monolithic `js/app.js` into feature modules:
  - `app/state`, `app/api`, `features/editor`, `features/library`, `features/match`, `features/account`, `features/admin`.
- Introduce client-side routing and a central state store (lightweight pattern acceptable; no heavy framework required if team prefers vanilla).
- Add strict API client typing contracts (JSDoc typedefs or TypeScript migration path).

---

## 5) API Evolution Plan

## 5.1 Versioned API
- Introduce `/api/v1/*` while keeping legacy endpoints during migration.
- Planned endpoints (minimum):
  - `POST /api/v1/auth/register`
  - `POST /api/v1/auth/login`
  - `POST /api/v1/auth/logout`
  - `GET /api/v1/me`
  - `GET /api/v1/bots`
  - `POST /api/v1/bots`
  - `POST /api/v1/bots/{id}/versions`
  - `POST /api/v1/lobbies`
  - `POST /api/v1/matches/report`
  - `GET /api/v1/leaderboard`
  - `GET /api/v1/admin/users` (admin)
  - `POST /api/v1/admin/users/{id}/suspend` (admin)

## 5.2 Compatibility strategy
- Keep existing anonymous flow functional behind a feature flag during transition.
- Add migration script that maps legacy token identities to provisional user records where possible.

---

## 6) Delivery Plan (Phased)

## Phase 0 — Discovery + technical foundation (1-2 weeks)
- Finalize requirements and UX maps.
- Add migration framework for MySQL schema changes.
- Create API contract docs + threat model.

## Phase 1 — Accounts + MySQL cutover + saved bots (2-4 weeks)
- Implement users/sessions/RBAC base.
- Migrate bot library from local-only to server-backed storage.
- Ship account pages and authenticated "My Bots" sync.

## Phase 2 — Multiplayer/ranked on relational core (2-4 weeks)
- Move lobby/matchmaking/ranked/tournament persistence to MySQL.
- Add transactional ranked updates + leaderboard APIs.
- Improve match-report validation and abuse telemetry.

## Phase 3 — UI perfection sprint (2-3 weeks, parallelizable)
- Design-system rollout and page-level polish.
- Accessibility audit/remediation.
- Frontend performance and replay UX upgrades.

## Phase 4 — Admin tooling + observability + hardening (1-2 weeks)
- Admin console, audit log browser, moderation workflows.
- Logging/metrics dashboards, SLO alerting, backup and restore drills.

---

## 7) Testing & Quality Strategy

- Backend:
  - Unit tests for repositories/services.
  - Integration tests against ephemeral MySQL.
  - Contract tests for `/api/v1` payloads.
- Frontend:
  - Component/state tests.
  - End-to-end tests for login, bot save/version, lobby flow.
  - Visual regression snapshots for critical screens.
- Accessibility:
  - Automated axe checks + manual keyboard/screen-reader passes.
- Migration:
  - Dry-run DB migration scripts in staging.
  - Data consistency verification scripts.

---

## 8) Operational Considerations

- Environments: local/dev/staging/prod parity with real MySQL in staging.
- Secrets: env-based secrets, rotation policy, no credentials in repo.
- Backups: automated snapshots + restore test cadence.
- Observability:
  - structured logs with request/user correlation IDs,
  - metrics (auth success rate, API p95 latency, match-report failures),
  - alerting thresholds by endpoint.

---

## 9) Immediate Next Actions (Concrete)

1. Approve this plan and prioritize MVP scope:
   - **MVP**: accounts + saved bots + RBAC + MySQL migration for bots/ranked/lobbies.
2. Decide auth UX policy:
   - email-verified at signup vs deferred verification.
3. Decide frontend modernization path:
   - remain vanilla modular JS vs TypeScript incremental migration.
4. Create implementation epic breakdown with owners and acceptance criteria.
5. Start Phase 0 artifacts:
   - ERD, API spec, wireframes, and migration scaffolding PRs.

---

## 10) Risk Register

- **Risk:** Scope too broad for one release.
  - **Mitigation:** Ship in phases with strict MVP gate.
- **Risk:** Data migration regressions.
  - **Mitigation:** dual-write/read toggles and staged rollout.
- **Risk:** UI rewrite stalls gameplay features.
  - **Mitigation:** design-system-first incremental refactor.
- **Risk:** Cheating in ranked remains possible until re-sim shipped.
  - **Mitigation:** anomaly detection + replay audits as interim control.

