# ArenaScript PHP Backend

The backend is a thin coordination + persistence layer on top of the JS
simulation engine. It is intentionally small: the deterministic match engine
lives entirely in JavaScript (`js/engine/`), and the PHP side is responsible
for ranking, lobby state, tournament brackets, matchmaking queue, and match
history storage.

## Design notes

- **JS is authoritative for simulation.** Clients run matches in-browser
  with the deterministic JS engine and submit the result to the server. The
  server validates the structural shape but does not (yet) re-run the match
  to catch cheating.
- **File-backed JSON persistence.** All state lives under `api/.storage/` as
  JSON files guarded by `flock()` and atomic rename. Good enough for beta,
  swap for SQLite/Redis when ladder volume demands it. `api/.storage/` is
  gitignored.
- **Anonymous token auth.** `POST /api/auth.php` mints a 32-hex bearer token.
  Clients send it in `X-Arena-Player` on every authenticated request. There
  is no account system — the token *is* the identity.

## Running locally

```bash
php -S 127.0.0.1:8000 -t .
```

Then hit the endpoints at `http://127.0.0.1:8000/api/*.php`.

All responses are `application/json`. Errors use
`{ "error": "<message>", "status": <http-status> }`.

## Endpoints

### `GET /api/config.php`

Returns engine version, language version, arena size, tick rate, budget
caps, ranked parameters, and class stats. Used by the frontend to stay in
sync with server-side balance constants.

### `POST /api/auth.php`

Issues a new anonymous player token.

```json
{ "playerId": "3f1a..b9", "note": "..." }
```

Store the token in `localStorage` and send it back in `X-Arena-Player` on
every authenticated call. Calling `/auth.php` again mints a fresh token —
existing tokens remain valid.

### `GET /api/ranked.php?player=<id>`

Returns a player's Elo + tier + W/L/D record. Creates the record on first
lookup with `INITIAL_ELO = 1000`.

### `GET /api/ranked.php?leaderboard=1&limit=100`

Returns the top `limit` players by Elo (descending).

### `POST /api/ranked.php`

Record the result of a ranked match. Prefer to submit through
`/match-runner.php` instead — it writes to both history *and* ratings in a
single request. This endpoint exists for direct rating management (e.g.
admin tooling).

```json
{ "winner": "playerA", "loser": "playerB", "matchId": "match_..." }
// or:
{ "draw": ["playerA", "playerB"], "matchId": "match_..." }
```

### `GET /api/matchmaking.php`

Returns current queue size and the list of queued player IDs.

### `POST /api/matchmaking.php` *(auth required)*

```json
{ "action": "enqueue", "program": { ... }, "constants": [], "mode": "1v1_ranked" }
```

```json
{ "action": "tryMatch" }
```

`tryMatch` returns `{ matched: true, pairing: { player1, player2, config } }`
when two compatible players (same mode, Elo within the expanding window) are
found. Both players are atomically removed from the queue.

### `DELETE /api/matchmaking.php` *(auth required)*

Removes the authenticated player from the queue.

### `GET /api/lobby.php`

Lists lobbies in status `waiting`.

### `GET /api/lobby.php?id=<lobbyId>`

Returns a single lobby.

### `POST /api/lobby.php` *(auth required)*

```json
{ "action": "create", "name": "My Lobby", "mode": "1v1_unranked" }
{ "action": "join",   "lobbyId": "lobby_..." }
{ "action": "submit", "lobbyId": "lobby_...", "program": { ... }, "constants": [] }
{ "action": "start",  "lobbyId": "lobby_..." }
{ "action": "complete", "lobbyId": "lobby_...", "result": { "winner": 0, "tickCount": 500, "reason": "...", "seed": 42 } }
```

- `create` — creates a lobby with you as host. Modes: `1v1_unranked`, `2v2`,
  `squad_2v2`, `ffa`.
- `join` — adds you to an existing waiting lobby.
- `submit` — submits your compiled program for the lobby. When every player
  has submitted, the lobby transitions to `ready`.
- `start` — host-only. Transitions the lobby to `in_match` and returns the
  `setup` payload to feed to the JS `runMatch()` function.
- `complete` — any participant can call this with the match result after
  `runMatch` finishes client-side.

### `DELETE /api/lobby.php` *(auth required)*

```json
{ "lobbyId": "lobby_..." }
```

Leaves the lobby. Cannot leave a lobby in `in_match` state.

### `POST /api/match-runner.php` *(auth required)*

Report a completed match. The reporter must be one of the participants
listed in the payload.

```json
{
  "config":       { "mode": "1v1_ranked", "arenaWidth": 140, "arenaHeight": 140, "maxTicks": 3000, "tickRate": 30, "seed": 1234 },
  "participants": [
    { "playerId": "...", "teamId": 0, "program": { "programId": "...", "robotName": "...", "robotClass": "ranger", "bytecode": [0,1,2,...] } },
    { "playerId": "...", "teamId": 1, "program": { ... } }
  ],
  "result": { "winner": 0, "tickCount": 500, "reason": "elimination", "seed": 1234 },
  "replay": { ... optional replay blob ... }
}
```

