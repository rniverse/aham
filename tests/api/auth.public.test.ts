import { describe, expect, it } from 'bun:test';
import { pg } from '@connections';
import { invites, users } from '@db/schema';
import { enum$error } from '@enums/errors.enum';
import { service$user } from '@services';
import { and, eq } from 'drizzle-orm';
import {
	call,
	expireInvite,
	expireVerificationToken,
	getApp,
	insertUser,
	requestInvite,
	requestPasswordReset,
	signup,
	uniqueEmail,
} from '../utils';

describe('POST /api/auth/invite', () => {
	it('creates a pending invite and returns the email + expiry', async () => {
		const app = await getApp();
		const email = uniqueEmail();

		const { status, body } = await call(app, 'POST', '/api/auth/invite', {
			body: { email },
		});
		expect(status).toBe(200);
		expect(body.ok).toBe(true);
		expect(body.data.email).toBe(email);
		expect(typeof body.data.expiresAt).toBe('string');

		const [row] = await pg()
			.select()
			.from(invites)
			.where(eq(invites.email, email));
		expect(row.status).toBe('pending');
		expect(row.invited_by).toBeNull();
	});

	it('lowercases the email', async () => {
		const app = await getApp();
		const { body } = await call(app, 'POST', '/api/auth/invite', {
			body: { email: 'MixedCase@Example.COM' },
		});
		expect(body.data.email).toBe('mixedcase@example.com');
	});

	it('rejects a second invite while one is still pending', async () => {
		const app = await getApp();
		const email = uniqueEmail();
		await call(app, 'POST', '/api/auth/invite', { body: { email } });

		const { status, body } = await call(app, 'POST', '/api/auth/invite', {
			body: { email },
		});
		expect(status).toBe(409);
		expect(body.error.code).toBe(enum$error.codes.INVITE_ALREADY_PENDING);
	});

	it('rejects an invite for an already-registered email', async () => {
		const app = await getApp();
		const s = await signup(app);

		const { status, body } = await call(app, 'POST', '/api/auth/invite', {
			body: { email: s.email },
		});
		expect(status).toBe(409);
		expect(body.error.code).toBe(enum$error.codes.EMAIL_ALREADY_EXISTS);
	});

	it('attributes the invite to the caller when a valid token is sent', async () => {
		const app = await getApp();
		const inviter = await signup(app);
		const email = uniqueEmail();

		await call(app, 'POST', '/api/auth/invite', {
			body: { email },
			token: inviter.accessToken,
		});

		const [row] = await pg()
			.select()
			.from(invites)
			.where(eq(invites.email, email));
		expect(row.invited_by).toBe(inviter.id);
	});

	it('treats an invalid bearer token as anonymous (soft guard)', async () => {
		const app = await getApp();
		const { status } = await call(app, 'POST', '/api/auth/invite', {
			body: { email: uniqueEmail() },
			token: 'not-a-real-token',
		});
		expect(status).toBe(200);
	});

	it('422 on a malformed email', async () => {
		const app = await getApp();
		const { status, body } = await call(app, 'POST', '/api/auth/invite', {
			body: { email: 'nope' },
		});
		expect(status).toBe(422);
		expect(body.error.code).toBe(enum$error.codes.VALIDATION_FAILED);
	});
});

