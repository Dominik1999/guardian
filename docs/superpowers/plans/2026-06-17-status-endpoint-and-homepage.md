# Status Endpoint & Status Homepage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a public, unauthenticated `GET /status` endpoint to the Guardian server, a `getStatus()` method to the `guardian-client` TS SDK, and a static homepage that polls a configured list of Guardians and shows which are running and with which version.

**Architecture:** A single public `/status` route on each Guardian serves both consumers. The wallet calls its own Guardian's `/status`; the homepage polls a configured list of `/status` URLs client-side and aggregates them into a table. Guardians do not discover each other — the homepage's list is static config. The endpoint reuses build/version/network/startup data already present in the process; it adds no storage I/O and exposes no account/operator/auth data.

**Tech Stack:** Rust + axum + utoipa (server), TypeScript ESM (client SDK), React 19 + Vite 5 + Vitest (homepage).

## Global Constraints

- The new `/status` route MUST be unauthenticated and registered at the top level of the router (alongside `/pubkey`).
- The `/status` payload MUST NOT include account, operator, or auth data, nor inventory counts. Allowed fields only: `status`, `version`, `git_commit`, `network`, `started_at`, `uptime_seconds`.
- Version values come from `crate::build_info::VERSION` and `crate::build_info::GIT_SHA` — do not introduce a new version source.
- Server crate name is `guardian-server`. Unit tests: `cargo test -p guardian-server <filter>`. Integration tests require the feature: `cargo test -p guardian-server --features integration <filter>`.
- The integration HTTP test harness uses `crate::testing::helpers::create_router(state)` + `tower::ServiceExt::oneshot`. Note `create_router` is a **separate** router definition from production `builder/handle.rs` — any new route must be added to **both**.
- TS client is ESM (`"type": "module"`), imports use `.js` suffixes, server→client mapping converts snake_case wire fields to camelCase. TS tests run with `vitest run`.
- Homepage versions, to match the repo: React `^19.0.0`, Vite `^5.4.8`, TypeScript `^5.4.0`, Vitest `^2.1.8`.
- Git: never amend, never add `Co-Authored-By`, never push. Use the commit messages as written in each task.

## File Structure

**Server (`crates/server`)**
- Modify `src/dashboard/config.rs` — add `network` to `DashboardConfig` (derived from `NetworkType`), getter, default, unit test.
- Modify `src/dashboard/state.rs` — add `network()` getter delegating to config.
- Create `src/services/status.rs` — `StatusResponse` struct + pure `build_status(...)` fn + unit tests.
- Modify `src/services/mod.rs` — register the `status` module and re-export.
- Modify `src/api/http.rs` — `status` handler + `#[utoipa::path]`.
- Modify `src/builder/handle.rs` — register `/status` route + import.
- Modify `src/testing/helpers.rs` — register `/status` in `create_router`.
- Modify `src/openapi.rs` — register the path and the `StatusResponse` schema.
- Create `src/testing/integration/status_http.rs` — no-auth 200 route test.
- Modify `src/testing/integration/mod.rs` — register the test module.

**Client SDK (`packages/guardian-client`)**
- Modify `src/server-types.ts` — `ServerStatusResponse` (snake_case wire shape).
- Modify `src/types.ts` — `StatusResponse` (camelCase client shape).
- Modify `src/http.ts` — `getStatus()` method.
- Modify `src/index.ts` — export `StatusResponse`.
- Modify `src/http.test.ts` — `getStatus` tests.

**Homepage (`examples/status-homepage`, new)**
- `package.json`, `index.html`, `vite.config.ts`, `tsconfig.json`, `vitest.setup.ts`, `.gitignore`, `README.md`
- `src/main.tsx`, `src/index.css`, `src/vite-env.d.ts`
- `src/config.ts` — parse `VITE_GUARDIAN_URLS`
- `src/statusClient.ts` — types + `fetchStatus` / `fetchAllStatuses`
- `src/GuardianTable.tsx` — presentational table + `formatUptime`
- `src/App.tsx` — load config, poll, render table
- `src/statusClient.test.ts`, `src/GuardianTable.test.tsx`

---

### Task 1: Expose `network` from DashboardState

**Files:**
- Modify: `crates/server/src/dashboard/config.rs`
- Modify: `crates/server/src/dashboard/state.rs:413` (add getter next to `environment()`)
- Test: `crates/server/src/dashboard/config.rs` (existing `mod tests`)

