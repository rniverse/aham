import { schema$session } from '@schema/api/session.schema';
import { service$session } from '@services';
import { metaOf, ok } from '@utils';
import Elysia from 'elysia';

export const sessionAPI = new Elysia({ prefix: '/session' })
	.post(
		'/refresh',
		async ({ body, request, server }) => {
			const data = await service$session.refresh(
				body.refreshToken,
				metaOf(server, request),
			);
			return ok(data);
		},
		{ body: schema$session.refresh },
	)
	.post(
		'/revoke',
		async ({ body }) => {
			await service$session.revoke(body.refreshToken);
			return ok();
		},
		{ body: schema$session.revoke },
	);
