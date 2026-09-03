import { config } from '@config';
import { AppError, service$auth } from '@services';
import { metaOf, ok } from '@utils';
import Elysia, { t } from 'elysia';

export const oauthAPI = new Elysia({ prefix: '/oauth' })
	.get(
		'/:provider/start',
		async ({ params, redirect }) => {
			const { url } = await service$auth.oauth.start(params.provider);
			return redirect(url);
		},
		{ params: t.Object({ provider: t.String() }) },
	)
	.get(
		'/:provider/callback',
		async ({ params, query, request, server, redirect }) => {
			try {
				const { code } = await service$auth.oauth.callback(
					params.provider,
					query.code,
					query.state,
					metaOf(server, request),
				);
				const url = new URL(config.clientURL);
				url.searchParams.set('code', code);
				return redirect(url.toString());
			} catch (err) {
				const url = new URL(config.clientURL);
				url.searchParams.set(
					'error',
					err instanceof AppError ? err.key : 'INTERNAL_ERROR',
				);
				return redirect(url.toString());
			}
		},
		{
			params: t.Object({ provider: t.String() }),
			query: t.Object({ code: t.String(), state: t.String() }),
		},
	)
	.post(
		'/exchange',
		async ({ body }) => {
			const data = await service$auth.oauth.exchange(body.code);
			return ok(data);
		},
		{ body: t.Object({ code: t.String() }) },
	);
