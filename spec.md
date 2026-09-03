# aham — Specification

This document reflects decisions made during design discussion, not a
read-back of the implementation. Where the implementation is known to
diverge from a decision below, it's called out explicitly in
**Discrepancies found**, at the end, rather than silently matched.

## 1. Purpose

A central authentication service that other projects — of any language or
stack — consume purely as an HTTP API. It owns identity: invite-based signup,
signin, password lifecycle, OAuth, and session/token management. It does not
own authorization/permissions for other services.

## 2. Tech stack

- **Runtime:** Bun for local dev. Deploy target was left open, so code
  avoids depending on Bun-only APIs where a reasonable alternative exists
  (e.g. `crypto.getRandomValues` over `Bun.password`, `jose` over a
  Bun-specific JWT lib). OAuth/argon2/jose were chosen partly because they're
  known to work on Cloudflare Workers, based on the person's past experience
  hitting Bun-incompatibility there on a different project.
- **Framework:** Elysia
- **Database:** PostgreSQL, via Drizzle ORM + postgres-js, accessed through
  `@rniverse/connectors`' `SQLConnector` (confirmed: that connector uses
  `drizzle-orm/postgres-js` + the `postgres` npm package under the hood,
  despite its own README suggesting a native `bun:SQL` driver).
- **Shared libs:** `@rniverse/utils` (private) for `log`, `ulid`/`uuid`,
  `sync$seq`, `boundedParseInt`/`safeParseInt`, its `_` re-export (es-toolkit,
  lodash-compatible — used for `_.omit` in `sanitize`), its `date` re-export
  (dayjs with the `duration` plugin extended), its `jose` re-export, and its
  `argon2` re-export (named `password`). `@rniverse/connectors` (private) for
  the Postgres connection lifecycle.
- **Validation:** valibot (standardized on, replacing Elysia's default
  TypeBox) — chosen because Elysia 1.4+ supports Standard Schema, valibot
  implements it, and valibot's `pipe`/transform actions (e.g. `toLowerCase()`)
  are far less verbose than TypeBox's `Decode`/`Encode` pair. Plain ajv was
  considered and rejected: Elysia has no path to use ajv as its validator —
  not natively, and not via Standard Schema, since ajv itself hasn't
  implemented that interface.
- **JWT:** `jose`, used via `@rniverse/utils`'s re-export rather than a
  second direct import, specifically because `@rniverse/utils`'s own
  `jwt$.sign`/`jwt$.verify` helpers are hardcoded to HS256 with a shared
  secret — incompatible with the RS256 + JWKS design below — but the
  underlying `jose` library it re-exports is still usable directly.
- **Lint/format:** Biome, config copied verbatim from the sibling
  `ledger-server` project (tabs, single quotes, 80-col, `preset: "recommended"`,
  `noExplicitAny: off`, `noNonNullAssertion: off`, `organizeImports: on`).

## 3. Core architecture decision: RS256 + JWKS

Access tokens are signed with a private key only this service holds, and
verified anywhere else using the matching public key, published at
`GET /.well-known/jwks.json`. This means any consuming service — in any
language — verifies a token's signature and expiry **locally**, without a
network call back to this service and without sharing a secret. This is the
single decision most other choices in this spec follow from.

`JWT_KEY_ID` (env var) tags the signing key in both the JWT header (`kid`)
and the published JWKS entry. This exists so a future key rotation can
publish the old and new public keys side by side under different `kid`s —
tokens signed under the old key keep verifying until they naturally expire,
while new tokens use the new key. Without this, rotating keys would break
every live token instantly.

Keys are provided via env vars as base64-encoded PEM
(`JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`), not file paths — chosen once it
became clear the deploy target might be a filesystem-less environment like
Cloudflare Workers. Base64 (not escaped-newline PEM) was chosen so the value
survives being pasted into any secrets manager UI without an escaping rule
to get wrong.

## 4. Naming conventions

### Routing
`domain/entity/verb`, fully nested by sub-entity, verb last:
`auth/signin`, `auth/invite`, `auth/invite/revoke`, `auth/signup`
(explicitly **not** `login`/`register`), `auth/password/forgot`,
`auth/password/reset`, `auth/password/change`, `auth/oauth/:provider/start`,
`auth/oauth/:provider/callback`, `auth/oauth/exchange`, `user/me`,
`user/username/change`, `session/refresh`, `session/revoke`.

