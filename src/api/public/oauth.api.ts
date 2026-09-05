import { config } from '@config';
import { schema$oauth } from '@schema/api/oauth.schema';
import { AppError, service$auth } from '@services';
import { metaOf, ok } from '@utils';
import Elysia from 'elysia';

export const oauthAPI = new Elysia({ prefix: '/oauth' })
	.get(
		'/:provider/start',
		async ({ params, query }) => {
			const { url } = await service$auth.oauth.start(
				params.provider,
				query.redirect,
			);
			return ok({ redirect: url });
		},
		schema$oauth.start,
	)
	.get(
		'/:provider/callback',
		async ({ params, query, request, server, redirect }) => {
			try {
				const result = await service$auth.oauth.callback(
					params.provider,
					query.code,
					query.state,
					metaOf(server, request),
				);
				const base = result.redirect ?? config.url.client;
				const url = new URL(base);
				url.searchParams.set('code', result.code);
				return redirect(url.toString());
			} catch (err) {
				const url = new URL(config.url.client);
				url.searchParams.set(
					'error',
					err instanceof AppError ? err.key : 'INTERNAL_ERROR',
				);
				return redirect(url.toString());
			}
		},
		schema$oauth.callback,
	)
	.post(
		'/exchange',
		async ({ body }) => {
			const data = await service$auth.oauth.exchange(body.code);
			return ok(data);
		},
		schema$oauth.exchange,
	);
