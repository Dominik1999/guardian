# Public Status Endpoint + Status Homepage — Design

**Date:** 2026-06-17
**Status:** Approved (design)

## Problem

The Guardian server already knows its own version (`CARGO_PKG_VERSION`), git SHA,
and network, but only exposes them through the **authenticated** `GET /dashboard/info`.
There is no public, unauthenticated way to ask a running Guardian "are you up, and
which version are you?".

Two consumers need this:

1. **The wallet client** wants a pre-auth liveness + version + network check against
   the single Guardian it talks to.
2. **A dedicated homepage** should show, at a glance, which Guardians are running and
   with which version.

Guardians are fully independent — one Guardian is one `crates/server` process, one
deployment, one database. They do **not** discover or coordinate with each other.
Therefore the homepage cannot ask one Guardian "who are the others"; it must be given
a list.

## Approach (chosen)

- Add a single **public `GET /status`** endpoint to the server. It serves both
  consumers: the wallet calls its own Guardian's `/status`; the homepage polls a
  **configured list** of Guardian `/status` URLs client-side and aggregates the
  results into a table.
- No peer discovery, no self-registration/heartbeats, no coordinating backend. The
  homepage's Guardian list comes from static config committed/configured at deploy
  time.

Alternatives considered and rejected (per scope decision): one Guardian aggregating a
peer list server-side ("special node"), and a central registry service Guardians
heartbeat into (new service, new state, new failure mode). Both are heavier than the
requirement and were deferred.

## Components

### 1. Server — `GET /status`

- **Route registration:** top level of the router in
  `crates/server/src/builder/handle.rs`, next to the existing unauthenticated
  `/pubkey` route. No new middleware; the existing CORS layer covers it so the
  homepage can poll cross-origin.
- **Handler:** new function in `crates/server/src/api/http.rs`, documented with the
  existing `#[utoipa::path]` macro so it appears in the generated OpenAPI spec.
  Signature mirrors existing unauthenticated handlers:
  `async fn status(State(state): State<AppState>) -> Result<Json<StatusResponse>, GuardianError>`.
- **Service:** new `crates/server/src/services/status.rs` that assembles the response
  from already-available state (no new I/O, no storage access).

Response body (`200 OK`, `application/json`):

```json
{
  "status": "ok",
  "version": "0.1.0",
  "git_commit": "a1b2c3d4e5f6",
  "network": "MidenDevnet",
  "started_at": "2026-06-17T10:00:00Z",
  "uptime_seconds": 3600
}
```

Field sources:

| Field | Source |
|---|---|
| `status` | constant `"ok"` — a 200 response *is* the liveness signal |
| `version` | `build_info::VERSION` (`CARGO_PKG_VERSION`) |
| `git_commit` | `build_info::GIT_SHA` (`"unknown"` when unset at build time) |
| `network` | `NetworkType` reachable via `AppState` / `DashboardState` |
| `started_at` | reuse the `DashboardState` startup timestamp already surfaced by `/dashboard/info` (single source of truth — no new field) |
| `uptime_seconds` | `clock.now() − started_at`, using the existing `AppState.clock` |

**Safety:** the payload contains no account data, no operator/auth data, and no
inventory counts. It is safe to expose unauthenticated. No computed health/degraded
flag is included (out of scope per design discussion).

### 2. Wallet client — `getStatus()` in `packages/guardian-client`

- New `getStatus()` method on the HTTP client in `packages/guardian-client/src/http.ts`,
  modeled exactly on the existing unauthenticated `getPubkey()` — `this.fetch('/status', { method: 'GET' })`.
- New `StatusResponse` type in `packages/guardian-client/src/types.ts` and the
  server-shape type in `packages/guardian-client/src/server-types.ts`; export from
  `packages/guardian-client/src/index.ts`.
- This is the concrete meaning of "status endpoint for the wallet": the wallet calls
  `client.getStatus()`.

### 3. Homepage — `examples/status-homepage/`

- New Vite + React app, matching the structure/tooling of
  `examples/operator-smoke-web/` so it reuses the repo's existing frontend setup.
- Reads a **configured list of Guardian URLs** — a committed/deploy-time
  `guardians.json` (or `VITE_GUARDIAN_URLS` env var). No discovery, no backend.
- On load and on a fixed interval, `fetch('<url>/status')` for each Guardian,
  client-side.
- Renders a table: **Guardian (name/URL) · status (up/down) · version · git commit ·
  network · uptime**. A failed or timed-out fetch renders that Guardian as **down**
  rather than breaking the page.
- Output is fully static — deployable to any static host (S3, the same ALB, etc.).

## Data flow

```
wallet   ──► GET /status ──► one Guardian                       (liveness + version check)
homepage ──► GET /status ──► each Guardian in guardians.json    (aggregated table)
```

## Testing

- **Rust:** unit test for the status service asserting all fields and the absence of
  sensitive data; a router-level test that `GET /status` returns `200` without
  authentication.
- **TS client:** `getStatus()` unit test mirroring the existing `getPubkey` test in
  `packages/guardian-client/src/http.test.ts`.
- **Homepage:** a render test over a mocked multi-Guardian response that includes one
  "down" entry, asserting the table renders all rows and marks the down one correctly.

## Out of scope (YAGNI)

Peer discovery, self-registration/heartbeats, a coordinating backend, and historical
uptime tracking are all deferred. The homepage's Guardian list is static config.