describe('POST /api/auth/signup', () => {
	it('completes an invite: verified user + issued tokens', async () => {
		const app = await getApp();
		const email = uniqueEmail();
		const { inviteToken } = await requestInvite(app, email);

		const { status, body } = await call(app, 'POST', '/api/auth/signup', {
			body: {
				token: inviteToken,
				name: 'Ada Lovelace',
				password: 'password123',
			},
		});
		expect(status).toBe(200);
		expect(typeof body.data.accessToken).toBe('string');
		expect(typeof body.data.refreshToken).toBe('string');
		// no internal refresh-token row id in the client response
		expect(body.data.id).toBeUndefined();

		const [user] = await pg()
			.select()
			.from(users)
			.where(eq(users.email, email));
		expect(user.name).toBe('Ada Lovelace');
		expect(user.email_verified_at).not.toBeNull();
		expect(user.username).toBeNull();

		const [inv] = await pg()
			.select()
			.from(invites)
			.where(eq(invites.email, email));
		expect(inv.status).toBe('accepted');
		expect(inv.user_id).toBe(user.id);
	});

	it('rejects an already-used token', async () => {
		const app = await getApp();
		const { inviteToken } = await requestInvite(app, uniqueEmail());
		const done = { token: inviteToken, name: 'A B', password: 'password123' };
		await call(app, 'POST', '/api/auth/signup', { body: done });

		const { status, body } = await call(app, 'POST', '/api/auth/signup', {
			body: done,
		});
		expect(status).toBe(401);
		expect(body.error.code).toBe(enum$error.codes.INVITE_TOKEN_INVALID);
	});

	it('rejects an unknown token', async () => {
		const app = await getApp();
		const { status, body } = await call(app, 'POST', '/api/auth/signup', {
			body: { token: 'made-up', name: 'A B', password: 'password123' },
		});
		expect(status).toBe(401);
		expect(body.error.code).toBe(enum$error.codes.INVITE_TOKEN_INVALID);
	});

	it('422 when name is missing', async () => {
		const app = await getApp();
		const { inviteToken } = await requestInvite(app, uniqueEmail());
		const { status } = await call(app, 'POST', '/api/auth/signup', {
			body: { token: inviteToken, password: 'password123' },
		});
		expect(status).toBe(422);
	});

	it('422 when name breaks the pattern (leading dot)', async () => {
		const app = await getApp();
		const { inviteToken } = await requestInvite(app, uniqueEmail());
		const { status } = await call(app, 'POST', '/api/auth/signup', {
			body: { token: inviteToken, name: '.nope', password: 'password123' },
		});
		expect(status).toBe(422);
	});

	it('409 when the requested username is taken', async () => {
		const app = await getApp();
		await signup(app, { username: 'ada' });
		const { inviteToken } = await requestInvite(app, uniqueEmail());

		const { status, body } = await call(app, 'POST', '/api/auth/signup', {
			body: {
				token: inviteToken,
				name: 'Someone Else',
				username: 'ada',
				password: 'password123',
			},
		});
		expect(status).toBe(409);
		expect(body.error.code).toBe(enum$error.codes.USERNAME_ALREADY_EXISTS);
	});

	it('accepts an optional username and lowercases it', async () => {
		const app = await getApp();
		const { inviteToken } = await requestInvite(app, uniqueEmail());
		const { status, body } = await call(app, 'POST', '/api/auth/signup', {
			body: {
				token: inviteToken,
				name: 'Case Test',
				username: 'MixedName',
				password: 'password123',
			},
		});
		expect(status).toBe(200);
		const me = await call(app, 'GET', '/api/user/me', {
			token: body.data.accessToken,
		});
		expect(me.body.data.username).toBe('mixedname');
	});
});

describe('POST /api/auth/signin', () => {
	it('returns a fresh token pair for valid credentials', async () => {
		const app = await getApp();
		const s = await signup(app);

		const { status, body } = await call(app, 'POST', '/api/auth/signin', {
			body: { email: s.email, password: s.password },
		});
		expect(status).toBe(200);
		expect(typeof body.data.accessToken).toBe('string');
		expect(body.data.refreshToken).not.toBe(s.refreshToken);
	});

	it('401 on wrong password', async () => {
		const app = await getApp();
		const s = await signup(app);
		const { status, body } = await call(app, 'POST', '/api/auth/signin', {
			body: { email: s.email, password: 'wrong-password' },
		});
		expect(status).toBe(401);
		expect(body.error.code).toBe(enum$error.codes.INVALID_CREDENTIALS);
	});

	it('401 on unknown email', async () => {
		const app = await getApp();
		const { status, body } = await call(app, 'POST', '/api/auth/signin', {
			body: { email: uniqueEmail(), password: 'password123' },
		});
		expect(status).toBe(401);
		expect(body.error.code).toBe(enum$error.codes.INVALID_CREDENTIALS);
	});

	it('401 for an OAuth-only user (no password set)', async () => {
		const app = await getApp();
		const email = uniqueEmail('oauth');
		await insertUser({ email, hash: null, emailVerified: true });

		const { status, body } = await call(app, 'POST', '/api/auth/signin', {
			body: { email, password: 'anything-goes' },
		});
		expect(status).toBe(401);
		expect(body.error.code).toBe(enum$error.codes.INVALID_CREDENTIALS);
	});

	it('matches the email case-insensitively', async () => {
		const app = await getApp();
		const s = await signup(app);
		const { status } = await call(app, 'POST', '/api/auth/signin', {
			body: { email: s.email.toUpperCase(), password: s.password },
		});
		expect(status).toBe(200);
	});

	it('422 when a field is missing', async () => {
		const app = await getApp();
		const missingPassword = await call(app, 'POST', '/api/auth/signin', {
			body: { email: uniqueEmail() },
		});
		expect(missingPassword.status).toBe(422);
		const missingEmail = await call(app, 'POST', '/api/auth/signin', {
			body: { password: 'password123' },
		});
		expect(missingEmail.status).toBe(422);
	});

	it('no internal refresh-token id in the response', async () => {
		const app = await getApp();
		const s = await signup(app);
		const { body } = await call(app, 'POST', '/api/auth/signin', {
			body: { email: s.email, password: s.password },
		});
		expect(body.data.id).toBeUndefined();
	});
});

