import { AppError, enum$error } from '@enums/errors.enum';
import { cxt$req } from '@rniverse/utils/context';
import { schema$guard } from '@schema/guard.schema';
import { service$auth } from '@services/auth.service';
import type { AccessTokenPayload } from '@utils/token.util';
import Elysia from 'elysia';

// Put the verified user id on the request context so it rides along on logs and
// on outbound service calls (x-user-id). Only ever set here, post-verification.
const bindUser = <T extends { sub?: string } | undefined | null>(
	user: T,
): T => {
	if (user?.sub) cxt$req.set('userId', user.sub);
	return user;
};

// No token, or a bad token, both resolve to `user: undefined` — never throws.
// For routes that behave differently when signed in but don't require it.
const soft = new Elysia({ name: 'auth-guard-soft' })
	.guard({ as: 'scoped', headers: schema$guard.soft })
	.resolve({ as: 'scoped' }, async ({ headers }) => {
		const token = headers.authorization;
		if (!token) return { user: undefined as AccessTokenPayload | undefined };
		try {
			return {
				user: bindUser(
					(await service$auth.verify({ token })) as
						| AccessTokenPayload
						| undefined,
				),
			};
		} catch {
			return { user: undefined as AccessTokenPayload | undefined };
		}
	});

// Requires a valid token; non-strict. Mounted once at the protected router root.
// schema$guard.bearer validates presence + Bearer scheme and strips the prefix —
// headers.authorization in the resolve is already the raw token.
const base = new Elysia({ name: 'auth-guard-base' })
	.guard({ as: 'scoped', headers: schema$guard.bearer })
	.resolve({ as: 'scoped' }, async ({ headers }) => {
		const token = headers.authorization;
		if (!token) throw new AppError(enum$error.key.UNAUTHORIZED);
		return { user: bindUser(await service$auth.verify({ token })) };
	});

// Runs after `base`: reuses the already-verified `user` and only adds the
// blocklist check. Falls back to a full verify if used without `base`.
const strict = new Elysia({ name: 'auth-guard-strict' })
	.guard({ as: 'scoped', headers: schema$guard.bearer })
	.resolve(
		{ as: 'scoped' },
		// ctx.user is populated by guard.base upstream; its type isn't threaded here
		async (ctx: any) => {
			const existing: AccessTokenPayload | undefined = ctx.user;
			if (existing) {
				await service$auth.verify({ user: existing, strict: true });
				return { user: bindUser(existing) };
			}
			const token = ctx.headers?.authorization;
			if (!token) throw new AppError(enum$error.key.UNAUTHORIZED);
			return {
				user: bindUser(await service$auth.verify({ token, strict: true })),
			};
		},
	);

export const guard = { soft, base, strict };