**Interfaces:**
- Produces: `DashboardConfig::network(&self) -> &str`, `DashboardState::network(&self) -> &str`. Returns the `NetworkType` Display string, e.g. `"MidenDevnet"`. Defaults to `"MidenTestnet"` for `DashboardConfig::default()` (consistent with the existing `DEFAULT_ENVIRONMENT = "testnet"`).

- [ ] **Step 1: Write the failing test**

Add to the `mod tests` block in `crates/server/src/dashboard/config.rs`:

```rust
    #[test]
    fn network_is_derived_from_network_type() {
        let _cursor = EnvVarGuard::remove("GUARDIAN_DASHBOARD_CURSOR_SECRET");
        assert_eq!(
            DashboardConfig::from_env_for_network(NetworkType::MidenTestnet)
                .unwrap()
                .network(),
            "MidenTestnet"
        );
        assert_eq!(
            DashboardConfig::from_env_for_network(NetworkType::MidenDevnet)
                .unwrap()
                .network(),
            "MidenDevnet"
        );
        assert_eq!(
            DashboardConfig::from_env_for_network(NetworkType::MidenLocal)
                .unwrap()
                .network(),
            "MidenLocal"
        );
    }

    #[test]
    fn for_tests_default_network_is_testnet() {
        assert_eq!(DashboardConfig::for_tests().network(), "MidenTestnet");
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p guardian-server network_is_derived_from_network_type`
Expected: FAIL — `no method named network found for struct DashboardConfig`.

- [ ] **Step 3: Add the field, default, derivation, and getter**

In `crates/server/src/dashboard/config.rs`, add a default constant next to `DEFAULT_ENVIRONMENT`:

```rust
/// Default network identifier exposed on `GET /status`.
pub(crate) const DEFAULT_NETWORK: &str = "MidenTestnet";
```

Add the field to the `DashboardConfig` struct (next to `environment`):

```rust
    pub(crate) environment: String,
    /// Network identifier (`NetworkType` Display, e.g. `"MidenDevnet"`)
    /// exposed unauthenticated on `GET /status`.
    pub(crate) network: String,
```

Set it in `from_env_for_network` (next to `environment`):

```rust
        Ok(Self {
            environment: environment_for_network(network_type).to_string(),
            network: network_type.to_string(),
            cursor_secret,
            ..Self::default()
        })
```

Add it to the `Default` impl (next to `environment`):

```rust
            environment: DEFAULT_ENVIRONMENT.to_string(),
            network: DEFAULT_NETWORK.to_string(),
```

Add the getter next to `environment()`:

```rust
    pub(crate) fn network(&self) -> &str {
        &self.network
    }
```

- [ ] **Step 4: Add the DashboardState getter**

In `crates/server/src/dashboard/state.rs`, next to the `environment()` getter (around line 413):

```rust
    /// Network identifier surfaced unauthenticated on `GET /status`.
    pub fn network(&self) -> &str {
        self.config.network()
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test -p guardian-server -- dashboard::config::tests`
Expected: PASS (including `network_is_derived_from_network_type` and `for_tests_default_network_is_testnet`).

- [ ] **Step 6: Commit**

```bash
git add crates/server/src/dashboard/config.rs crates/server/src/dashboard/state.rs
git commit -m "feat(server): expose network identifier from DashboardState"
```

---

### Task 2: `build_status` service + `StatusResponse`

**Files:**
- Create: `crates/server/src/services/status.rs`
- Modify: `crates/server/src/services/mod.rs:11` (module list) and re-export block

**Interfaces:**
- Consumes: `crate::build_info::VERSION`, `crate::build_info::GIT_SHA`.
- Produces:
  - `StatusResponse { status: &'static str, version: &'static str, git_commit: &'static str, network: String, started_at: String, uptime_seconds: u64 }` (derives `Serialize`, `utoipa::ToSchema`).
  - `build_status(network: &str, started_at: DateTime<Utc>, now: DateTime<Utc>) -> StatusResponse`.

- [ ] **Step 1: Write the failing test**

Create `crates/server/src/services/status.rs`:

