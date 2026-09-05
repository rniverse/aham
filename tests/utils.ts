import { spyOn } from 'bun:test';
import { init } from '@app';
import { config } from '@config';
import { pg } from '@connections';
import {
	invites,
	refresh_tokens,
	users,
	verification_tokens,
} from '@db/schema';
import { jose } from '@rniverse/utils';
import { utils$token } from '@utils/token.util';
import { eq, sql } from 'drizzle-orm';

export type App = Awaited<ReturnType<typeof init>>;

// Build the app + open connections exactly once, shared across every test file
// (bun runs them in a single process).
let appPromise: Promise<App> | undefined;
export const getApp = (): Promise<App> => {
	appPromise ??= init();
	return appPromise;
};

const TABLES = [
	'users',
	'oauth_accounts',
	'refresh_tokens',
	'verification_tokens',
	'invites',
	'cache_entries',
];

export async function resetDb(): Promise<void> {
	await pg().execute(sql.raw(`TRUNCATE ${TABLES.join(', ')} CASCADE`));
}

// --- HTTP ------------------------------------------------------------------

type CallOpts = {
	body?: unknown;
	token?: string;
	headers?: Record<string, string>;
};

export type CallResult<T = any> = { res: Response; status: number; body: T };

export async function call<T = any>(
	app: App,
	method: string,
	path: string,
	opts: CallOpts = {},
): Promise<CallResult<T>> {
	const headers: Record<string, string> = { ...opts.headers };
	if (opts.body !== undefined) headers['content-type'] = 'application/json';
	if (opts.token) headers.authorization = `Bearer ${opts.token}`;

	const res = await app.handle(
		new Request(`http://localhost${path}`, {
			method,
			headers,
			body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
		}),
	);

	const text = await res.text();
	let body: unknown;
	try {
		body = text ? JSON.parse(text) : undefined;
	} catch {
		body = text;
	}
	return { res, status: res.status, body: body as T };
}

// --- flows ---------------------------------------------------------------

let seq = 0;
export const uniqueEmail = (label = 'user') =>
	`${label}-${Date.now().toString(36)}-${seq++}@example.com`;

/** POST /api/auth/invite, capturing the raw invite token it logs. */
export async function requestInvite(
	app: App,
	email: string,
	opts: { token?: string } = {},
) {
	const spy = spyOn(utils$token, 'random');
	try {
		const r = await call(app, 'POST', '/api/auth/invite', {
			body: { email },
			token: opts.token,
		});
		return {
			...r,
			inviteToken: spy.mock.results[0]?.value as string | undefined,
		};
	} finally {
		spy.mockRestore();
	}
}

/** POST /api/auth/password/forgot, capturing the raw reset token it logs. */
export async function requestPasswordReset(app: App, email: string) {
	const spy = spyOn(utils$token, 'random');
	try {
		const r = await call(app, 'POST', '/api/auth/password/forgot', {
			body: { email },
		});
		return {
			...r,
			resetToken: spy.mock.results[0]?.value as string | undefined,
		};
	} finally {
		spy.mockRestore();
	}
}

export type Session = {
	email: string;
	name: string;
	password: string;
	id: string; // the user id (JWT `sub`) — not the refresh-token row id
	accessToken: string;
	refreshToken: string;
};

/** Pull the `sub` (user id) claim out of an access token, no verification. */
export const jwtSub = (accessToken: string): string =>
	JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64').toString('utf-8'))
		.sub;

/** Full invite -> signup flow; returns the issued session. */
export async function signup(
	app: App,
	over: Partial<Pick<Session, 'email' | 'name' | 'password'>> & {
		username?: string;
	} = {},
): Promise<Session> {
	const email = over.email ?? uniqueEmail();
	const name = over.name ?? 'Test User';
	const password = over.password ?? 'password123';

	const { inviteToken, status } = await requestInvite(app, email);
	if (!inviteToken) throw new Error(`invite failed (${status})`);

	const body: Record<string, unknown> = { token: inviteToken, name, password };
	if (over.username) body.username = over.username;

	const { body: res, status: s } = await call(app, 'POST', '/api/auth/signup', {
		body,
	});
	if (s !== 200) {
		throw new Error(`signup failed (${s}): ${JSON.stringify(res)}`);
	}
	const data = res.data as { accessToken: string; refreshToken: string };
	return {
		email,
		name,
		password,
		id: jwtSub(data.accessToken),
		accessToken: data.accessToken,
		refreshToken: data.refreshToken,
	};
}

// --- oauth -------------------------------------------------------------

