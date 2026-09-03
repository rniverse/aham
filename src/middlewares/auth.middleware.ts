import { enum$error } from '@enums/errors.enum';
import { t } from '@rniverse/utils'; // = valibot
import { service$auth } from '@services/auth.service';
import { AppError } from '@services/error.service';
import type { AccessTokenPayload } from '@utils/token.util';
import Elysia from 'elysia';

const bearerOf = (authorization?: string) =>
	authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;

// Documents the bearer requirement in the OpenAPI schema. The guard's own
// derive still throws UNAUTHORIZED first for a missing/blank token, so this
// is a doc + fallback, not the primary 401 path.
const bearerHeader = t.object({ authorization: t.string() });

// No token, or a bad token, both resolve to `user: undefined` — never throws.
// For routes that behave differently when signed in but don't require it.
const soft = new Elysia({ name: 'auth-guard-soft' }).derive(
	{ as: 'scoped' },
	async ({ headers }) => {
		const token = bearerOf(headers?.authorization);
		if (!token) return { user: undefined as AccessTokenPayload | undefined };
		try {
			return {
				user: (await service$auth.verify({ token })) as
					| AccessTokenPayload
					| undefined,
			};
		} catch {
			return { user: undefined as AccessTokenPayload | undefined };
		}
	},
);

// Requires a valid token; non-strict. Mounted once at the protected router root.
const base = new Elysia({ name: 'auth-guard-base' })
	.guard({ as: 'scoped', headers: bearerHeader })
	.derive({ as: 'scoped' }, async ({ headers }) => {
		const token = bearerOf(headers?.authorization);
		if (!token) throw new AppError(enum$error.key.UNAUTHORIZED);
		return { user: await service$auth.verify({ token }) };
	});

// Runs after `base`: reuses the already-verified `user` and only adds the
// blocklist check. Falls back to a full verify if used without `base`.
const strict = new Elysia({ name: 'auth-guard-strict' })
	.guard({ as: 'scoped', headers: bearerHeader })
	.derive(
		{ as: 'scoped' },
		// ctx.user is populated by guard.base upstream; its type isn't threaded here
		async (ctx: any) => {
			const existing: AccessTokenPayload | undefined = ctx.user;
			if (existing) {
				await service$auth.verify({ user: existing, strict: true });
				return { user: existing };
			}
			const token = bearerOf(ctx.headers?.authorization);
			if (!token) throw new AppError(enum$error.key.UNAUTHORIZED);
			return { user: await service$auth.verify({ token, strict: true }) };
		},
	);

export const guard = { soft, base, strict };