```rust
//! Public, unauthenticated server status. Assembled entirely from
//! in-process build/network/startup data — no storage I/O, no account,
//! operator, or auth data is exposed.

use chrono::{DateTime, Utc};
use serde::Serialize;

/// Response body for `GET /status`. Safe to expose unauthenticated.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, utoipa::ToSchema)]
pub struct StatusResponse {
    /// Constant `"ok"`. A 200 response is itself the liveness signal.
    pub status: &'static str,
    /// `CARGO_PKG_VERSION` of `guardian-server`.
    pub version: &'static str,
    /// Short git SHA at build time (`"unknown"` when unavailable).
    pub git_commit: &'static str,
    /// Network identifier, e.g. `"MidenDevnet"`.
    pub network: String,
    /// RFC 3339 wall-clock time the process started.
    pub started_at: String,
    /// Whole seconds since `started_at`; clamped to 0 on clock skew.
    pub uptime_seconds: u64,
}

/// Assemble the status response. Pure so it is unit-testable without an
/// `AppState`: the handler supplies `network`, `started_at`, and `now`.
pub fn build_status(network: &str, started_at: DateTime<Utc>, now: DateTime<Utc>) -> StatusResponse {
    let uptime_seconds = (now - started_at).num_seconds().max(0) as u64;
    StatusResponse {
        status: "ok",
        version: crate::build_info::VERSION,
        git_commit: crate::build_info::GIT_SHA,
        network: network.to_string(),
        started_at: started_at.to_rfc3339(),
        uptime_seconds,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(ts: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(ts).unwrap().with_timezone(&Utc)
    }

    #[test]
    fn computes_uptime_and_carries_fields() {
        let started = at("2026-06-17T10:00:00Z");
        let now = at("2026-06-17T11:00:00Z");
        let resp = build_status("MidenDevnet", started, now);

        assert_eq!(resp.status, "ok");
        assert_eq!(resp.version, crate::build_info::VERSION);
        assert_eq!(resp.git_commit, crate::build_info::GIT_SHA);
        assert_eq!(resp.network, "MidenDevnet");
        assert_eq!(resp.started_at, started.to_rfc3339());
        assert_eq!(resp.uptime_seconds, 3600);
    }

    #[test]
    fn negative_uptime_is_clamped_to_zero() {
        let started = at("2026-06-17T11:00:00Z");
        let now = at("2026-06-17T10:00:00Z");
        let resp = build_status("MidenLocal", started, now);
        assert_eq!(resp.uptime_seconds, 0);
    }

    #[test]
    fn payload_has_no_sensitive_fields() {
        let resp = build_status("MidenDevnet", at("2026-06-17T10:00:00Z"), at("2026-06-17T10:00:01Z"));
        let json = serde_json::to_value(&resp).unwrap();
        let obj = json.as_object().unwrap();
        let mut keys: Vec<&str> = obj.keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            ["git_commit", "network", "started_at", "status", "uptime_seconds", "version"]
        );
    }
}
```

- [ ] **Step 2: Register the module so the test compiles**

In `crates/server/src/services/mod.rs`, add the module declaration (keep alphabetical with neighbors — after `sign_delta_proposal`):

```rust
mod sign_delta_proposal;
mod status;
```

And add a re-export with the other `pub use` lines:

```rust
pub use status::{StatusResponse, build_status};
```

- [ ] **Step 3: Run test to verify it passes**

Run: `cargo test -p guardian-server -- services::status::tests`
Expected: PASS (3 tests).

- [ ] **Step 4: Commit**

```bash
git add crates/server/src/services/status.rs crates/server/src/services/mod.rs
git commit -m "feat(server): add build_status service and StatusResponse"
```

---

### Task 3: `/status` HTTP handler, route wiring, OpenAPI, and route test

**Files:**
- Modify: `crates/server/src/api/http.rs` (new `status` handler)
- Modify: `crates/server/src/builder/handle.rs:26-29` (import) and `:240` (route)
- Modify: `crates/server/src/testing/helpers.rs` (`create_router` route)
- Modify: `crates/server/src/openapi.rs:182,188` (path + schema)
- Create: `crates/server/src/testing/integration/status_http.rs`
- Modify: `crates/server/src/testing/integration/mod.rs` (register module)

**Interfaces:**
- Consumes: `crate::services::{build_status, StatusResponse}` (Task 2), `DashboardState::network()` (Task 1), `AppState.dashboard`, `AppState.clock`.
- Produces: `crate::api::http::status` axum handler returning `Json<StatusResponse>`; live route `GET /status`.

