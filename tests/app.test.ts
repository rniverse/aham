import { describe, expect, it } from 'bun:test';
import { enum$error } from '@enums/errors.enum';
import { call, getApp, uniqueEmail } from './utils';

describe('error envelope', () => {
	it('unknown route → 404 in the standard envelope', async () => {
		const app = await getApp();
		const { status, body } = await call(app, 'GET', '/api/does/not/exist');
		expect(status).toBe(404);
		expect(body.ok).toBe(false);
		expect(body.error.code).toBe(enum$error.codes.NOT_FOUND);
		expect(typeof body.error.message).toBe('string');
	});

	it('malformed JSON body → 500 INTERNAL_ERROR envelope', async () => {
		const app = await getApp();
		const res = await app.handle(
			new Request('http://localhost/api/auth/invite', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{ not json',
			}),
		);
		const body = (await res.json()) as {
			ok: boolean;
			error: { code: string };
		};
		expect(res.status).toBe(500);
		expect(body.ok).toBe(false);
		expect(body.error.code).toBe(enum$error.codes.INTERNAL_ERROR);
	});

	it('validation failure → 422 VALIDATION_FAILED envelope', async () => {
		const app = await getApp();
		const { status, body } = await call(app, 'POST', '/api/auth/invite', {
			body: {},
		});
		expect(status).toBe(422);
		expect(body.ok).toBe(false);
		expect(body.error.code).toBe(enum$error.codes.VALIDATION_FAILED);
	});

	it('every error body is exactly { ok:false, error:{ code, message } }', async () => {
		const app = await getApp();
		const { body } = await call(app, 'GET', '/api/user/me'); // 401
		expect(Object.keys(body).sort()).toEqual(['error', 'ok']);
		expect(Object.keys(body.error).sort()).toEqual(['code', 'message']);
	});
});

describe('x-request-id', () => {
	it('is present on a success response', async () => {
		const app = await getApp();
		const { res } = await call(app, 'POST', '/api/auth/invite', {
			body: { email: uniqueEmail() },
		});
		expect(res.headers.get('x-request-id')).toBeTruthy();
	});

	it('is present on an error response', async () => {
		const app = await getApp();
		const { res } = await call(app, 'GET', '/api/user/me');
		expect(res.headers.get('x-request-id')).toBeTruthy();
	});

	it('honours a safe inbound x-request-id', async () => {
		const app = await getApp();
		const { res } = await call(app, 'GET', '/api/user/me', {
			headers: { 'x-request-id': 'trace-abc.123' },
		});
		expect(res.headers.get('x-request-id')).toBe('trace-abc.123');
	});

	it('ignores an unsafe inbound x-request-id and generates its own', async () => {
		const app = await getApp();
		const { res } = await call(app, 'GET', '/api/user/me', {
			headers: { 'x-request-id': 'bad id with spaces' },
		});
		const got = res.headers.get('x-request-id');
		expect(got).toBeTruthy();
		expect(got).not.toBe('bad id with spaces');
	});
});
