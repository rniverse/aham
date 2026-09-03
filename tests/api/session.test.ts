import { describe, expect, it } from 'bun:test';
import { enum$error } from '@enums/errors.enum';
import { call, expireRefreshToken, getApp, signup } from '../utils';

describe('POST /api/session/refresh', () => {
	it('rotates the token pair', async () => {
		const app = await getApp();
		const s = await signup(app);

		const { status, body } = await call(app, 'POST', '/api/session/refresh', {
			body: { refreshToken: s.refreshToken },
		});
		expect(status).toBe(200);
		expect(typeof body.data.accessToken).toBe('string');
		expect(typeof body.data.refreshToken).toBe('string');
		expect(body.data.refreshToken).not.toBe(s.refreshToken);
		expect(body.data.id).toBeUndefined();
	});

	it('revokes the whole family when a rotated token is replayed', async () => {
		const app = await getApp();
		const s = await signup(app);

		const first = await call(app, 'POST', '/api/session/refresh', {
			body: { refreshToken: s.refreshToken },
		});
		expect(first.status).toBe(200);

		// replay the original (now-rotated) token
		const replay = await call(app, 'POST', '/api/session/refresh', {
			body: { refreshToken: s.refreshToken },
		});
		expect(replay.status).toBe(401);
		expect(replay.body.error.code).toBe(enum$error.codes.INVALID_TOKEN);

		// the legit descendant token is now dead too
		const descendant = await call(app, 'POST', '/api/session/refresh', {
			body: { refreshToken: first.body.data.refreshToken },
		});
		expect(descendant.status).toBe(401);
	});

	it('401 on an unknown refresh token', async () => {
		const app = await getApp();
		const { status, body } = await call(app, 'POST', '/api/session/refresh', {
			body: { refreshToken: 'does-not-exist' },
		});
		expect(status).toBe(401);
		expect(body.error.code).toBe(enum$error.codes.INVALID_TOKEN);
	});

	it('401 on an expired refresh token', async () => {
		const app = await getApp();
		const s = await signup(app);
		await expireRefreshToken(s.refreshToken);

		const { status, body } = await call(app, 'POST', '/api/session/refresh', {
			body: { refreshToken: s.refreshToken },
		});
		expect(status).toBe(401);
		expect(body.error.code).toBe(enum$error.codes.INVALID_TOKEN);
	});

	it('422 when refreshToken is missing', async () => {
		const app = await getApp();
		const { status } = await call(app, 'POST', '/api/session/refresh', {
			body: {},
		});
		expect(status).toBe(422);
	});

	it('a fresh signin after a family kill produces a working session', async () => {
		const app = await getApp();
		const s = await signup(app);
		await call(app, 'POST', '/api/session/refresh', {
			body: { refreshToken: s.refreshToken },
		});
		await call(app, 'POST', '/api/session/refresh', {
			body: { refreshToken: s.refreshToken },
		}); // reuse -> old family blocklisted

		const signin = await call(app, 'POST', '/api/auth/signin', {
			body: { email: s.email, password: s.password },
		});
		expect(signin.status).toBe(200);
		const refreshed = await call(app, 'POST', '/api/session/refresh', {
			body: { refreshToken: signin.body.data.refreshToken },
		});
		expect(refreshed.status).toBe(200); // new family, not blocklisted
	});
});

describe('POST /api/session/revoke', () => {
	it('revokes a refresh token', async () => {
		const app = await getApp();
		const s = await signup(app);

		const { status, body } = await call(app, 'POST', '/api/session/revoke', {
			body: { refreshToken: s.refreshToken },
		});
		expect(status).toBe(200);
		expect(body.ok).toBe(true);

		const reuse = await call(app, 'POST', '/api/session/refresh', {
			body: { refreshToken: s.refreshToken },
		});
		expect(reuse.status).toBe(401);
	});

	it('is a no-op (still ok) for an unknown token', async () => {
		const app = await getApp();
		const { status } = await call(app, 'POST', '/api/session/revoke', {
			body: { refreshToken: 'whatever' },
		});
		expect(status).toBe(200);
	});

	it('is idempotent — revoking twice still returns ok', async () => {
		const app = await getApp();
		const s = await signup(app);
		await call(app, 'POST', '/api/session/revoke', {
			body: { refreshToken: s.refreshToken },
		});
		const second = await call(app, 'POST', '/api/session/revoke', {
			body: { refreshToken: s.refreshToken },
		});
		expect(second.status).toBe(200);
	});

	it('422 when refreshToken is missing', async () => {
		const app = await getApp();
		const { status } = await call(app, 'POST', '/api/session/revoke', {
			body: {},
		});
		expect(status).toBe(422);
	});
});