- [ ] **Step 1: Write the failing integration test**

Create `crates/server/src/testing/integration/status_http.rs`:

```rust
use crate::testing::helpers::{create_router, create_test_app_state};

use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use tower::ServiceExt;

#[tokio::test]
async fn status_returns_200_without_auth() {
    let state = create_test_app_state().await;
    let app = create_router(state);

    let req = Request::builder()
        .method("GET")
        .uri("/status")
        .body(Body::empty())
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();

    assert_eq!(json["status"], "ok");
    assert!(json["version"].is_string());
    assert!(json["git_commit"].is_string());
    assert!(json["network"].is_string());
    assert!(json["started_at"].is_string());
    assert!(json["uptime_seconds"].is_number());

    // Must not leak any dashboard/inventory fields.
    assert!(json.get("total_account_count").is_none());
    assert!(json.get("accounts_by_auth_method").is_none());
}
```

Register it in `crates/server/src/testing/integration/mod.rs` (alphabetical, after `proposals_http`):

```rust
mod status_http;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p guardian-server --features integration status_returns_200_without_auth`
Expected: FAIL — `create_router` has no `/status` route, so the response status is `404 NOT_FOUND` (assertion on `OK` fails).

- [ ] **Step 3: Add the handler**

In `crates/server/src/api/http.rs`, add (next to the other unauthenticated handler `get_pubkey`):

```rust
/// Public, unauthenticated liveness + identity probe. Returns the
/// server's version, git commit, network, start time, and uptime.
/// Consumed by wallet clients (pre-auth health check) and the status
/// homepage. Exposes no account, operator, or auth data.
#[utoipa::path(
    get,
    path = "/status",
    tag = "client",
    responses(
        (status = 200, description = "Server liveness, version, and network", body = crate::services::StatusResponse),
    )
)]
pub async fn status(State(state): State<AppState>) -> Json<crate::services::StatusResponse> {
    Json(crate::services::build_status(
        state.dashboard.network(),
        state.dashboard.started_at(),
        state.clock.now(),
    ))
}
```

- [ ] **Step 4: Register the production route**

In `crates/server/src/builder/handle.rs`, add `status` to the `crate::api::http::{...}` import (line 26-29 block):

```rust
use crate::api::http::{
    configure, get_delta, get_delta_proposal, get_delta_proposals, get_delta_since, get_pubkey,
    status,
```

(append `status` to the existing import list — keep the rest of the list intact).

Add the route immediately after the `/pubkey` route (line 240):

```rust
                    .route("/pubkey", get(get_pubkey))
                    .route("/status", get(status))
```

- [ ] **Step 5: Register the route in the test router**

In `crates/server/src/testing/helpers.rs`, in `create_router`, add the route after the `/pubkey` route:

```rust
        .route("/pubkey", axum::routing::get(http::get_pubkey))
        .route("/status", axum::routing::get(http::status))
```

- [ ] **Step 6: Register the OpenAPI path and schema**

In `crates/server/src/openapi.rs`, add the path to `ClientApiDoc`'s `paths(...)` (after `get_pubkey`, line 182):

```rust
        crate::api::http::get_pubkey,
        crate::api::http::status,
```

And add the schema to the same doc's `components(...)` (line 188):

```rust
    components(schemas(ApiErrorResponse, crate::services::StatusResponse)),
```

- [ ] **Step 7: Run the integration test to verify it passes**

Run: `cargo test -p guardian-server --features integration status_returns_200_without_auth`
Expected: PASS.

- [ ] **Step 8: Verify the build and OpenAPI snapshot tests still pass**

Run: `cargo test -p guardian-server -- openapi`
Expected: PASS (the generated client doc now includes `/status`; no other doc is affected).

- [ ] **Step 9: Manual smoke check**

Run (filesystem dev mode):

```bash
GUARDIAN_STORAGE_PATH=.guardian/storage \
GUARDIAN_METADATA_PATH=.guardian/metadata \
GUARDIAN_KEYSTORE_PATH=.guardian/keystore \
  cargo run -p guardian-server --bin server &
sleep 5
curl -s http://127.0.0.1:3000/status
kill %1
```

Expected: a `200` JSON body like
`{"status":"ok","version":"0.1.0","git_commit":"...","network":"MidenDevnet","started_at":"...","uptime_seconds":5}`.

- [ ] **Step 10: Commit**

