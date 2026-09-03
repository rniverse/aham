import { pg } from '@connections';
import { verification_tokens } from '@db/schema';
import { enum$error } from '@enums/errors.enum';
import { date, log, ulid } from '@rniverse/utils';
import type { RequestMeta } from '@utils';
import { utils$password } from '@utils/password.util';
import { type AccessTokenPayload, utils$token } from '@utils/token.util';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { service$blocklist } from './blocklist.service';
import { service$cache } from './cache.service';
import { AppError } from './error.service';
import { service$invite } from './invite.service';
import { service$oauth } from './oauth';
import { service$session } from './session.service';
import { service$user } from './user.service';

// short-lived cache windows for the OAuth handshake (spec §8)
const OAUTH_STATE_TTL_SECONDS = 60 * 10;
const OAUTH_EXCHANGE_TTL_SECONDS = 60;

function getProvider(provider: string) {
	const providerService = service$oauth[provider as keyof typeof service$oauth];
	if (!providerService)
		throw new AppError(enum$error.key.OAUTH_PROVIDER_UNKNOWN);
	return providerService;
}

async function consumeVerificationToken(
	rawToken: string,
	type: 'password_reset',
) {
	const client = pg();
	const tokenHash = await utils$token.digest(rawToken);
	const [row] = await client
		.select()
		.from(verification_tokens)
		.where(
			and(
				eq(verification_tokens.token_hash, tokenHash),
				eq(verification_tokens.type, type),
				isNull(verification_tokens.used_at),
				gt(verification_tokens.expires_at, new Date()),
			),
		)
		.limit(1);

	if (!row) throw new AppError(enum$error.key.VERIFICATION_TOKEN_INVALID);

	await client
		.update(verification_tokens)
		.set({ used_at: new Date() })
		.where(eq(verification_tokens.id, row.id));
	return row;
}

// --- signin -------------------------------------------------------------

async function signin(
	input: { email: string; password: string },
	meta: RequestMeta = {},
) {
	const user = await service$user.find({ email: input.email });
	if (!user?.hash) throw new AppError(enum$error.key.INVALID_CREDENTIALS);

	const isValid = await utils$password.verify(input.password, user.hash);
	if (!isValid) throw new AppError(enum$error.key.INVALID_CREDENTIALS);
	if (!user.email_verified_at)
		throw new AppError(enum$error.key.EMAIL_NOT_VERIFIED);

	const { tokens } = await service$session.issue(user, meta);
	return tokens;
}

// --- password -------------------------------------------------------------

const password = {
	forgot: async (emailAddress: string) => {
		const user = await service$user.find({ email: emailAddress });
		if (!user) return; // don't leak whether the email exists

		const rawToken = utils$token.random();
		const tokenHash = await utils$token.digest(rawToken);
		const client = pg();
		await client.insert(verification_tokens).values({
			id: ulid.generate(),
			user_id: user.id,
			token_hash: tokenHash,
			type: 'password_reset',
			expires_at: date().add(1, 'hour').toDate(),
			created_at: new Date(),
		});

		// TODO: wire a real email provider — logging the token for now
		log.info(
			{ email: user.email, token: rawToken },
			'Password reset token issued',
		);
	},

	reset: async (rawToken: string, newPassword: string) => {
		const verification = await consumeVerificationToken(
			rawToken,
			'password_reset',
		);
		const hash = await utils$password.hash(newPassword);
		const user = await service$user.update(
			{ id: verification.user_id },
			{ hash },
		);
		await service$session.revokeAllForUser(user.id); // reset ⇒ logout everywhere
		return user;
	},

	change: async (id: string, currentPassword: string, nextPassword: string) => {
		const user = await service$user.find({ id });
		if (!user?.hash) throw new AppError(enum$error.key.NOT_FOUND);

		const isValid = await utils$password.verify(currentPassword, user.hash);
		if (!isValid) throw new AppError(enum$error.key.INVALID_CREDENTIALS);

		const hash = await utils$password.hash(nextPassword);
		// deliberately no revoke — change leaves other sessions alone
		return service$user.update({ id }, { hash });
	},
};

// --- oauth --------------------------------------------------------------

const oauth = {
	start: async (provider: string) => {
		const providerService = getProvider(provider);
		const { url, state } = await providerService.start();
		await service$cache.set(
			`oauth:state:${state}`,
			provider,
			OAUTH_STATE_TTL_SECONDS,
		);
		return { url };
	},

	callback: async (
		provider: string,
		code: string,
		state: string,
		meta: RequestMeta = {},
	) => {
		const providerService = getProvider(provider);

		const cachedProvider = await service$cache.get(`oauth:state:${state}`);
		if (!cachedProvider || cachedProvider !== provider)
			throw new AppError(enum$error.key.OAUTH_STATE_MISMATCH);
		await service$cache.del(`oauth:state:${state}`); // single-use

		const profile = await providerService.callback(code);
		let user = await service$user.find({ email: profile.email });

		const account = {
			provider,
			providerAccountId: profile.providerAccountId,
		};

		if (user) {
			const linked = await service$user.oauth.find(account);
			if (!linked) {
				if (!profile.emailVerified)
					throw new AppError(enum$error.key.OAUTH_EMAIL_UNVERIFIED);
				await service$user.oauth.link(user.id, account);
			}
		} else {
			user = await service$user.create({
				email: profile.email,
				name: profile.name ?? null,
				hash: null,
				emailVerifiedAt: profile.emailVerified ? new Date() : null,
			});
			await service$user.oauth.link(user.id, account);
			// the account exists now — any outstanding invite link is dead
			await service$invite.expirePending(profile.email);
		}

		if (!user.email_verified_at)
			throw new AppError(enum$error.key.EMAIL_NOT_VERIFIED);

		// Tokens never travel in the redirect URL itself (browser history, server
		// logs, and Referer headers would all see them). Instead: stash them
		// behind a short-lived, single-use code, and hand the frontend only that.
		const { tokens } = await service$session.issue(user, meta);
		const exchangeCode = utils$token.random(16);
		await service$cache.set(
			`oauth:exchange:${exchangeCode}`,
			JSON.stringify(tokens),
			OAUTH_EXCHANGE_TTL_SECONDS,
		);
		return { code: exchangeCode };
	},

	exchange: async (code: string) => {
		const raw = await service$cache.get(`oauth:exchange:${code}`);
		if (!raw) throw new AppError(enum$error.key.INVALID_TOKEN);
		await service$cache.del(`oauth:exchange:${code}`);
		return JSON.parse(raw) as { accessToken: string; refreshToken: string };
	},
};

// --- token verification, used by the protected-route guards -------------

async function verify(input: {
	token?: string;
	user?: AccessTokenPayload;
	strict?: boolean;
}) {
	let payload = input.user;

	if (!payload) {
		if (!input.token) throw new AppError(enum$error.key.INVALID_TOKEN);
		try {
			payload = await utils$token.verify(input.token);
		} catch {
			throw new AppError(enum$error.key.INVALID_TOKEN);
		}
	}

	if (input.strict) {
		const isBlocked =
			(await service$blocklist.family.check(payload.fid)) ||
			(await service$blocklist.user.check(payload.sub));
		if (isBlocked) throw new AppError(enum$error.key.INVALID_TOKEN);
	}

	return payload;
}

export const service$auth = { signin, password, oauth, verify };
