# aham

Central authentication service. Issues RS256-signed JWTs and publishes a public
JWKS endpoint, so any other service — regardless of language or stack — can
verify tokens locally without calling back to this service on every request.

## Setup

```bash
bun install
docker compose up -d          # starts Postgres
bun run generate-keys         # prints JWT_PRIVATE_KEY / JWT_PUBLIC_KEY
cp .env.example .env          # then paste in the two keys above, plus your
                               # own Google OAuth credentials if you want that
bun run db:main generate      # generate the initial migration
bun run db:main migrate       # apply it
bun run dev
```

## Endpoints

| Route | Auth | Purpose |
|---|---|---|
| `POST /api/auth/invite` | public¹ | `{ email }` → creates a pending invite, sends the link (currently logged, not emailed — see Known gaps). Returns `{ email, expiresAt }` |
| `POST /api/auth/invite/revoke` | protected | `{ email }` → revokes your own pending invite for that address |
| `POST /api/auth/signup` | public | `{ token, name, username?, password }` → completes an invite, creates the user (email already verified), auto-issues tokens |
| `POST /api/auth/signin` | public | Blocked until email is verified |
| `POST /api/auth/password/forgot` | public | Issues a password-reset token |
| `POST /api/auth/password/reset` | public | Resets password, revokes **all** sessions |
| `POST /api/auth/password/change` | protected | Changes password, leaves other sessions alone; strict token check |
| `GET /api/oauth/:provider/start` | public | Redirects to the OAuth provider |
| `GET /api/oauth/:provider/callback` | public | Handles the provider callback, redirects to `CLIENT_URL?code=...` |
| `POST /api/oauth/exchange` | public | Trades the one-time `code` above for real tokens |
| `GET /api/user/me` | protected | Current user profile |
| `POST /api/user/username/change` | protected | `{ username }` → sets the username once; fails if already set |
| `POST /api/session/refresh` | public | Rotates the refresh token; reusing an already-rotated one revokes the whole session family |
| `POST /api/session/revoke` | public | Logout |
| `GET /.well-known/jwks.json` | public | Root path, not under `/api` — this is a fixed spec path |

Protected routes need `Authorization: Bearer <accessToken>`.

¹ `auth/invite` uses a *soft* guard: no token is fine (self-signup), a valid
token attributes the invite to the caller, a bad token is treated as no token.

## Signup flow

1. `POST /api/auth/invite { email }` — anyone for themselves, or a signed-in
   user inviting someone else. One pending `invites` row, one hashed token,
   one link (`CLIENT_URL?token=…`).
2. The recipient opens the link and `POST /api/auth/signup { token, name,
   username?, password }`. The user row is created here, with the email
   already marked verified (the link was the proof), the invite flipped to
   `accepted`, and an access + refresh pair returned.

`username` may be skipped at step 2 and set later, once, via
`POST /api/user/username/change`. There is no separate email-verification
endpoint — the invite link is it.

## Known gaps / things to do before production

- **Email is not actually sent.** `service$invite.create` and
  `service$auth.password.forgot` currently log the link/token via `log.info`
  instead of emailing it. Wire a real provider (Resend, SES, etc.) in
  `src/services/invite.service.ts` / `src/services/auth.service.ts`.
- **A real bug exists in `@rniverse/utils`** (not this project): `datetime.ts`
  imports `dayjs/plugin/bigintSupport` (lowercase `i`), but dayjs has always
  shipped that file as `bigIntSupport.js` (capital `I`) since it was
  introduced. This breaks on any case-sensitive filesystem (any Linux
  deploy target). It needs to be fixed in the `rniverse/utils` repo directly
  — `node_modules` was patched locally just to make testing possible here.
- **A `typescript` peer-dependency conflict is unresolved**:
  `@rniverse/utils` wants `^5`, `@rniverse/connectors` wants `^6`, and nothing
  pins it, so a fresh install may resolve an incompatible major version.
  Doesn't affect runtime (Bun strips types without invoking `tsc`), but can
  make editor type-checking behave oddly.
- **No rate limiting** on `signin` / `signup` / `invite` — not built yet.
  `auth/invite` is public and unauthenticated, so it's an open row-creation
  (and, once mail is wired, open send) surface until that lands.
- **No bulk invite.** `auth/invite` takes a single email; invite N people
  with N requests. `auth/invite/bulk` is the intended path if one-shot bulk
  is ever needed.
- **No test suite** — `bun:test` + a `.env.test` pipeline was deliberately
  deferred; see `dbsync:main` for the migration pattern to mirror if you add
  one later.
- Only Google is wired as an OAuth provider. Adding another is: copy
  `src/services/oauth/google.service.ts`, supply that provider's URLs/scopes/
  profile mapping to `oauth$base.create(...)`, register it in
  `src/services/oauth/index.ts`.
