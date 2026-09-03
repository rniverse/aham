import { config } from '@config';
import { pg } from '@connections';
import { refresh_tokens } from '@db/schema';
import { enum$error } from '@enums/errors.enum';
import { date, ulid } from '@rniverse/utils';
import type { RequestMeta } from '@utils';
import { utils$token } from '@utils/token.util';
import { and, eq, isNull } from 'drizzle-orm';
import { service$blocklist } from './blocklist.service';
import { AppError } from './error.service';
import { service$user } from './user.service';

type SessionUser = { id: string; email: string };

// A stolen family is blocked for a day — comfortably longer than any
// already-issued 15-minute access token (spec §6).
const FAMILY_BLOCK_TTL_SECONDS = 60 * 60 * 24;

async function issue(
	user: SessionUser,
	meta: RequestMeta = {},
	familyId?: string,
) {
	const client = pg();
	const fid = familyId ?? ulid.generate();
	const rawToken = utils$token.random();
	const tokenHash = await utils$token.digest(rawToken);
	const id = ulid.generate();

	await client.insert(refresh_tokens).values({
		id,
		user_id: user.id,
		token_hash: tokenHash,
		family_id: fid,
		user_agent: meta.userAgent ?? null,
		ip: meta.ip ?? null,
		expires_at: date().add(config.jwt.refreshTokenTtlDays, 'day').toDate(),
		created_at: new Date(),
	});

	const accessToken = await utils$token.sign({
		sub: user.id,
		email: user.email,
		fid,
	});
	// `id` is the refresh-token row PK — internal, for the rotation chain only.
	// `tokens` is the client-facing shape.
	return { id, tokens: { accessToken, refreshToken: rawToken } };
}

async function refresh(rawToken: string, meta: RequestMeta = {}) {
	const client = pg();
	const tokenHash = await utils$token.digest(rawToken);
	const [row] = await client
		.select()
		.from(refresh_tokens)
		.where(eq(refresh_tokens.token_hash, tokenHash))
		.limit(1);

	if (!row) throw new AppError(enum$error.key.INVALID_TOKEN);
	if (row.expires_at < new Date())
		throw new AppError(enum$error.key.INVALID_TOKEN);

	if (row.revoked_at) {
		// This exact token was already rotated out once before. Presenting it
		// again means either a client retry gone wrong, or a stolen copy racing
		// the legitimate one — either way, kill the whole family rather than
		// guess which case this is.
		await revokeFamily(row.family_id);
		await service$blocklist.family.add(row.family_id, FAMILY_BLOCK_TTL_SECONDS);
		throw new AppError(enum$error.key.INVALID_TOKEN);
	}

	const user = await service$user.find({ id: row.user_id });
	if (!user) throw new AppError(enum$error.key.INVALID_TOKEN);

	const issued = await issue(user, meta, row.family_id);

	await client
		.update(refresh_tokens)
		.set({ revoked_at: new Date(), replaced_by: issued.id })
		.where(eq(refresh_tokens.id, row.id));

	return issued.tokens;
}

async function revoke(rawToken: string) {
	const client = pg();
	const tokenHash = await utils$token.digest(rawToken);
	await client
		.update(refresh_tokens)
		.set({ revoked_at: new Date() })
		.where(eq(refresh_tokens.token_hash, tokenHash));
}

async function revokeFamily(familyId: string) {
	const client = pg();
	await client
		.update(refresh_tokens)
		.set({ revoked_at: new Date() })
		.where(
			and(
				eq(refresh_tokens.family_id, familyId),
				isNull(refresh_tokens.revoked_at),
			),
		);
}

async function revokeAllForUser(userId: string) {
	const client = pg();
	await client
		.update(refresh_tokens)
		.set({ revoked_at: new Date() })
		.where(
			and(
				eq(refresh_tokens.user_id, userId),
				isNull(refresh_tokens.revoked_at),
			),
		);
}

export const service$session = {
	issue,
	refresh,
	revoke,
	revokeFamily,
	revokeAllForUser,
};
