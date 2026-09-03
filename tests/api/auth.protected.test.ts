import { describe, expect, it } from 'bun:test';
import { pg } from '@connections';
import { invites } from '@db/schema';
import { enum$error } from '@enums/errors.enum';
import { service$session } from '@services';
import { eq } from 'drizzle-orm';
import {
	call,
	expiredAccessToken,
	getApp,
	insertUser,
	requestInvite,
	signup,
	uniqueEmail,
} from '../utils';

describe('POST /api/auth/invite/revoke', () => {
	it('lets the owner revoke their own pending invite', async () => {
		const app = await getApp();
		const inviter = await signup(app);
		const email = uniqueEmail();
		await call(app, 'POST', '/api/auth/invite', {
			body: { email },
			token: inviter.accessToken,
		});

		const { status, body } = await call(
			app,
			'POST',
			'/api/auth/invite/revoke',
			{ body: { email }, token: inviter.accessToken },
		);
		expect(status).toBe(200);
		expect(body.ok).toBe(true);

		const [row] = await pg()
			.select()
			.from(invites)
			.where(eq(invites.email, email));
		expect(row.status).toBe('revoked');
	});

	it('404 when revoking an invite you did not create', async () => {
		const app = await getApp();
		const inviterA = await signup(app);
		const inviterB = await signup(app);
		const email = uniqueEmail();
		await call(app, 'POST', '/api/auth/invite', {
			body: { email },
			token: inviterA.accessToken,
		});

		const { status, body } = await call(
			app,
			'POST',
			'/api/auth/invite/revoke',
			{ body: { email }, token: inviterB.accessToken },
		);
		expect(status).toBe(404);
		expect(body.error.code).toBe(enum$error.codes.NOT_FOUND);
	});

	it('401 without a token', async () => {
		const app = await getApp();
		const { status, body } = await call(
			app,
			'POST',
			'/api/auth/invite/revoke',
			{ body: { email: uniqueEmail() } },
		);
		expect(status).toBe(401);
		expect(body.error.code).toBe(enum$error.codes.UNAUTHORIZED);
	});

	it('INVALID_TOKEN (not UNAUTHORIZED) for a garbage bearer token', async () => {
		const app = await getApp();
		const { status, body } = await call(
			app,
			'POST',
			'/api/auth/invite/revoke',
			{ token: 'garbage.jwt.value', body: { email: uniqueEmail() } },
		);
		expect(status).toBe(401);
		expect(body.error.code).toBe(enum$error.codes.INVALID_TOKEN);
	});

	it('404 when the invite was already accepted', async () => {
		const app = await getApp();
		const inviter = await signup(app);
		const email = uniqueEmail();
		const { inviteToken } = await requestInvite(app, email, {
			token: inviter.accessToken,
		});
		await call(app, 'POST', '/api/auth/signup', {
			body: { token: inviteToken, name: 'New User', password: 'password123' },
		});

		const { status, body } = await call(
			app,
			'POST',
			'/api/auth/invite/revoke',
			{ body: { email }, token: inviter.accessToken },
		);
		expect(status).toBe(404);
		expect(body.error.code).toBe(enum$error.codes.NOT_FOUND);
	});

	it('404 when no invite exists for that email at all', async () => {
		const app = await getApp();
		const inviter = await signup(app);
		const { status } = await call(app, 'POST', '/api/auth/invite/revoke', {
			body: { email: uniqueEmail() },
			token: inviter.accessToken,
		});
		expect(status).toBe(404);
	});

	it('422 on a malformed email', async () => {
		const app = await getApp();
		const inviter = await signup(app);
		const { status } = await call(app, 'POST', '/api/auth/invite/revoke', {
			body: { email: 'nope' },
			token: inviter.accessToken,
		});
		expect(status).toBe(422);
	});
});