```bash
git add crates/server/src/api/http.rs crates/server/src/builder/handle.rs \
        crates/server/src/testing/helpers.rs crates/server/src/openapi.rs \
        crates/server/src/testing/integration/status_http.rs \
        crates/server/src/testing/integration/mod.rs
git commit -m "feat(server): add public GET /status endpoint"
```

---

### Task 4: `getStatus()` in `guardian-client`

**Files:**
- Modify: `packages/guardian-client/src/server-types.ts`
- Modify: `packages/guardian-client/src/types.ts`
- Modify: `packages/guardian-client/src/http.ts`
- Modify: `packages/guardian-client/src/index.ts`
- Test: `packages/guardian-client/src/http.test.ts`

**Interfaces:**
- Consumes: server `GET /status` wire shape (snake_case) from Task 3.
- Produces:
  - `ServerStatusResponse { status: string; version: string; git_commit: string; network: string; started_at: string; uptime_seconds: number }`
  - `StatusResponse { status: string; version: string; gitCommit: string; network: string; startedAt: string; uptimeSeconds: number }`
  - `GuardianHttpClient.getStatus(): Promise<StatusResponse>`

- [ ] **Step 1: Write the failing test**

Add to `packages/guardian-client/src/http.test.ts`, after the `describe('getPubkey', ...)` block:

```ts
  describe('getStatus', () => {
    it('maps the server status response to camelCase', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'ok',
          version: '0.1.0',
          git_commit: 'abc123def456',
          network: 'MidenDevnet',
          started_at: '2026-06-17T10:00:00Z',
          uptime_seconds: 3600,
        }),
      });

      const status = await client.getStatus();

      expect(status).toEqual({
        status: 'ok',
        version: '0.1.0',
        gitCommit: 'abc123def456',
        network: 'MidenDevnet',
        startedAt: '2026-06-17T10:00:00Z',
        uptimeSeconds: 3600,
      });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/status',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    it('should throw GuardianHttpError on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        text: async () => 'down',
      });

      const error = await client.getStatus().catch((e) => e);
      expect(error).toBeInstanceOf(GuardianHttpError);
      expect(error.status).toBe(503);
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/guardian-client && npx vitest run src/http.test.ts -t getStatus`
Expected: FAIL — `client.getStatus is not a function`.

- [ ] **Step 3: Add the wire type**

In `packages/guardian-client/src/server-types.ts`, after `ServerPubkeyResponse`:

```ts
export interface ServerStatusResponse {
  status: string;
  version: string;
  git_commit: string;
  network: string;
  started_at: string;
  uptime_seconds: number;
}
```

- [ ] **Step 4: Add the client type**

In `packages/guardian-client/src/types.ts`, after `PubkeyResponse`:

```ts
export interface StatusResponse {
  status: string;
  version: string;
  gitCommit: string;
  network: string;
  startedAt: string;
  uptimeSeconds: number;
}
```

- [ ] **Step 5: Add the method**

In `packages/guardian-client/src/http.ts`:

Add `StatusResponse` to the `from './types.js'` import list and `ServerStatusResponse` to the `from './server-types.js'` import list.

Add the method after `getPubkey`:

```ts
  async getStatus(): Promise<StatusResponse> {
    const response = await this.fetch('/status', { method: 'GET' });
    const data = (await response.json()) as ServerStatusResponse;
    return {
      status: data.status,
      version: data.version,
      gitCommit: data.git_commit,
      network: data.network,
      startedAt: data.started_at,
      uptimeSeconds: data.uptime_seconds,
    };
  }
```

- [ ] **Step 6: Export the type**

In `packages/guardian-client/src/index.ts`, add `StatusResponse` to the `export type { ... } from './types.js'` block (after `PubkeyResponse`):

```ts
  PubkeyResponse,
  StatusResponse,
```

- [ ] **Step 7: Run tests + typecheck to verify they pass**

Run: `cd packages/guardian-client && npx vitest run src/http.test.ts -t getStatus && npm run typecheck`
Expected: both PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/guardian-client/src/server-types.ts packages/guardian-client/src/types.ts \
        packages/guardian-client/src/http.ts packages/guardian-client/src/index.ts \
        packages/guardian-client/src/http.test.ts