**Exception:** `/.well-known/jwks.json` stays at that exact literal path,
at the domain root, not under `/api` and not renamed to fit the convention
— it's a fixed spec path (RFC 8615) that other services and OIDC tooling
expect verbatim.

### Methods
Dot-composed, mirroring the route nesting, camelCase-free —
`auth.signin()`, `auth.invite()`, `auth.invite.revoke()`, `auth.signup()`,
`auth.password.forgot()`, `auth.password.reset()`, `auth.password.change()`,
`auth.oauth.start()`, `auth.oauth.callback()`, `auth.oauth.exchange()`,
`user.me()`, `user.username.change()`, `session.refresh()`,
`session.revoke()`.

### Files — layered, not nested by route
Split by architectural layer (api / service / util), not by the route tree:

```
api/public/*.api.ts        — one file per top-level domain (auth, oauth, session)
api/protected/*.api.ts     — same domains, only the routes that need a session
api/index.ts               — consolidator: cors, mounts public + protected
services/*.service.ts      — auth, invite, user, session, cache, blocklist, error
services/oauth/base.service.ts       — composable builder
services/oauth/<provider>.service.ts — config + profile mapping only
utils/*.util.ts             — token, password, duration (stateless, no DB, no AppError)
utils/index.ts               — request/response helpers: ipOf/userAgentOf/metaOf, sanitize (via `_.omit`), ok()
db/schema.ts                 — table defs only; no db/index.ts, no db() accessor
connections/*.connection.ts   — one per external system
connections/index.ts           — lifecycle (init/close/health/status) + pg()
enums/*.enum.ts + index.ts       — errors, connection-status
schema/fields.ts               — shared valibot field pipes (email, password, username, name)
schema/api/*.schema.ts + index.ts — valibot request schemas (auth, session, user)
middlewares/*.middleware.ts        — log, auth guard (soft / base / strict)
scripts/generate-keys.ts             — committed source; prints keys, writes nothing
```

`pg()` (not `postgres()`) was the deliberate choice for the query-instance
accessor — matches the informal shorthand already used for the tool
(`pg` package, `psql`), not just brevity for its own sake. `redis()` would
follow the same pattern when added later.

### Export namespacing
`service$domain` and `utils$domain` — the `$` marks "this is the domain's
public surface," extended from the `@rniverse/utils` convention
(`cxt$req`, `sync$seq`) to our own services *and* to local utils, one step
further than the `ledger-server` reference project, which only used `$` on
services (its own `slug.util.ts` exported a bare `slug`, no `$`).
`__`-prefixed names denote a private implementation detail inside a file,
not part of its exported surface (carried over from `ledger-server`'s
`__list` convention, for use if/when a file needs one).

### Variable naming
- Abbreviations are fine regardless of length: `doc`, `req`, `config`,
  `cfg`, `id`.
- A single word is the default and preferred form: `session`, `user`,
  `hash`, `payload`, `refreshToken`.
- A short qualifying suffix reading as a type-tag is fine: `reqId`,
  `userId`.
- A 3-part modifier+domain+shape compound is fine when it's precise:
  `cachedUserRecord`.
- Vague 2-word noun-noun blends are the actual thing to avoid — not word
  count: `cachedDoc` (cached *as what shape*?) and `sessionUser`
  (ambiguous head noun) both fail; `cachedUserRecord` and `session` both
  pass.
- Default to the plain noun; only qualify when the qualifier does real
  disambiguating work in that scope. Concretely decided:
  `hash` (not `hashedPassword`), `user` (not `userRecord`), `payload` (not
  `tokenPayload`), `refreshToken` (not `refreshTokenRecord`), `user` (not
  `existingUser`).
- `_x` prefix means "the next/updated version of a value already named `x`
  in this scope" (e.g. `_user` after `service$user.update(...)`) — it is
  **not** a general-purpose descriptive prefix, so two genuinely distinct
  inputs to the same function get two distinct real names instead
  (`currentPassword` / `nextPassword`, not `password` / `_password`).
