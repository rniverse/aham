import { describe, expect, it } from 'bun:test';
import { enum$error } from '@enums/errors.enum';
import { call, deleteUser, expiredAccessToken, getApp, signup } from '../utils';

describe('GET /api/user/me', () => {
	it('returns the profile without the hash', async () => {
		const app = await getApp();
		const s = await signup(app, { name: 'Grace Hopper' });

		const { status, body } = await call(app, 'GET', '/api/user/me', {
			token: s.accessToken,
		});
		expect(status).toBe(200);
		expect(body.data.email).toBe(s.email);
		expect(body.data.name).toBe('Grace Hopper');
		expect(body.data.hash).toBeUndefined();
	});

	it('401 without a token', async () => {
		const app = await getApp();
		const { status } = await call(app, 'GET', '/api/user/me');
		expect(status).toBe(401);
	});

	it('401 with a bare token (missing the Bearer scheme)', async () => {
		const app = await getApp();
		const s = await signup(app);
		const { status } = await call(app, 'GET', '/api/user/me', {
			headers: { authorization: s.accessToken },
		});
		expect(status).toBe(401);
	});

	it('INVALID_TOKEN for a garbage bearer token', async () => {
		const app = await getApp();
		const { status, body } = await call(app, 'GET', '/api/user/me', {
			token: 'garbage',
		});
		expect(status).toBe(401);
		expect(body.error.code).toBe(enum$error.codes.INVALID_TOKEN);
	});

	it('INVALID_TOKEN for an expired access token', async () => {
		const app = await getApp();
		const s = await signup(app);
		const stale = await expiredAccessToken({
			sub: s.id,
			email: s.email,
			fid: 'x',
		});
		const { status, body } = await call(app, 'GET', '/api/user/me', {
			token: stale,
		});
		expect(status).toBe(401);
		expect(body.error.code).toBe(enum$error.codes.INVALID_TOKEN);
	});

	it('NOT_FOUND when the user row no longer exists', async () => {
		const app = await getApp();
		const s = await signup(app);
		await deleteUser(s.id);

		const { status, body } = await call(app, 'GET', '/api/user/me', {
			token: s.accessToken,
		});
		expect(status).toBe(404);
		expect(body.error.code).toBe(enum$error.codes.NOT_FOUND);
	});
});

describe('POST /api/user/change/username', () => {
	it('sets the username when it is currently null', async () => {
		const app = await getApp();
		const s = await signup(app);

		const { status, body } = await call(
			app,
			'POST',
			'/api/user/change/username',
			{ token: s.accessToken, body: { username: 'grace' } },
		);
		expect(status).toBe(200);
		expect(body.data.username).toBe('grace');
		expect(body.data.hash).toBeUndefined();
	});

	it('lowercases the username', async () => {
		const app = await getApp();
		const s = await signup(app);
		const { body } = await call(app, 'POST', '/api/user/change/username', {
			token: s.accessToken,
			body: { username: 'MixedCase' },
		});
		expect(body.data.username).toBe('mixedcase');
	});

	it('409 when the username is already set', async () => {
		const app = await getApp();
		const s = await signup(app, { username: 'alreadyset' });

		const { status, body } = await call(
			app,
			'POST',
			'/api/user/change/username',
			{ token: s.accessToken, body: { username: 'another' } },
		);
		expect(status).toBe(409);
		expect(body.error.code).toBe(enum$error.codes.USERNAME_ALREADY_SET);
	});

	it('409 when the username is taken by someone else', async () => {
		const app = await getApp();
		await signup(app, { username: 'taken' });
		const s = await signup(app);

		const { status, body } = await call(
			app,
			'POST',
			'/api/user/change/username',
			{ token: s.accessToken, body: { username: 'taken' } },
		);
		expect(status).toBe(409);
		expect(body.error.code).toBe(enum$error.codes.USERNAME_ALREADY_EXISTS);
	});

	it('401 without a token', async () => {
		const app = await getApp();
		const { status } = await call(app, 'POST', '/api/user/change/username', {
			body: { username: 'whoever' },
		});
		expect(status).toBe(401);
	});

	it('INVALID_TOKEN for a garbage bearer token', async () => {
		const app = await getApp();
		const { status, body } = await call(
			app,
			'POST',
			'/api/user/change/username',
			{ token: 'garbage', body: { username: 'whoever' } },
		);
		expect(status).toBe(401);
		expect(body.error.code).toBe(enum$error.codes.INVALID_TOKEN);
	});

	for (const bad of ['ab', 'a b', 'has_symbol!', 'x'.repeat(33), '.lead']) {
		it(`422 for an invalid username: ${JSON.stringify(bad)}`, async () => {
			const app = await getApp();
			const s = await signup(app);
			const { status } = await call(app, 'POST', '/api/user/change/username', {
				token: s.accessToken,
				body: { username: bad },
			});
			expect(status).toBe(422);
		});
	}
});
