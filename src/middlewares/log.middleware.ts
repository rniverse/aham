import { cxt$req } from '@rniverse/utils/context';
import { log } from '@rniverse/utils/logger';
import Elysia from 'elysia';

export const logger = () =>
	new Elysia({ name: 'logger' })
		.onRequest(({ request, set }) => {
			// The per-request context store already exists — `cxt$req.bindFetch`
			// (src/index.ts) creates it and `trace$.seed` has already adopted a
			// safe inbound x-request-id. Here we just record the start time and
			// echo the id back so a caller can correlate.
			cxt$req.set('startedAt', Date.now());

			const requestId = cxt$req.requestId();
			if (requestId) set.headers['x-request-id'] = requestId;

			const { method, url } = request;
			log.info(`Request started - [${method}] ${url}`);
		})
		.onAfterResponse({ as: 'global' }, ({ request, set }) => {
			const startedAt = cxt$req.get('startedAt') as number | undefined;
			const ms = startedAt ? Date.now() - startedAt : undefined;
			const status = typeof set.status === 'number' ? set.status : 200;
			const { method, url } = request;
			const level = status >= 400 ? 'error' : 'info';
			log[level](
				`Request completed - [${method}] ${url} - [${status}] — ${ms}ms`,
			);
		});