/** Spy global fetch to answer Google's token + userinfo endpoints. */
export function mockGoogleOAuth(profile: {
	sub?: string;
	email: string;
	email_verified?: boolean;
	name?: string;
}) {
	return spyOn(globalThis, 'fetch').mockImplementation((async (input: any) => {
		const url: string =
			typeof input === 'string'
				? input
				: input instanceof URL
					? input.href
					: input.url;

		if (url.includes('oauth2.googleapis.com/token')) {
			return Response.json({
				access_token: 'mock-provider-token',
				token_type: 'Bearer',
			});
		}
		if (url.includes('/oauth2/v3/userinfo')) {
			return Response.json({
				sub: profile.sub ?? 'google-sub-1',
				email: profile.email,
				email_verified: profile.email_verified ?? true,
				name: profile.name ?? 'Google User',
				picture: 'https://example.com/avatar.png',
			});
		}
		throw new Error(`unexpected fetch(${url}) in test`);
	}) as typeof fetch);
}

export const stateFromUrl = (url: string | null) =>
	new URL(url ?? '').searchParams.get('state') ?? '';

/**
 * Run the whole start -> callback OAuth dance with a stubbed provider fetch,
 * restoring the stub immediately after. Returns the parsed callback redirect.
 */
export async function oauthFlow(
	app: App,
	profile: {
		sub?: string;
		email: string;
		email_verified?: boolean;
		name?: string;
	},
	opts: { provider?: string; failAt?: 'token' | 'userinfo' } = {},
) {
	const provider = opts.provider ?? 'google';
	const spy = opts.failAt
		? mockGoogleOAuthFailure(opts.failAt)
		: mockGoogleOAuth(profile);
	try {
		const start = await app.handle(
			new Request(`http://localhost/api/oauth/${provider}/start`),
		);
		const { data } = (await start.json()) as { data: { redirect: string } };
		const state = stateFromUrl(data.redirect);
		const cb = await app.handle(
			new Request(
				`http://localhost/api/oauth/${provider}/callback?code=fake&state=${state}`,
			),
		);
		const loc = new URL(cb.headers.get('location') ?? 'http://placeholder');
		return {
			status: cb.status,
			state,
			location: cb.headers.get('location'),
			code: loc.searchParams.get('code'),
			error: loc.searchParams.get('error'),
		};
	} finally {
		spy.mockRestore();
	}
}

/** A Google-OAuth fetch stub that fails at the token or userinfo step. */
export function mockGoogleOAuthFailure(failAt: 'token' | 'userinfo') {
	return spyOn(globalThis, 'fetch').mockImplementation((async (input: any) => {
		const url: string =
			typeof input === 'string'
				? input
				: input instanceof URL
					? input.href
					: input.url;

		if (url.includes('oauth2.googleapis.com/token')) {
			if (failAt === 'token') return new Response('nope', { status: 500 });
			return Response.json({ access_token: 'mock-provider-token' });
		}
		if (url.includes('/oauth2/v3/userinfo')) {
			return new Response('nope', { status: 500 });
		}
		throw new Error(`unexpected fetch(${url}) in test`);
	}) as typeof fetch);
}

// --- direct-DB helpers (for cases that can't be produced through the API) ---

/** Force a pending invite to look expired. */
export async function expireInvite(email: string): Promise<void> {
	await pg()
		.update(invites)
		.set({ expires_at: new Date(Date.now() - 60_000) })
		.where(eq(invites.email, email));
}

/** Force a refresh token to look expired. */
export async function expireRefreshToken(rawToken: string): Promise<void> {
	const hash = await utils$token.digest(rawToken);
	await pg()
		.update(refresh_tokens)
		.set({ expires_at: new Date(Date.now() - 60_000) })
		.where(eq(refresh_tokens.token_hash, hash));
}

/** Force a verification token to look expired. */
export async function expireVerificationToken(rawToken: string): Promise<void> {
	const hash = await utils$token.digest(rawToken);
	await pg()
		.update(verification_tokens)
		.set({ expires_at: new Date(Date.now() - 60_000) })
		.where(eq(verification_tokens.token_hash, hash));
}

export async function deleteUser(id: string): Promise<void> {
	await pg().delete(users).where(eq(users.id, id));
}

/** Insert a user directly (e.g. an OAuth-only account with no password). */
export async function insertUser(over: {
	email: string;
	hash?: string | null;
	name?: string | null;
	emailVerified?: boolean;
}): Promise<{ id: string; email: string }> {
	const { ulid } = await import('@rniverse/utils');
	const id = ulid.generate();
	const now = new Date();
	await pg()
		.insert(users)
		.values({
			id,
			email: over.email,
			name: over.name ?? null,
			hash: over.hash ?? null,
			email_verified_at: over.emailVerified === false ? null : now,
			created_at: now,
			updated_at: now,
		});
	return { id, email: over.email };
}

/** Mint an access token that expired a minute ago (same key/issuer/kid). */
export async function expiredAccessToken(claims: {
	sub: string;
	email: string;
	fid: string;
}): Promise<string> {
	const key = await jose.importPKCS8(config.jwt.key.private, 'RS256');
	const past = Math.floor(Date.now() / 1000) - 60;
	return new jose.SignJWT(claims)
		.setProtectedHeader({ alg: 'RS256', kid: config.jwt.key.id })
		.setIssuedAt(past - 900)
		.setIssuer(config.url.auth)
		.setExpirationTime(past)
		.sign(key);
}
