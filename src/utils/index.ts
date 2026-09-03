import { _ } from '@rniverse/utils';

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

/** Strip sensitive keys before a record leaves the API. */
export function sanitize<T extends object>(
	record: T,
	skip: string[] = ['hash', 'password'],
): Partial<T> {
	return _.omit(record as Record<string, unknown>, skip) as Partial<T>;
}

/** The success half of the response envelope (§10); errors go through onError. */
export function ok(): { ok: true };
export function ok<T>(data: T): { ok: true; data: T };
export function ok<T>(data?: T) {
	return data === undefined ? { ok: true } : { ok: true, data };
}
