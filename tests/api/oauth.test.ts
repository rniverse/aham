import { describe, expect, it } from 'bun:test';
import { pg } from '@connections';
import { invites, oauth_accounts, users } from '@db/schema';
import { eq } from 'drizzle-orm';
import {
	call,
	getApp,
	mockGoogleOAuth,
	oauthFlow,
	signup,
	stateFromUrl,
	uniqueEmail,
} from '../utils';

describe('GET /api/oauth/:provider/start', () => {
	it('returns a google auth url with the expected query params', async () => {
		const app = await getApp();
		const res = await app.handle(
			new Request('http://localhost/api/oauth/google/start'),
		);
		expect(res.status).toBe(200);

		const { redirect } = await res.json() as { redirect: string };
		const url = new URL(redirect);
		expect(url.origin).toBe('https://accounts.google.com');
		expect(url.searchParams.get('response_type')).toBe('code');
		expect(url.searchParams.get('scope')).toContain('email');
		expect(stateFromUrl(url.href).length).toBeGreaterThan(0);
	});

	it('callback redirects to the custom ?redirect= url when provided', async () => {
		const app = await getApp();
		const email = uniqueEmail('redir');
		const custom = 'http://localhost:4000';
		const spy = mockGoogleOAuth({ email });
		try {
			const start = await app.handle(
				new Request(`http://localhost/api/oauth/google/start?redirect=${encodeURIComponent(custom)}`),
			);
			const { redirect } = await start.json() as { redirect: string };
			const state = stateFromUrl(redirect);
			const cb = await app.handle(
				new Request(`http://localhost/api/oauth/google/callback?code=fake&state=${state}`),
			);
			const loc = new URL(cb.headers.get('location') ?? '');
			expect(loc.origin).toBe(custom);
			expect(loc.searchParams.get('code')).toBeTruthy();
		} finally {
			spy.mockRestore();
		}
	});

	it('404 for an unknown provider', async () => {
		const app = await getApp();
		const res = await app.handle(
			new Request('http://localhost/api/oauth/github/start'),
		);
		expect(res.status).toBe(404);
	});
});

describe('oauth callback — new user', () => {
	it('provisions a verified user and issues tokens via the one-time code', async () => {
		const app = await getApp();
		const email = uniqueEmail('gg');
		const { status, code } = await oauthFlow(app, {
			email,
			name: 'Google Person',
		});
		expect(status).toBe(302);
		expect(code).toBeTruthy();

		const ex = await call(app, 'POST', '/api/oauth/exchange', {
			body: { code },
		});
		expect(ex.status).toBe(200);
		expect(typeof ex.body.data.accessToken).toBe('string');
		expect(typeof ex.body.data.refreshToken).toBe('string');
		expect(ex.body.data.id).toBeUndefined();

		const me = await call(app, 'GET', '/api/user/me', {
			token: ex.body.data.accessToken,
		});
		expect(me.body.data.email).toBe(email);
		expect(me.body.data.name).toBe('Google Person');
		expect(me.body.data.email_verified_at).not.toBeNull();

		const [link] = await pg()
			.select()
			.from(oauth_accounts)
			.where(eq(oauth_accounts.user_id, me.body.data.id));
		expect(link.provider).toBe('google');
	});

	it('expires a pending invite for the same email', async () => {
		const app = await getApp();
		const email = uniqueEmail('gg');
		await call(app, 'POST', '/api/auth/invite', { body: { email } });

		await oauthFlow(app, { email });

		const [inv] = await pg()
			.select()
			.from(invites)
			.where(eq(invites.email, email));
		expect(inv.status).toBe('expired');
	});

	it('creates the user but errors when the provider email is unverified', async () => {
		const app = await getApp();
		const email = uniqueEmail('gg');
		const { status, error } = await oauthFlow(app, {
			email,
			email_verified: false,
		});
		expect(status).toBe(302);
		expect(error).toBe('EMAIL_NOT_VERIFIED');

		// current behaviour: the row is still created (flagged in the review)
		const [row] = await pg().select().from(users).where(eq(users.email, email));
		expect(row).toBeTruthy();
		expect(row.email_verified_at).toBeNull();
	});
});