describe('POST /api/auth/password/change', () => {
	it('changes the password and leaves other sessions alone', async () => {
		const app = await getApp();
		const s = await signup(app);

		const { status, body } = await call(
			app,
			'POST',
			'/api/auth/password/change',
			{
				token: s.accessToken,
				body: { currentPassword: s.password, nextPassword: 'next-password-1' },
			},
		);
		expect(status).toBe(200);
		expect(body.data.hash).toBeUndefined();

		// change != reset: the existing refresh token still works
		const refreshed = await call(app, 'POST', '/api/session/refresh', {
			body: { refreshToken: s.refreshToken },
		});
		expect(refreshed.status).toBe(200);

		const signin = await call(app, 'POST', '/api/auth/signin', {
			body: { email: s.email, password: 'next-password-1' },
		});
		expect(signin.status).toBe(200);
	});

	it('401 on wrong current password', async () => {
		const app = await getApp();
		const s = await signup(app);
		const { status, body } = await call(
			app,
			'POST',
			'/api/auth/password/change',
			{
				token: s.accessToken,
				body: { currentPassword: 'not-it', nextPassword: 'next-password-1' },
			},
		);
		expect(status).toBe(401);
		expect(body.error.code).toBe(enum$error.codes.INVALID_CREDENTIALS);
	});

	it('401 without a token', async () => {
		const app = await getApp();
		const { status } = await call(app, 'POST', '/api/auth/password/change', {
			body: { currentPassword: 'x', nextPassword: 'next-password-1' },
		});
		expect(status).toBe(401);
	});

	it('401 when the session family has been blocklisted (strict guard)', async () => {
		const app = await getApp();
		const s = await signup(app);

		// replaying a rotated refresh token blocklists the whole family
		await call(app, 'POST', '/api/session/refresh', {
			body: { refreshToken: s.refreshToken },
		});
		await call(app, 'POST', '/api/session/refresh', {
			body: { refreshToken: s.refreshToken },
		});

		const { status, body } = await call(
			app,
			'POST',
			'/api/auth/password/change',
			{
				token: s.accessToken, // still validly signed, but its fid is blocked
				body: { currentPassword: s.password, nextPassword: 'next-password-1' },
			},
		);
		expect(status).toBe(401);
		expect(body.error.code).toBe(enum$error.codes.INVALID_TOKEN);
	});

	it('INVALID_TOKEN for a garbage bearer token', async () => {
		const app = await getApp();
		const { status, body } = await call(
			app,
			'POST',
			'/api/auth/password/change',
			{
				token: 'not-a-jwt',
				body: { currentPassword: 'x', nextPassword: 'next-password-1' },
			},
		);
		expect(status).toBe(401);
		expect(body.error.code).toBe(enum$error.codes.INVALID_TOKEN);
	});

	it('INVALID_TOKEN for an expired (but well-formed) access token', async () => {
		const app = await getApp();
		const s = await signup(app);
		const stale = await expiredAccessToken({
			sub: s.id,
			email: s.email,
			fid: 'whatever',
		});
		const { status, body } = await call(
			app,
			'POST',
			'/api/auth/password/change',
			{
				token: stale,
				body: { currentPassword: s.password, nextPassword: 'next-password-1' },
			},
		);
		expect(status).toBe(401);
		expect(body.error.code).toBe(enum$error.codes.INVALID_TOKEN);
	});

	it('NOT_FOUND for an OAuth-only user (no password to verify against)', async () => {
		const app = await getApp();
		const email = uniqueEmail('oauth');
		const user = await insertUser({ email, hash: null, emailVerified: true });
		const { tokens } = await service$session.issue({ id: user.id, email });

		const { status, body } = await call(
			app,
			'POST',
			'/api/auth/password/change',
			{
				token: tokens.accessToken,
				body: { currentPassword: 'anything', nextPassword: 'next-password-1' },
			},
		);
		expect(status).toBe(404);
		expect(body.error.code).toBe(enum$error.codes.NOT_FOUND);
	});

	it('422 when nextPassword is out of bounds', async () => {
		const app = await getApp();
		const s = await signup(app);
		const short = await call(app, 'POST', '/api/auth/password/change', {
			token: s.accessToken,
			body: { currentPassword: s.password, nextPassword: 'tiny' },
		});
		expect(short.status).toBe(422);
		const long = await call(app, 'POST', '/api/auth/password/change', {
			token: s.accessToken,
			body: { currentPassword: s.password, nextPassword: 'x'.repeat(33) },
		});
		expect(long.status).toBe(422);
	});
});
