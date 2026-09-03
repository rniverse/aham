import { guard } from '@middlewares/auth.middleware';
import { schema$auth } from '@schema/api/auth.schema';
import { service$auth, service$invite } from '@services';
import { metaOf, ok, sanitize } from '@utils';
import Elysia from 'elysia';

export const authAPI = new Elysia({ prefix: '/auth' })
	// soft guard: no token = self-signup, a valid token attributes the invite
	.use(guard.soft)
	.post(
		'/invite',
		async ({ body, user }) => {
			const invite = await service$invite.create({
				email: body.email,
				invitedBy: user?.sub ?? null,
			});
			return ok({ email: invite.email, expiresAt: invite.expires_at });
		},
		{ body: schema$auth.invite.create },
	)
	.post(
		'/signup',
		async ({ body, request, server }) => {
			const data = await service$invite.accept(body, metaOf(server, request));
			return ok(data);
		},
		{ body: schema$auth.signup },
	)
	.post(
		'/signin',
		async ({ body, request, server }) => {
			const data = await service$auth.signin(body, metaOf(server, request));
			return ok(data);
		},
		{ body: schema$auth.signin },
	)
	.post(
		'/password/forgot',
		async ({ body }) => {
			await service$auth.password.forgot(body.email);
			return ok();
		},
		{ body: schema$auth.password.forgot },
	)
	.post(
		'/password/reset',
		async ({ body }) => {
			const user = await service$auth.password.reset(body.token, body.password);
			return ok(sanitize(user));
		},
		{ body: schema$auth.password.reset },
	);
