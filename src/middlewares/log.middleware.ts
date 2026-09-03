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
			const inbound = request.headers.get('x-request-id');
			const custom =
				inbound && SAFE_REQUEST_ID.test(inbound)
					? { requestId: inbound }
					: undefined;
			const { requestId } = cxt$req.withRequestId(custom)();
			// echo it back so a caller can correlate a response with server logs
			set.headers['x-request-id'] = requestId;
			log.info(
				{ method: request.method, url: request.url },
				'Incoming request',
			);
		})
		.onAfterResponse({ as: 'global' }, ({ request, set }) => {
			log.info(
				{ method: request.method, url: request.url, status: set.status },
				'Request completed',
			);
		});