describe('password forgot / reset', () => {
	it('forgot returns ok even for an unknown email', async () => {
		const app = await getApp();
		const { status, body } = await call(
			app,
			'POST',
			'/api/auth/password/forgot',
			{
				body: { email: uniqueEmail() },
			},
		);
		expect(status).toBe(200);
		expect(body.ok).toBe(true);
	});

	it('reset changes the password and revokes existing sessions', async () => {
		const app = await getApp();
		const s = await signup(app);
		const { resetToken } = await requestPasswordReset(app, s.email);

		const { status } = await call(app, 'POST', '/api/auth/password/reset', {
			body: { token: resetToken, password: 'fresh-password-1' },
		});
		expect(status).toBe(200);

		const replay = await call(app, 'POST', '/api/session/refresh', {
			body: { refreshToken: s.refreshToken },
		});
		expect(replay.status).toBe(401);

		const signin = await call(app, 'POST', '/api/auth/signin', {
			body: { email: s.email, password: 'fresh-password-1' },
		});
		expect(signin.status).toBe(200);
	});

	it('reset rejects a bad token', async () => {
		const app = await getApp();
		const { status, body } = await call(
			app,
			'POST',
			'/api/auth/password/reset',
			{
				body: { token: 'nope', password: 'fresh-password-1' },
			},
		);
		expect(status).toBe(401);
		expect(body.error.code).toBe(enum$error.codes.VERIFICATION_TOKEN_INVALID);
	});

	it('reset rejects a token that has already been used', async () => {
		const app = await getApp();
		const s = await signup(app);
		const { resetToken } = await requestPasswordReset(app, s.email);
		await call(app, 'POST', '/api/auth/password/reset', {
			body: { token: resetToken, password: 'fresh-password-1' },
		});

		const again = await call(app, 'POST', '/api/auth/password/reset', {
			body: { token: resetToken, password: 'fresh-password-2' },
		});
		expect(again.status).toBe(401);
		expect(again.body.error.code).toBe(
			enum$error.codes.VERIFICATION_TOKEN_INVALID,
		);
	});

	it('reset rejects an expired token', async () => {
		const app = await getApp();
		const s = await signup(app);
		const { resetToken } = await requestPasswordReset(app, s.email);
		await expireVerificationToken(resetToken as string);

		const { status, body } = await call(
			app,
			'POST',
			'/api/auth/password/reset',
			{ body: { token: resetToken, password: 'fresh-password-1' } },
		);
		expect(status).toBe(401);
		expect(body.error.code).toBe(enum$error.codes.VERIFICATION_TOKEN_INVALID);
	});

	it('reset revokes every session, across devices', async () => {
		const app = await getApp();
		const s = await signup(app);
		// a second "device" — sign in again for another refresh token
		const second = await call(app, 'POST', '/api/auth/signin', {
			body: { email: s.email, password: s.password },
		});
		const secondRefresh = second.body.data.refreshToken as string;

		const { resetToken } = await requestPasswordReset(app, s.email);
		await call(app, 'POST', '/api/auth/password/reset', {
			body: { token: resetToken, password: 'fresh-password-1' },
		});

		for (const token of [s.refreshToken, secondRefresh]) {
			const r = await call(app, 'POST', '/api/session/refresh', {
				body: { refreshToken: token },
			});
			expect(r.status).toBe(401);
		}
	});

	it('an OAuth-only user can set a first password via forgot + reset', async () => {
		const app = await getApp();
		const email = uniqueEmail('oauth');
		await insertUser({ email, hash: null, emailVerified: true });

		const { status: forgotStatus, resetToken } = await requestPasswordReset(
			app,
			email,
		);
		expect(forgotStatus).toBe(200);
		expect(resetToken).toBeTruthy();

		const reset = await call(app, 'POST', '/api/auth/password/reset', {
			body: { token: resetToken, password: 'first-password-1' },
		});
		expect(reset.status).toBe(200);

		const signin = await call(app, 'POST', '/api/auth/signin', {
			body: { email, password: 'first-password-1' },
		});
		expect(signin.status).toBe(200);
	});

	it('forgot 422s on a malformed email', async () => {
		const app = await getApp();
		const { status } = await call(app, 'POST', '/api/auth/password/forgot', {
			body: { email: 'not-an-email' },
		});
		expect(status).toBe(422);
	});

	it('reset 422s on a too-short password', async () => {
		const app = await getApp();
		const { status } = await call(app, 'POST', '/api/auth/password/reset', {
			body: { token: 'whatever', password: 'short' },
		});
		expect(status).toBe(422);
	});
});