describe('oauth callback — existing user', () => {
	it('links the provider account when the emails match and are verified', async () => {
		const app = await getApp();
		const existing = await signup(app);

		const { status, error, code } = await oauthFlow(app, {
			email: existing.email,
			name: 'Linked',
		});
		expect(status).toBe(302);
		expect(error).toBeNull();
		expect(code).toBeTruthy();

		const links = await pg()
			.select()
			.from(oauth_accounts)
			.where(eq(oauth_accounts.user_id, existing.id));
		expect(links).toHaveLength(1);
		expect(links[0].provider).toBe('google');
	});

	it('is idempotent — a second login does not create a duplicate link', async () => {
		const app = await getApp();
		const existing = await signup(app);
		await oauthFlow(app, { email: existing.email });
		await oauthFlow(app, { email: existing.email });

		const links = await pg()
			.select()
			.from(oauth_accounts)
			.where(eq(oauth_accounts.user_id, existing.id));
		expect(links).toHaveLength(1);
	});

	it('refuses to link when the provider email is unverified', async () => {
		const app = await getApp();
		const existing = await signup(app);
		const { status, error } = await oauthFlow(app, {
			email: existing.email,
			email_verified: false,
		});
		expect(status).toBe(302);
		expect(error).toBe('OAUTH_EMAIL_UNVERIFIED');

		const links = await pg()
			.select()
			.from(oauth_accounts)
			.where(eq(oauth_accounts.user_id, existing.id));
		expect(links).toHaveLength(0);
	});
});

describe('oauth callback — failures', () => {
	it('redirects with ?error=OAUTH_STATE_MISMATCH on an unknown state', async () => {
		const app = await getApp();
		const cb = await app.handle(
			new Request(
				'http://localhost/api/oauth/google/callback?code=fake&state=bogus',
			),
		);
		expect(cb.status).toBe(302);
		expect(
			new URL(cb.headers.get('location') ?? '').searchParams.get('error'),
		).toBe('OAUTH_STATE_MISMATCH');
	});

	it('a state is single-use', async () => {
		const app = await getApp();
		// a full successful flow consumes the state...
		const { state, error } = await oauthFlow(app, { email: uniqueEmail('gg') });
		expect(error).toBeNull();

		// ...replaying it now fails the state check (before any provider call)
		const replay = await app.handle(
			new Request(
				`http://localhost/api/oauth/google/callback?code=fake&state=${state}`,
			),
		);
		expect(
			new URL(replay.headers.get('location') ?? '').searchParams.get('error'),
		).toBe('OAUTH_STATE_MISMATCH');
	});

	it('redirects with ?error=OAUTH_TOKEN_EXCHANGE_FAILED when the token call fails', async () => {
		const app = await getApp();
		const { status, error } = await oauthFlow(
			app,
			{ email: uniqueEmail('gg') },
			{ failAt: 'token' },
		);
		expect(status).toBe(302);
		expect(error).toBe('OAUTH_TOKEN_EXCHANGE_FAILED');
	});

	it('redirects with ?error=OAUTH_PROFILE_FETCH_FAILED when userinfo fails', async () => {
		const app = await getApp();
		const { status, error } = await oauthFlow(
			app,
			{ email: uniqueEmail('gg') },
			{ failAt: 'userinfo' },
		);
		expect(status).toBe(302);
		expect(error).toBe('OAUTH_PROFILE_FETCH_FAILED');
	});

	it('redirects with ?error=OAUTH_PROVIDER_UNKNOWN for an unknown provider', async () => {
		const app = await getApp();
		const cb = await app.handle(
			new Request(
				'http://localhost/api/oauth/github/callback?code=fake&state=anything',
			),
		);
		expect(cb.status).toBe(302);
		expect(
			new URL(cb.headers.get('location') ?? '').searchParams.get('error'),
		).toBe('OAUTH_PROVIDER_UNKNOWN');
	});

	it('422 when the callback is missing code/state query params', async () => {
		const app = await getApp();
		const res = await app.handle(
			new Request('http://localhost/api/oauth/google/callback'),
		);
		expect(res.status).toBe(422);
	});
});

describe('POST /api/oauth/exchange', () => {
	it('401 for an unknown code', async () => {
		const app = await getApp();
		const { status } = await call(app, 'POST', '/api/oauth/exchange', {
			body: { code: 'never-issued' },
		});
		expect(status).toBe(401);
	});

	it('the one-time code cannot be exchanged twice', async () => {
		const app = await getApp();
		const { code } = await oauthFlow(app, { email: uniqueEmail('gg') });
		const first = await call(app, 'POST', '/api/oauth/exchange', {
			body: { code },
		});
		expect(first.status).toBe(200);
		const second = await call(app, 'POST', '/api/oauth/exchange', {
			body: { code },
		});
		expect(second.status).toBe(401);
	});

	it('422 when code is missing', async () => {
		const app = await getApp();
		const { status } = await call(app, 'POST', '/api/oauth/exchange', {
			body: {},
		});
		expect(status).toBe(422);
	});
});