The server:

1. Structurally validates config/participants/result/program shapes.
2. Verifies `config.seed === result.seed`.
3. Persists the match record to history (capped at 1000 most-recent matches).
4. Stores the optional replay blob keyed by the generated `matchId`.
5. If mode is `1v1_ranked`, updates Elo ratings via `RatingStore`.

### `GET /api/match-runner.php?limit=50`

Returns recent match history, most recent first.

### `GET /api/match-runner.php?match=<matchId>`

Fetch a stored replay by match id.

### `GET /api/tournament.php`

List all tournaments.

### `GET /api/tournament.php?id=<tournamentId>` / `&standings=1`

Tournament detail, or sorted standings.

### `POST /api/tournament.php` *(auth required)*

```json
{ "action": "create", "name": "...", "format": "single_elimination", "entries": [ { "playerId": "...", "elo": 1200 }, ... ], "seed": 42 }
{ "action": "report", "tournamentId": "tournament_...", "matchIndex": 0, "winner": 0 }
```

Formats: `single_elimination`, `round_robin`, `swiss`. The first round is
generated at creation time; subsequent rounds auto-generate when every match
in the current round has been reported.

## What's deliberately NOT here (yet)

- **Server-authoritative simulation.** Porting the 17k-LOC JS engine to PHP
  would be a separate project. The current model trusts the client's match
  result. This is acceptable for friendly beta testing; a competitive ladder
  would need the server to re-run the match and reject mismatches.
- **Real accounts / passwords.** Anonymous tokens only.
- **Rate limiting.** Rely on your host's fail2ban/WAF.
- **CSRF protection.** `X-Arena-Player` doubles as a custom header that
  browsers won't send cross-origin without a CORS preflight, which gives
  basic CSRF resistance. Tighten the CORS allowlist in `_bootstrap.php` if
  you host the API on a different origin than the frontend.

## MySQL + Account APIs (`/api/v1/*`)

A new MySQL-backed API foundation is available for real multi-user accounts and saved bots.

### Environment variables

Set these before using `/api/v1/*` endpoints:

- `ARENA_DB_ENABLED=1`
- `ARENA_DB_HOST=127.0.0.1`
- `ARENA_DB_PORT=3306`
- `ARENA_DB_NAME=arenascript`
- `ARENA_DB_USER=...`
- `ARENA_DB_PASS=...`
- `ARENA_SESSION_TTL_HOURS=336` (optional)

### Migration

Apply the schema in:

- `api/migrations/001_mysql_core.sql`

### Auth endpoints

- `POST /api/v1/auth/register` `{ email, username, password }`
- `POST /api/v1/auth/login` `{ identity, password }`
- `POST /api/v1/auth/logout` (requires `Authorization: Bearer <token>`)
- `GET /api/v1/auth/me` (requires bearer token)

### Bots endpoints

- `GET /api/v1/bots/index.php`
- `POST /api/v1/bots/index.php`
- `GET /api/v1/bots/versions.php?botId=<id>`
- `POST /api/v1/bots/versions.php?botId=<id>`

### Admin endpoints

- `GET /api/v1/admin/users.php` (admin role)
- `POST /api/v1/admin/suspend-user.php` (admin role)

### Competitive migrations

Also apply:

- `api/migrations/002_competitive_core.sql`

### Additional v1 endpoints

- `GET /api/v1/leaderboard.php?queue=1v1_ranked&limit=100`
- `POST /api/v1/matches/report.php`
- `GET /api/v1/lobbies/index.php`
- `POST /api/v1/lobbies/index.php` with `{ action: "create" | "join", ... }`
- `DELETE /api/v1/lobbies/index.php` with `{ lobbyId }`

## Easy shared-hosting install (`api/install.php`)

For cPanel/shared hosting, use the installer:

1. Create a MySQL database + DB user from cPanel.
2. Open `https://your-domain/api/install.php`.
3. Enter DB credentials + first admin account and submit.
4. Installer will:
   - run migrations `001_mysql_core.sql` and `002_competitive_core.sql`,
   - create/update the admin user,
   - write `api/.env.local`,
   - create `api/.installed.lock` to prevent accidental re-runs.

**Important security step:** after successful install, remove or restrict `api/install.php`.

### Beta hardening checklist

- Set `ARENA_CORS_ORIGIN=https://your-frontend-domain.example` in production.
- Keep `ARENA_ALLOW_INSTALLER` unset in production (set to `1` only temporarily during install).
- Keep installer locked (`api/.installed.lock`) and remove `api/install.php` after setup.
- Login/register and match-report endpoints include fixed-window IP rate limits; keep external WAF/rate limiting enabled too.

### Quick automated checks

Run:

```bash
./scripts/check_beta_readiness.sh
```