git commit -m "feat(client): add getStatus() to guardian-client"
```

---

### Task 5: Scaffold the status homepage

**Files (all created):**
- `examples/status-homepage/package.json`
- `examples/status-homepage/.gitignore`
- `examples/status-homepage/index.html`
- `examples/status-homepage/vite.config.ts`
- `examples/status-homepage/tsconfig.json`
- `examples/status-homepage/vitest.setup.ts`
- `examples/status-homepage/src/main.tsx`
- `examples/status-homepage/src/index.css`
- `examples/status-homepage/src/vite-env.d.ts`
- `examples/status-homepage/src/App.tsx` (placeholder; fleshed out in Task 6)

**Interfaces:**
- Produces: an installable, type-checking, buildable Vite React app with Vitest configured (jsdom). Task 6 fills in the data layer, table, and tests.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "guardian-status-homepage",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.0",
    "@testing-library/react": "^16.0.0",
    "@types/react": "^19.0.2",
    "@types/react-dom": "^19.0.2",
    "@vitejs/plugin-react": "^4.3.1",
    "jsdom": "^25.0.0",
    "typescript": "^5.4.0",
    "vite": "^5.4.8",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create `.gitignore`**

```
node_modules
dist
```

- [ ] **Step 3: Create `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Guardian Status</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Create `vite.config.ts`**

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 3004 },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './vitest.setup.ts',
  },
});
```

- [ ] **Step 5: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "vitest.setup.ts"]
}
```

- [ ] **Step 6: Create `vitest.setup.ts`**

```ts
import '@testing-library/jest-dom';
```

- [ ] **Step 7: Create `src/vite-env.d.ts`**

```ts
/// <reference types="vite/client" />
```

- [ ] **Step 8: Create `src/index.css`**

```css
body {
  font-family: system-ui, sans-serif;
  margin: 2rem;
}
table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  border: 1px solid #ddd;
  padding: 0.5rem 0.75rem;
  text-align: left;
}
```

- [ ] **Step 9: Create `src/main.tsx`**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 10: Create a placeholder `src/App.tsx`**

```tsx
export default function App() {
  return <h1>Guardians</h1>;
}
```

- [ ] **Step 11: Install, typecheck, and build**

Run:

```bash
cd examples/status-homepage && npm install && npm run typecheck && npm run build
```

Expected: install succeeds; typecheck reports no errors; `vite build` finishes with `built in ...` and creates `dist/`.

- [ ] **Step 12: Commit**

```bash
git add examples/status-homepage
git commit -m "chore(examples): scaffold status homepage"
```

---

### Task 6: Status homepage data layer, table, and tests

**Files:**
- Create: `examples/status-homepage/src/statusClient.ts`
- Create: `examples/status-homepage/src/config.ts`
- Create: `examples/status-homepage/src/GuardianTable.tsx`
- Modify: `examples/status-homepage/src/App.tsx`
- Create: `examples/status-homepage/src/statusClient.test.ts`
- Create: `examples/status-homepage/src/GuardianTable.test.tsx`
- Create: `examples/status-homepage/README.md`

**Interfaces:**
- Consumes: each Guardian's `GET /status` (snake_case wire shape).
- Produces:
  - `GuardianTarget { name: string; url: string }`
  - `GuardianStatus { status; version; gitCommit; network; startedAt; uptimeSeconds }`
  - `GuardianRow { target: GuardianTarget; online: boolean; status?: GuardianStatus; error?: string }`
  - `fetchStatus(target): Promise<GuardianRow>`, `fetchAllStatuses(targets): Promise<GuardianRow[]>`
  - `getGuardianTargets(): GuardianTarget[]`
  - `<GuardianTable rows={GuardianRow[]} />`, `formatUptime(seconds: number): string`

- [ ] **Step 1: Write the failing tests**

Create `examples/status-homepage/src/statusClient.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchStatus } from './statusClient';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('fetchStatus', () => {
  it('maps a successful /status response to a row', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          status: 'ok',
          version: '0.1.0',
          git_commit: 'abc',
          network: 'MidenDevnet',
          started_at: '2026-06-17T10:00:00Z',
          uptime_seconds: 10,
        }),
      })),
    );

    const row = await fetchStatus({ name: 'A', url: 'https://a.example/' });

    expect(row.online).toBe(true);
    expect(row.status?.gitCommit).toBe('abc');
    expect(row.status?.network).toBe('MidenDevnet');
    expect(fetch).toHaveBeenCalledWith('https://a.example/status');
  });

  it('marks a guardian down on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 503 })),
    );
    const row = await fetchStatus({ name: 'B', url: 'https://b.example' });
    expect(row.online).toBe(false);
    expect(row.error).toContain('503');
  });

  it('marks a guardian down on a network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('boom');
      }),
    );
    const row = await fetchStatus({ name: 'C', url: 'https://c.example' });
    expect(row.online).toBe(false);
    expect(row.error).toContain('boom');
  });
});
```