- camelCase for locals, preferring short or single-word names; snake_case
  is reserved for Postgres columns and JSON payload keys, never TS
  identifiers.
- No compressed one-liner `.filter()/.reduce()` chains; multi-step logic
  gets named intermediate variables even at the cost of extra lines —
  readability over compression.
- `URL` vs `URI` casing is **not** a single blanket rule: use `URI`
  (`redirectURI`) when naming the literal OAuth-spec term, use `URL`
  (`authServiceURL`, `clientURL`) for the service's own general-purpose
  address fields. In snake_case (DB/JSON), both go fully lowercase
  (`avatar_url`; `redirect_uri` if the OAuth term were ever persisted).
  This is deliberately asymmetric with `Id`, which stays lowercase-`d`
  (`userId`, `reqId`) rather than becoming `ID` — there is no single
  "acronyms are always capitalized" rule in play here.

## 5. Database schema

| Table | Columns | Notes |
|---|---|---|
| `users` | `id` (ULID, PK), `email` (unique, not null), `username` (unique, **nullable**), `name` (nullable), `hash` (nullable — null for OAuth-only accounts), `email_verified_at` (nullable), `created_at`, `updated_at` | Username uniqueness is case-sensitive at the DB layer; case-insensitivity is enforced by lowercasing at the API boundary (valibot transform), not a DB-level expression index — deliberately kept out of the database. `name` is a display name, set at signup-completion or from an OAuth profile; nullable because an OAuth provider may withhold it. |
| `oauth_accounts` | `id` (PK), `user_id` (FK → users, cascade), `provider`, `provider_account_id`, `created_at` | Unique constraint on `(provider, provider_account_id)`. |
| `refresh_tokens` | `id` (PK), `user_id` (FK, cascade), `token_hash` (unique — raw token never stored), `family_id`, `replaced_by` (nullable, self-referential), `user_agent` (nullable), `ip` (nullable), `revoked_at` (nullable), `expires_at`, `created_at` | `user_agent`/`ip` captured on every issuance (signin *and* every rotation), for future fraud-detection use. |
| `verification_tokens` | `id` (PK), `user_id` (FK, cascade), `token_hash` (unique), `type` (`'password_reset'`), `expires_at`, `used_at` (nullable), `created_at` | Single-use: `used_at` set on consumption. The `type` column is kept as a discriminator for future kinds, but email verification moved to `invites` (§7), so `'password_reset'` is the only value written today. |
| `invites` | `id` (ULID, PK), `email` (not null), `token_hash` (unique — raw token never stored), `invited_by` (FK → users, **on delete set null**; null for self-signup), `user_id` (FK → users, **on delete set null**; set to the created user on acceptance), `status` (`'pending' \| 'accepted' \| 'expired' \| 'revoked'`), `expires_at`, `accepted_at` (nullable), `created_at` | Backs invite-based signup (§7). Expiry is enforced lazily on read; a stale `pending` row is flipped to `expired` when a fresh invite is issued for the same email. |
| `cache_entries` | `key` (PK), `value`, `expires_at`, `created_at` | Generic key-value store backing `service$cache`; Postgres-backed for v1, swappable for Redis later without changing callers. |

IDs are ULIDs (`ulid.generate()` from `@rniverse/utils`), not UUIDs, for the
same reason as the `ledger-server` reference project: they sort
chronologically.

## 6. Token & session mechanics

- **Access token:** RS256, 15-minute default TTL (`ACCESS_TOKEN_TTL`),
  claims `sub` (user id), `email`, `fid` (refresh-token family id). Never
  individually revocable — deliberately stateless, since a per-token
  revocation list would defeat the purpose of using JWTs at all (it would
  make every verification stateful again). A stolen access token's maximum
  lifetime is capped at 15 minutes by expiry alone.
- **Refresh token:** a random, cryptographically secure value
  (`crypto.getRandomValues`, not `Math.random` — `@rniverse/utils`'s own
  `random.ts` was explicitly rejected for this because it's `Math.random`-based
  and unsuitable for anything security-sensitive). Stored **hashed**
  (SHA-256, not argon2 — argon2's deliberate slowness is wrong for a
  high-frequency lookup key; the token already carries enough entropy that
  a fast hash is appropriate). Default TTL 30 days
  (`REFRESH_TOKEN_TTL_DAYS`, parsed via `boundedParseInt` with a 1–90 day
  clamp).
