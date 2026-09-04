# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun install
bun run dev                   # watch mode
bun run start                 # production

bun run lint                  # biome check --write

bun run generate-keys         # print JWT_PRIVATE_KEY / JWT_PUBLIC_KEY to paste into .env

bun run db:main generate      # (re)generate migrations from schema.ts
bun run db:main migrate       # apply pending migrations
bun run dbsync:main           # full resync: drop migrations dir, introspect, generate, migrate

bun run test                  # run all tests (pretest fires automatically)
bun run test:watch
NODE_ENV=test bun test tests/api/auth.test.ts   # single file
```

`pretest` regenerates migrations and resets the `auth_test` database to a clean state — always use `bun run test`, not bare `bun test`.

`.env.test` (git-ignored) must exist alongside `.env` and must set `DATABASE_URL` to the `auth_test` database and `LOG_LEVEL=silent`.

## Architecture

**aham** is a central authentication service. It issues RS256-signed JWTs and publishes a JWKS endpoint (`GET /.well-known/jwks.json`) so any downstream service can verify tokens locally without calling back here.

### Layer structure

```
src/
  index.ts                  — app bootstrap, global onError handler, graceful shutdown
  config.ts                 — the ONLY file that reads process.env; all values via getters
  connections/              — external system lifecycle (init/close/health); pg() accessor
  db/schema.ts              — Drizzle table definitions only; no db() singleton
  enums/                    — errors (key → status code + numeric code), connection status
  middlewares/              — log (x-request-id, timing), auth guard (soft / base / strict)
  api/
    index.ts                — mounts cors, public, and protected routers under /api
    public/*.api.ts         — unauthenticated routes
    protected/*.api.ts      — routes behind guard.base (or guard.strict per route)
  services/                 — business logic; no direct env access, no http response shape
  services/oauth/           — base.service.ts builder + one file per provider
  utils/                    — stateless helpers (token sign/verify/jwks/digest, password hash/verify, duration parse)
  schema/fields.ts          — shared valibot field pipes (email, password, username, name)
  schema/api/*.schema.ts    — valibot request schemas per domain
  scripts/                  — generate-keys.ts, setup-test-db.ts (git-ignored outputs)
```

### Naming conventions

- Exported service objects: `service$domain` (e.g. `service$auth`, `service$session`)
- Exported util objects: `utils$domain` (e.g. `utils$token`, `utils$password`)
- File-private names: `__name` prefix
- `pg()` is the Drizzle query client accessor (not `getDb()`, not `postgres()`)
- Route naming: `domain/entity/verb` — e.g. `auth/invite/revoke`, never `login`/`register`
- camelCase for TS identifiers, snake_case for DB columns and JSON payload keys

### Request/response envelope

Every response is `{ ok: true, data: ... }` or `{ ok: false, error: { code, message } }`. Route handlers call `ok(data)` from `@utils` for success. Errors always go through `AppError(enum$error.key.SOME_KEY)` — never construct the error shape in a route handler. The global `onError` in `src/index.ts` also catches Elysia's own VALIDATION and NOT_FOUND errors and normalizes them into the same envelope.

Error numeric codes are auto-generated sequentially by `sync$seq` at module load — never hardcoded.

### Auth guards

Three Elysia plugins in `middlewares/auth.middleware.ts`:

- `guard.soft` — no token or invalid token both resolve to `user: undefined`; never throws. Used by `auth/invite` (behaves differently when signed in but doesn't require it).
- `guard.base` — requires valid token; non-strict (no blocklist check). Mounted once at the protected router root.
- `guard.strict` — reuses `base`'s already-verified `user` and adds a blocklist check. Applied only to `auth/password/change`.

### Token mechanics

- **Access token:** RS256, 15-min TTL, claims `{ sub, email, fid }`. Never individually revocable — stateless by design.
- **Refresh token:** raw random value (SHA-256 hashed before storage, never stored raw). Rotation on every `session/refresh` call; reuse of an already-rotated token immediately revokes the entire family and adds `blocklist:fid:{family_id}` to the cache for 24 h.
- **`service$auth.verify({ token?, user?, strict? })`:** `strict: true` adds a blocklist check (family + user). Always throws the same `INVALID_TOKEN` error regardless of which check failed.
- JWT keys are provided as base64-encoded PEM via `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` env vars. Use `bun run generate-keys` to generate them.

### OAuth flow

`oauth$base.create(config)` in `services/oauth/base.service.ts` is the composable builder — provider files supply only their URLs, credentials, and a `mapper.profile()` function. CSRF state is cached for 10 min (single-use). Tokens never appear in the callback redirect URL; instead, `callback()` stashes them behind a 60-second single-use code that `POST auth/oauth/exchange` trades for the real tokens.

### Cache / blocklist

`service$cache` is a Postgres-backed key/value store (`cache_entries` table) intended to be swappable for Redis later — only `cache.service.ts` would change. `service$blocklist` is a thin wrapper over `service$cache` that manages key shapes; callers never format keys directly.

### Path aliases

TypeScript path aliases (defined in `tsconfig.json`) map `@config`, `@connections`, `@db/*`, `@enums/*`, `@middlewares/*`, `@services`, `@services/*`, `@utils`, `@utils/*`, `@api`, `@api/*`, `@schema/*`, `@tests/*` to their `src/` counterparts. Bun resolves these natively — no build step.

### Tests

Integration tests in `tests/api/*.test.ts` + `tests/app.test.ts`. Routes are exercised via `app.handle(new Request(...))` — no real socket. `src/index.ts` exports `init()` and guards server startup with `import.meta.main` so tests can import without binding a port. `tests/setup.ts` (preloaded via `bunfig.toml`) opens DB connections once and truncates all tables before each test. `tests/utils.ts` provides `call()`, `signup()`, `oauthFlow()`, token spies, and direct-DB helpers for aging rows.

### Deferred / not yet built

Redis, rate limiting on public endpoints, real email delivery (tokens are currently `log.info`'d), bulk invite, OAuth providers beyond Google, a background worker for cache/invite housekeeping.