Create `examples/status-homepage/src/GuardianTable.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GuardianTable, formatUptime } from './GuardianTable';
import type { GuardianRow } from './statusClient';

const rows: GuardianRow[] = [
  {
    target: { name: 'Alpha', url: 'https://a.example' },
    online: true,
    status: {
      status: 'ok',
      version: '0.1.0',
      gitCommit: 'abc123',
      network: 'MidenDevnet',
      startedAt: '2026-06-17T10:00:00Z',
      uptimeSeconds: 3661,
    },
  },
  {
    target: { name: 'Beta', url: 'https://b.example' },
    online: false,
    error: 'HTTP 503',
  },
];

describe('GuardianTable', () => {
  it('renders one row per guardian and marks the down one', () => {
    render(<GuardianTable rows={rows} />);
    expect(screen.getAllByTestId('guardian-row')).toHaveLength(2);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('0.1.0')).toBeInTheDocument();
    expect(screen.getByText('up')).toBeInTheDocument();
    expect(screen.getByText('down')).toBeInTheDocument();
  });
});

describe('formatUptime', () => {
  it('formats seconds as h m s', () => {
    expect(formatUptime(3661)).toBe('1h 1m 1s');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd examples/status-homepage && npx vitest run`
Expected: FAIL — cannot resolve `./statusClient` / `./GuardianTable`.

- [ ] **Step 3: Create `src/statusClient.ts`**

```ts
export interface GuardianTarget {
  name: string;
  url: string;
}

export interface GuardianStatus {
  status: string;
  version: string;
  gitCommit: string;
  network: string;
  startedAt: string;
  uptimeSeconds: number;
}

export interface GuardianRow {
  target: GuardianTarget;
  online: boolean;
  status?: GuardianStatus;
  error?: string;
}

interface ServerStatusResponse {
  status: string;
  version: string;
  git_commit: string;
  network: string;
  started_at: string;
  uptime_seconds: number;
}

export async function fetchStatus(target: GuardianTarget): Promise<GuardianRow> {
  const base = target.url.replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/status`);
    if (!res.ok) {
      return { target, online: false, error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as ServerStatusResponse;
    return {
      target,
      online: true,
      status: {
        status: data.status,
        version: data.version,
        gitCommit: data.git_commit,
        network: data.network,
        startedAt: data.started_at,
        uptimeSeconds: data.uptime_seconds,
      },
    };
  } catch (err) {
    return {
      target,
      online: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function fetchAllStatuses(targets: GuardianTarget[]): Promise<GuardianRow[]> {
  return Promise.all(targets.map(fetchStatus));
}
```

- [ ] **Step 4: Create `src/config.ts`**

```ts
import type { GuardianTarget } from './statusClient';

const DEFAULT_TARGETS: GuardianTarget[] = [{ name: 'Local', url: 'http://127.0.0.1:3000' }];

/**
 * Reads the configured Guardian list from `VITE_GUARDIAN_URLS`, a
 * comma-separated list of `Name=https://url` entries (the `Name=` prefix
 * is optional; the URL is used as the name when omitted). Falls back to a
 * single local Guardian.
 */
export function getGuardianTargets(): GuardianTarget[] {
  const raw = import.meta.env.VITE_GUARDIAN_URLS as string | undefined;
  if (!raw) return DEFAULT_TARGETS;
  const targets = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const eq = entry.indexOf('=');
      if (eq === -1) return { name: entry, url: entry };
      return { name: entry.slice(0, eq).trim(), url: entry.slice(eq + 1).trim() };
    });
  return targets.length > 0 ? targets : DEFAULT_TARGETS;
}
```

- [ ] **Step 5: Create `src/GuardianTable.tsx`**

```tsx
import type { GuardianRow } from './statusClient';

export function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}h ${m}m ${s}s`;
}

export function GuardianTable({ rows }: { rows: GuardianRow[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Guardian</th>
          <th>Status</th>
          <th>Version</th>
          <th>Commit</th>
          <th>Network</th>
          <th>Uptime</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.target.url} data-testid="guardian-row">
            <td>{row.target.name}</td>
            <td>{row.online ? 'up' : 'down'}</td>
            <td>{row.status?.version ?? '—'}</td>
            <td>{row.status?.gitCommit ?? '—'}</td>
            <td>{row.status?.network ?? '—'}</td>
            <td>{row.status ? formatUptime(row.status.uptimeSeconds) : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 6: Replace `src/App.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { getGuardianTargets } from './config';