- **Family (`family_id`):** assigned once per token issuance (signin,
  signup-completion), shared by every refresh-rotation descended from that
  login. Represents one continuous session lineage (effectively "one
  device's login").
- **Rotation:** every `session.refresh()` call issues a brand-new
  access+refresh pair under the *same* `family_id`, and marks the
  presented refresh token `revoked_at` + `replaced_by → <new row id>`.
- **Client shape:** `session.issue()` returns `{ id, tokens }` — `id` is the
  refresh-token row PK, used only internally for the `replaced_by` chain.
  Every token-issuing endpoint (`signin`, `signup`, `session/refresh`,
  `oauth/exchange`) returns just `tokens` = `{ accessToken, refreshToken }`;
  the row id is never exposed.
- **Reuse detection:** if a refresh token is presented that's already
  `revoked_at`, that's treated as reuse of an already-rotated token —
  either a client bug or a stolen copy racing the legitimate one. The
  **entire family** is revoked immediately (not "log once, revoke on
  second occurrence" — the immediate option was the explicit choice), and
  `blocklist:fid:{family_id}` is set for 24 hours (chosen as a buffer
  comfortably longer than any already-issued access token's 15-minute
  life).
- **Blocklist / kill-switch:** `service$blocklist` is split by subject —
  `family.add`/`family.check` (kill / test one session lineage) and
  `user.add`/`user.check` (every session for a user; `user.add` is the
  kill-switch primitive, no route wired yet). The `blocklist:` / `fid:` /
  `user:` key shapes stay inside that service; callers never format keys.
  Built on `service$cache` (Postgres-backed today, Redis planned later — the
  swap only touches `cache.service.ts`, nothing above it).
- **`verify({ token?, user?, strict? })`:**
  - Default (`strict` omitted/false): signature + expiry + issuer check
    only. This is what ordinary protected routes use.
  - `strict: true`: additionally checks the blocklist (`fid:` and
    `user:` keys). Reserved for sensitive flows.
  - `user` (a pre-verified payload) may be passed instead of `token`: the
    signature/expiry decode is then skipped and only the strict checks run.
    This lets `guard.strict` reuse the payload `guard.base` already
    verified, rather than decoding the same JWT twice.
  - Always throws `AppError('INVALID_TOKEN')` on any failure — deliberately
    the *same* error regardless of which specific case triggered it
    (expired signature, revoked-token reuse, blocklist hit), so a client
    (or attacker) can't distinguish "your token expired" from "we detected
    fraud and killed your session" from the response alone.
- **Auth guard (`middlewares/auth.middleware.ts`)** exposes three variants,
  each a named Elysia plugin:
  - `guard.soft` — no `Authorization` header, or an invalid token, both
    resolve to `user: undefined` (never throws). For routes that behave
    differently when signed in but don't require it (`auth/invite`).
  - `guard.base` — requires a valid token (`UNAUTHORIZED` if absent,
    `INVALID_TOKEN` if bad); non-strict. Mounted once at the protected
    router root.
  - `guard.strict` — runs after `base`, adds the blocklist check by
    passing the already-verified `user` to `verify({ user, strict: true })`.
    Applied to `auth/password/change` specifically.

## 7. Signup, invite & password lifecycle

### Invite-based signup

There is no password-at-signup. An account is born only when someone
accepts an invite, and accepting the invite link *is* the proof of inbox
control — there is no separate email-verification step or endpoint.

- **`auth/invite` `{ email }`** creates one `invites` row (`status:
  'pending'`), stores only the hash of a random token, and logs/sends the
  link (`CLIENT_URL?token=…`). It returns `{ email, expiresAt }`. It never
  issues session tokens and never creates a user.
  - The route uses `guard.soft`: called with a valid session it sets
    `invited_by` to the caller; called anonymously it's self-signup and
    `invited_by` is null.
  - **Single email per request** — no array/bulk form. A caller inviting
    several people sends several requests; a dedicated `auth/invite/bulk`
    is the intended path if one-shot bulk is ever needed (deferred, §13).
  - If a **user** already exists for that email → `EMAIL_ALREADY_EXISTS`
    (409).
  - If a **non-expired `pending` invite** already exists for that email →
    `INVITE_ALREADY_PENDING` (409). If the prior invite is expired, a
    fresh row is issued and the old one is flipped to `expired` (its
    expiry is never bumped in place).
- **`auth/invite/revoke` `{ email }`** — protected (`guard.base`),
  owner-only. Flips a row to `status: 'revoked'` where `email` matches,
  `invited_by` is the caller, and `status` is `pending`. Anything else
  (no such row, not the owner, already accepted/expired/revoked) →
  `NOT_FOUND` (404), so ownership isn't disclosed.
- **`auth/signup` `{ token, name, username?, password }`** consumes a
  `pending`, non-expired invite (else `INVITE_TOKEN_INVALID`, 401):
  - `name` is **required**; `username` is **optional** (settable later,
    once, via `user/username/change`); `password` is required.
  - Creates the user with `email` taken from the invite and
    `email_verified_at` set to now (the link proved inbox control).
  - Marks the invite `status: 'accepted'`, sets `accepted_at` and
    `user_id`.
  - **Auto-issues an access + refresh pair** — the person shouldn't have
    to sign in again immediately after completing signup.
- **Invite TTL:** `INVITE_TOKEN_TTL` (env, compact-duration string,
  default `1d`) — see §12.

### Signin & passwords

- **Signin is blocked until email is verified** — throws
  `EMAIL_NOT_VERIFIED` (403, not 401: the credentials were correct, the
  *account* isn't usable yet). In practice the only way to hold an
  unverified account is an OAuth sign-in whose provider did not confirm
  the email.
- **Password reset revokes every session** (`revokeAllForUser`) —
  security-sensitive: an attacker with a live stolen session shouldn't
  survive the legitimate user "securing" the account.
- **Password change revokes nothing** — deliberately asymmetric with
  reset; changing a password you already know shouldn't log out your other
  own devices. The route additionally uses `guard.strict` (§6).
- An OAuth-only user (no `hash`) can use `password.forgot`/`reset` to set
  their *first* password — no separate "add a password" feature needed,
  since reset already proves email ownership via token regardless of
  whether a hash previously existed.

### Username

- `username` is set at most once. It may be omitted at `auth/signup` and
  supplied later through **`user/username/change` `{ username }`**
  (protected). That route only writes when the current value is null;
  once set, it throws `USERNAME_ALREADY_SET` (409). There is no rename
  path.

## 8. OAuth

- **Composable, not class-based:** a `base.service.ts` builder
  (`oauth$base.create(config)`) supplies `start`/`exchange`/`profile`/
  `callback` from a plain config object; a provider file supplies only its
  URLs, client id/secret, scope, and a `mapper.profile()` function.
  Composition was chosen explicitly over class inheritance because nothing
  else in the codebase uses classes.
- **Config shape:** `{ url: { authorize, token, userinfo, redirect },
  client: { id, secret }, scope, mapper: { profile } }` — nested `url`/
  `client` objects, `mapper.profile()` rather than a bare `mapProfile`
  function, per explicit request.
- **CSRF protection:** `start()` generates a `state` value; it's cached
  (`oauth:state:{state}` → provider name, 10-minute TTL) before redirecting.
  `callback()` looks the state up, rejects with `OAUTH_STATE_MISMATCH` if
  missing or mismatched, and deletes it immediately (single-use).
- **Account linking:** if an OAuth callback's email matches an existing
  user, the OAuth account is auto-linked to it — **only if the provider
  confirms the email is verified** (`profile.emailVerified`); otherwise
  `OAUTH_EMAIL_UNVERIFIED`. Without this check, a provider with looser
  email verification could be used to claim someone else's existing
  account.
- **Profile fields:** `mapper.profile()` also yields a display `name`,
  stored on `users.name` when the OAuth path creates the user.
- **Pending invites:** when an OAuth callback creates a *new* user, any
  `pending` invite for that email is flipped to `expired` — the account
  now exists, so the outstanding link is dead.
- **Tokens never appear in the callback redirect URL.** A raw access/
  refresh pair in a URL would leak into browser history, server logs, and
  `Referer` headers. Instead, `callback()` stashes the issued tokens behind
  a short-lived (60s), single-use random code
  (`oauth:exchange:{code}`) and redirects with only that code; a separate
  `POST auth/oauth/exchange` trades the code for the real tokens. This
  addition wasn't explicitly requested — it was made unilaterally as a
  security correction while implementing the callback route, and is called
  out here for visibility.

## 9. API surface

| Route | Auth | Notes |
|---|---|---|
| `POST auth/invite` | public (soft) | `{ email }`; creates a pending invite, sends link. `invited_by` = caller when signed in. 409 if a user or a valid pending invite already exists. Returns `{ email, expiresAt }` |
| `POST auth/invite/revoke` | protected | `{ email }`; owner-only, revokes the caller's pending invite. 404 otherwise |
| `POST auth/signup` | public | `{ token, name, username?, password }`; consumes the invite, creates the user (email verified), auto-issues tokens |
| `POST auth/signin` | public | 403 if unverified |
| `POST auth/password/forgot` | public | Silently no-ops on unknown email |
| `POST auth/password/reset` | public | Revokes all sessions |
| `POST auth/password/change` | protected (strict) | Leaves sessions alone |
| `GET auth/oauth/:provider/start` | public | Redirects to provider |
| `GET auth/oauth/:provider/callback` | public | Redirects to `CLIENT_URL?code=...` (or `?error=...`) |
| `POST auth/oauth/exchange` | public | One-time code → real tokens |
| `GET user/me` | protected | Full profile minus `hash` |
| `POST user/username/change` | protected | `{ username }`; set-once, 409 if already set |
| `POST session/refresh` | public | Refresh token in **request body**, not a cookie — chosen so non-browser consumers (mobile apps, other backend services) can use it too; this was a default made without explicit confirmation and flagged as such at the time |
| `POST session/revoke` | public | Refresh token in request body |
| `GET /.well-known/jwks.json` | public | Root path — see §4 exception |

## 10. Error handling & response envelope

Every endpoint returns one of:
```
{ ok: true, data: ... }
{ ok: false, error: { code, message } }
```
produced centrally — route handlers never construct the error shape
themselves. `AppError` wraps a key from a single central registry
(`enums/errors.enum.ts`) into `{ key, code, status_code, message }`; a
global `onError` handler converts it to the envelope above. This must also
catch Elysia's *own* internal errors (validation failures, 404s) and
normalize those into the same envelope — an error path that leaks Elysia's
raw internal error shape instead is a spec violation, not an acceptable
edge case.

Error registry (key → status):
`NOT_FOUND`(404), `VALIDATION_FAILED`(422), `INTERNAL_ERROR`(500),
`UNAUTHORIZED`(401), `INVALID_TOKEN`(401), `INVALID_CREDENTIALS`(401),
`EMAIL_NOT_VERIFIED`(403), `EMAIL_ALREADY_EXISTS`(409),
`USERNAME_ALREADY_EXISTS`(409), `USERNAME_ALREADY_SET`(409),
`VERIFICATION_TOKEN_INVALID`(401), `INVITE_TOKEN_INVALID`(401),
`INVITE_ALREADY_PENDING`(409), `OAUTH_STATE_MISMATCH`(401),
`OAUTH_TOKEN_EXCHANGE_FAILED`(502), `OAUTH_PROFILE_FETCH_FAILED`(502),
`OAUTH_EMAIL_UNVERIFIED`(403), `OAUTH_PROVIDER_UNKNOWN`(404).

## 11. CORS

`CORS_ORIGINS` env var: comma-separated allowlist, or the literal `*` to
allow any origin. `*` is the shipped default — an explicit, temporary
escape hatch ("later we can change it") rather than a permanent policy
decision.

## 12. Config

A single frozen `config` object (`src/config.ts`) is the *only* file
permitted to read `process.env`. Every value is exposed through a getter,
not a plain property, matching the `ledger-server` reference project's
rationale (avoids capturing a stale value before `.env` loads; lets tests
override `process.env` after import).

**Durations:** token lifetimes that aren't a plain day-count are given as a
compact string — `<integer><unit>`, unit one of `s m h d w y` (no months,
no long-form words), e.g. `10s`, `1d`, `1w`, `10y`. `1y` is exactly `365d`.
`utils/duration.util.ts` parses it to seconds; `config.invite.ttl` returns
that number. `ACCESS_TOKEN_TTL` keeps its own raw string (parsed by `jose`),
`REFRESH_TOKEN_TTL_DAYS` stays a bare integer.

**Invite:** `INVITE_TOKEN_TTL` (default `1d`) → `config.invite.ttl`
(seconds).

## 13. Deliberately deferred (not built, not in scope for this version)

- Redis (blocklist/cache is Postgres-only for now, by design, swappable
  later)
- A `worker.ts` background process (e.g. for sweeping expired
  `cache_entries` rows)
- Rate limiting on `signin`/`signup`/`invite` — note `auth/invite` is a
  public, unauthenticated endpoint that provisions rows and (eventually)
  sends mail
- Bulk invite — `auth/invite` takes one email; a dedicated
  `auth/invite/bulk` with a partial-success response is the intended path
  if one-shot bulk is ever needed
- Any OAuth provider beyond Google (the composition pattern in §8 is the
  intended path for adding more)
- Real email delivery — invite / password-reset tokens are logged via
  `log.info`, not emailed, pending a provider decision
- A sweep of expired `invites` rows (expiry is already enforced lazily on
  read; this would only be housekeeping, and belongs in the deferred
  `worker.ts`)

## 14. Tests

Integration tests under `tests/` — one file per api file in `tests/api/*.test.ts`
plus `tests/app.test.ts` for cross-cutting concerns (error envelope,
`x-request-id`). Run with `bun run test` (not bare `bun test` — the `pretest`
script must fire).

- `pretest` runs `src/scripts/setup-test-db.ts`: creates the `auth_test`
  database if missing and applies `src/db/migrations` to it via drizzle's
  programmatic migrator.
- `.env.test` (git-ignored, loaded on top of `.env` because the `test` script
  sets `NODE_ENV=test`) redirects only `DATABASE_URL` to `auth_test` and sets
  `LOG_LEVEL=silent`.
- `tests/setup.ts` (preloaded via `bunfig.toml`) opens connections once and
  `TRUNCATE`s every table before each test.
- Routes are exercised through `app.handle(new Request(...))` — no real socket.
  `src/index.ts` exports `init()` and guards its server bootstrap with
  `import.meta.main` so importing it in a test doesn't start listening.
- `tests/utils.ts` provides the shared harness: `call()`, `signup()` (full
  invite→signup flow), `oauthFlow()` (stubbed start→callback), fetch stubs for
  the provider, `utils$token.random` spies to recover logged invite/reset
  tokens, and direct-DB helpers to age a row (`expireInvite`,
  `expireRefreshToken`, …) or mint an already-expired access token for cases
  that can't be produced through the API.
- Coverage is happy-path + error/edge branches per route: validation bounds,
  `INVALID_TOKEN` vs `UNAUTHORIZED`, expired tokens, invite re-issue after
  expiry/revoke, OAuth account-linking + provider-fetch failures, blocklist
  hits, deleted-user, and the envelope/`x-request-id` invariants. Not covered:
  `EMAIL_NOT_VERIFIED` on signin (unreachable — only OAuth can leave an
  account unverified, and that path errors before signin is possible).

## 15. Known issues carried from dependencies (not this codebase)

- `@rniverse/utils`'s `lib/utils/datetime.ts` imports
  `dayjs/plugin/bigintSupport` (lowercase `i`); dayjs has always shipped
  that file as `bigIntSupport.js` (capital `I`). Breaks on any
  case-sensitive filesystem. Needs a fix pushed to that repo.
- `typescript` peer-dependency conflict: `@rniverse/utils` wants `^5`,
  `@rniverse/connectors` wants `^6`; nothing currently pins a resolution.
  Runtime-harmless (Bun doesn't invoke `tsc`), but can affect editor
  type-checking.

---

## Discrepancies found while writing this document

- **§6, `verify` strict mode** — *resolved in the invite-flow revision.*
  `password/change` now runs under `guard.strict`, which passes the
  already-verified `user` to `verify({ user, strict: true })`. The guard
  split (`soft` / `base` / `strict`) is the mechanism that lets that one
  route opt in without a strict check leaking onto every protected route.