describe('invite re-issue lifecycle', () => {
	it('issues a fresh invite once the previous one has expired', async () => {
		const app = await getApp();
		const email = uniqueEmail();
		await call(app, 'POST', '/api/auth/invite', { body: { email } });
		await expireInvite(email);

		const { status } = await call(app, 'POST', '/api/auth/invite', {
			body: { email },
		});
		expect(status).toBe(200);

		const rows = await pg()
			.select()
			.from(invites)
			.where(eq(invites.email, email));
		expect(rows).toHaveLength(2);
		expect(rows.filter((r) => r.status === 'pending')).toHaveLength(1);
		expect(rows.filter((r) => r.status === 'expired')).toHaveLength(1);
	});

	it('issues a fresh invite after the previous one was revoked', async () => {
		const app = await getApp();
		const inviter = await signup(app);
		const email = uniqueEmail();
		await call(app, 'POST', '/api/auth/invite', {
			body: { email },
			token: inviter.accessToken,
		});
		await call(app, 'POST', '/api/auth/invite/revoke', {
			body: { email },
			token: inviter.accessToken,
		});

		const { status } = await call(app, 'POST', '/api/auth/invite', {
			body: { email },
		});
		expect(status).toBe(200);

		const [pending] = await pg()
			.select()
			.from(invites)
			.where(and(eq(invites.email, email), eq(invites.status, 'pending')));
		expect(pending).toBeTruthy();
	});

	it('signup 409s (and expires the invite) if a user appeared meanwhile', async () => {
		const app = await getApp();
		const email = uniqueEmail();
		const { inviteToken } = await requestInvite(app, email);

		// a user for that email is created by another path (simulated directly)
		await service$user.create({
			email,
			hash: null,
			emailVerifiedAt: new Date(),
		});

		const { status, body } = await call(app, 'POST', '/api/auth/signup', {
			body: { token: inviteToken, name: 'Too Late', password: 'password123' },
		});
		expect(status).toBe(409);
		expect(body.error.code).toBe(enum$error.codes.EMAIL_ALREADY_EXISTS);

		const [inv] = await pg()
			.select()
			.from(invites)
			.where(eq(invites.email, email));
		expect(inv.status).toBe('expired');
	});

	it('signup rejects an expired invite token', async () => {
		const app = await getApp();
		const email = uniqueEmail();
		const { inviteToken } = await requestInvite(app, email);
		await expireInvite(email);

		const { status, body } = await call(app, 'POST', '/api/auth/signup', {
			body: { token: inviteToken, name: 'Late One', password: 'password123' },
		});
		expect(status).toBe(401);
		expect(body.error.code).toBe(enum$error.codes.INVITE_TOKEN_INVALID);
	});
});

describe('validation bounds', () => {
	const cases: Array<[string, Record<string, unknown>]> = [
		['token missing', { name: 'A B', password: 'password123' }],
		['password too short', { name: 'A B', password: 'short12' }],
		['password too long', { name: 'A B', password: 'x'.repeat(33) }],
		['name too long', { name: 'x'.repeat(65), password: 'password123' }],
		['name with double dot', { name: 'a..b', password: 'password123' }],
		['name with trailing dot', { name: 'ab.', password: 'password123' }],
		['name with trailing space', { name: 'a b ', password: 'password123' }],
		[
			'username too short',
			{ name: 'A B', username: 'ab', password: 'password123' },
		],
		[
			'username with space',
			{ name: 'A B', username: 'a b', password: 'password123' },
		],
	];

	for (const [label, extra] of cases) {
		it(`signup 422s: ${label}`, async () => {
			const app = await getApp();
			const { inviteToken } = await requestInvite(app, uniqueEmail());
			const body: Record<string, unknown> = { ...extra };
			if (label !== 'token missing') body.token = inviteToken;
			const { status } = await call(app, 'POST', '/api/auth/signup', { body });
			expect(status).toBe(422);
		});
	}
});
