import { cxt$req, log } from '@rniverse/utils';
import Elysia from 'elysia';

// Trust a caller-supplied id only if it's a plain, bounded token — otherwise a
// client could inject newlines into the logs or the response header.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

export const logger = () =>
	new Elysia({ name: 'logger' })
		.onRequest(({ request, set }) => {
			// Honour an inbound x-request-id for trace propagation; generate one
			// otherwise. Either way, enter a fresh per-request context first so
			// this log — and every log for the rest of the request, onError
			// included — carries the right id, not the server's SERVER_LOG.
			// `startedAt` rides along so onAfterResponse can report elapsed time.
			const inbound = request.headers.get('x-request-id');
			const custom: Record<string, unknown> = { startedAt: Date.now() };
			if (inbound && SAFE_REQUEST_ID.test(inbound)) custom.requestId = inbound;
			const { requestId } = cxt$req.withRequestId(custom)();
			// echo it back so a caller can correlate a response with server logs
			set.headers['x-request-id'] = requestId;
			const { method, url } = request;

			log.info(`Request started - [${method}] ${url}`);
		})
		.onAfterResponse({ as: 'global' }, ({ request, set }) => {
			const startedAt = cxt$req.getContextValue('startedAt') as number | null;
			const ms = startedAt ? Date.now() - startedAt : undefined;
			const status = typeof set.status === 'number' ? set.status : 200;
			const { method, url } = request;
			const level = status >= 400 ? 'error' : 'info';
			log[level](
				`Request completed - [${method}] ${url} - [${status}] — ${ms}ms`,
			);
		});