import { fetchAllStatuses, type GuardianRow } from './statusClient';
import { GuardianTable } from './GuardianTable';

const REFRESH_MS = 15000;

export default function App() {
  const [rows, setRows] = useState<GuardianRow[]>([]);

  useEffect(() => {
    const targets = getGuardianTargets();
    let active = true;
    const load = async () => {
      const next = await fetchAllStatuses(targets);
      if (active) setRows(next);
    };
    void load();
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  return (
    <main>
      <h1>Guardians</h1>
      <GuardianTable rows={rows} />
    </main>
  );
}
```

- [ ] **Step 7: Run tests + typecheck to verify they pass**

Run: `cd examples/status-homepage && npx vitest run && npm run typecheck`
Expected: all tests PASS (4 across two files); typecheck reports no errors.

- [ ] **Step 8: Create `README.md`**

```markdown
# Guardian Status Homepage

A static React page that polls a configured list of Guardians' public
`GET /status` endpoints and shows which are running and with which version.

## Configure the Guardian list

Set `VITE_GUARDIAN_URLS` to a comma-separated list of `Name=URL` entries
(the `Name=` prefix is optional):

```bash
VITE_GUARDIAN_URLS="Prod=https://guardian.example.com,EU=https://eu.guardian.example.com" npm run dev
```

With no value set, it polls a single local Guardian at
`http://127.0.0.1:3000`.

## Develop / build / test

```bash
npm install
npm run dev        # http://localhost:3004
npm run build      # static output in dist/
npm run test       # vitest
```

The page fetches each `<url>/status` client-side on load and every 15s. A
Guardian that fails to respond is shown as **down** rather than breaking
the page. No backend or peer discovery is involved — the list is static
config.
```

- [ ] **Step 9: Commit**

```bash
git add examples/status-homepage/src examples/status-homepage/README.md
git commit -m "feat(examples): status homepage polling and table"
```

---

## Self-Review

**Spec coverage:**
- Public `GET /status` endpoint → Tasks 2–3. ✓
- Fields `version`, `git_commit`, `network`, `started_at`/`uptime_seconds`, constant `status` → Task 2 (`StatusResponse` / `build_status`). ✓
- Unauthenticated, top-level, CORS-covered, no sensitive data → Task 3 (route placement next to `/pubkey`; integration test asserts no inventory fields) + Task 2 (`payload_has_no_sensitive_fields`). ✓
- Reuse existing `started_at` and `build_info` (no new version source) → Tasks 1–2. ✓
- Wallet client `getStatus()` → Task 4. ✓
- Homepage in `examples/status-homepage/`, configured list via `VITE_GUARDIAN_URLS`, client-side polling, table with up/down + version + commit + network + uptime, down-tolerant → Tasks 5–6. ✓
- Testing: Rust service unit test + no-auth router test; TS client test; homepage render test with a down entry → Tasks 2, 3, 4, 6. ✓
- Out of scope (no discovery/registry/backend/history) → respected; nothing in any task adds them. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; the Task 5 `App.tsx` placeholder is explicitly replaced in Task 6 Step 6. ✓

**Type consistency:** `StatusResponse` Rust fields (`status`, `version`, `git_commit`, `network`, `started_at`, `uptime_seconds`) ↔ `ServerStatusResponse` TS (snake_case) ↔ `StatusResponse`/`GuardianStatus` TS (camelCase: `gitCommit`, `startedAt`, `uptimeSeconds`). `build_status(network, started_at, now)` signature matches its caller in Task 3. `create_router`/`handle.rs` both register `/status`. `DashboardState::network()` (Task 1) is consumed in Task 3. `GuardianRow`/`GuardianTarget`/`GuardianStatus` names are consistent across `statusClient.ts`, `GuardianTable.tsx`, `App.tsx`, and both test files. ✓
