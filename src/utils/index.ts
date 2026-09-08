export { mask, ok, sanitize } from '@rniverse/utils';

export function ipOf(server: any, request: Request) {
	return server?.requestIP(request)?.address;
}

export function userAgentOf(request: Request) {
	return request.headers.get('user-agent') ?? undefined;
}

export type RequestMeta = { ip?: string; userAgent?: string };

/** The `{ ip, userAgent }` pair every token-issuing route captures. */
export function metaOf(server: any, request: Request): RequestMeta {
	return { ip: ipOf(server, request), userAgent: userAgentOf(request) };
}
