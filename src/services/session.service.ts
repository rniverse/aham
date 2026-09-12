import { config } from '@config';
import { pg } from '@connections';
import { refresh_tokens } from '@db/schema';
import { AppError, enum$error } from '@enums/errors.enum';
import { date, log, ulid } from '@rniverse/utils';
import type { RequestMeta } from '@utils';
import { utils$token } from '@utils/token.util';
import { and, eq, isNull } from 'drizzle-orm';
import { service$blocklist } from './blocklist.service';

type SessionUser = { id: string };

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
		expires_at: date().add(config.jwt.ttl.refreshToken, 'day').toDate(),
		created_at: new Date(),
	});

	const accessToken = await utils$token.sign({ sub: user.id, fid });
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
		log.warn(
			{ familyId: row.family_id, userId: row.user_id },
			'session.refresh: reused revoked token — family blocked',
		);
		await revokeFamily(row.family_id);
		await service$blocklist.family.add(row.family_id, FAMILY_BLOCK_TTL_SECONDS);
		throw new AppError(enum$error.key.INVALID_TOKEN);
	}

	const issued = await issue({ id: row.user_id }, meta, row.family_id);

	await client
		.update(refresh_tokens)
		.set({ revoked_at: new Date(), replaced_by: issued.id })
		.where(eq(refresh_tokens.id, row.id));

	log.info(
		{ userId: row.user_id, familyId: row.family_id },
		'session.refresh: rotated',
	);
	return issued.tokens;
}

async function revoke(rawToken: string) {
	const client = pg();
	const tokenHash = await utils$token.digest(rawToken);
	await client
		.update(refresh_tokens)
		.set({ revoked_at: new Date() })
		.where(eq(refresh_tokens.token_hash, tokenHash));
	log.info('session.revoke: token revoked');
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
	log.info({ familyId }, 'session.revoke: family revoked');
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
	log.info({ userId }, 'session.revoke: all sessions revoked');
}

export const service$session = {
	issue,
	refresh,
	revoke: {
		token: revoke,
		family: revokeFamily,
		user: revokeAllForUser,
	},
};
