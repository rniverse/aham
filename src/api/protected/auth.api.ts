import { guard } from '@middlewares/auth.middleware';
import { schema$auth } from '@schema/api/auth.schema';
import { service$auth, service$invite } from '@services';
import { ok, sanitize } from '@utils';
import Elysia from 'elysia';

export const authAPI = new Elysia({ prefix: '/auth' })
	.post(
		'/invite/revoke',
		async ({ body, user }) => {
			await service$invite.revoke({
				email: body.email,
				invitedBy: user.sub,
			});
			return ok();
		},
		{ body: schema$auth.invite.revoke },
	)
	// strict verification applies only to routes registered below this point
	.use(guard.strict)
	.post(
		'/password/change',
		async ({ body, user }) => {
			const _user = await service$auth.password.change(
				user.sub,
				body.current,
				body.next,
			);
			return ok(sanitize(_user));
		},
		{ body: schema$auth.password.change },
	);
