import { config } from '@config';
import { pg } from '@connections';
import { invites } from '@db/schema';
import { AppError, enum$error } from '@enums/errors.enum';
import { date, log, ulid } from '@rniverse/utils';
import { password as utils$password } from '@rniverse/utils/password';
import type { RequestMeta } from '@utils';
import { utils$token } from '@utils/token.util';
import { and, desc, eq, gt } from 'drizzle-orm';
import { service$notify } from './notify.service';
import { service$session } from './session.service';
import { service$user } from './user.service';

// --- create -----------------------------------------------------------

async function create(input: { email: string; invitedBy: string | null }) {
	const client = pg();

	const user = await service$user.find({ email: input.email });
	if (user) throw new AppError(enum$error.key.EMAIL_ALREADY_EXISTS);

	const [latest] = await client
		.select()
		.from(invites)
		.where(eq(invites.email, input.email))
		.orderBy(desc(invites.created_at))
		.limit(1);

	if (latest?.status === 'pending') {
		if (latest.expires_at > new Date()) {
			throw new AppError(enum$error.key.INVITE_ALREADY_PENDING);
		}
		// stale pending row — mark it expired, then issue a fresh one
		await client
			.update(invites)
			.set({ status: 'expired' })
			.where(eq(invites.id, latest.id));
	}

	const rawToken = utils$token.random();
	const tokenHash = await utils$token.digest(rawToken);
	const [invite] = await client
		.insert(invites)
		.values({
			id: ulid.generate(),
			email: input.email,
			token_hash: tokenHash,
			invited_by: input.invitedBy,
			status: 'pending',
			expires_at: date().add(config.invite.ttl, 'second').toDate(),
			created_at: new Date(),
		})
		.returning();

	const link = `${config.url.client}?token=${rawToken}`;
	await service$notify.send({
		to: invite.email,
		subject: "You've been invited",
		html: `<p>You've been invited to join. <a href="${link}">Accept your invite</a></p>`,
	});
	log.info({ inviteId: invite.id }, 'invite.create: sent');

	return invite;
}

// --- accept (completes signup) --------------------------------------

async function accept(
	input: {
		token: string;
		name: string;
		username?: string;
		password: string;
	},
	meta: RequestMeta = {},
) {
	const client = pg();
	const tokenHash = await utils$token.digest(input.token);
	const [invite] = await client
		.select()
		.from(invites)
		.where(
			and(
				eq(invites.token_hash, tokenHash),
				eq(invites.status, 'pending'),
				gt(invites.expires_at, new Date()),
			),
		)
		.limit(1);

	if (!invite) throw new AppError(enum$error.key.INVITE_TOKEN_INVALID);

	const existing = await service$user.find({ email: invite.email });
	if (existing) {
		// account got created another way (e.g. OAuth) after the invite went out
		await client
			.update(invites)
			.set({ status: 'expired' })
			.where(eq(invites.id, invite.id));
		throw new AppError(enum$error.key.EMAIL_ALREADY_EXISTS);
	}

	if (input.username) {
		const taken = await service$user.find({ username: input.username });
		if (taken) throw new AppError(enum$error.key.USERNAME_ALREADY_EXISTS);
	}

	const hash = await utils$password.hash(input.password);
	const user = await service$user.create({
		email: invite.email,
		name: input.name,
		username: input.username ?? null,
		hash,
		emailVerifiedAt: new Date(), // the invite link proved inbox control
	});

	await client
		.update(invites)
		.set({ status: 'accepted', accepted_at: new Date(), user_id: user.id })
		.where(eq(invites.id, invite.id));

	const { tokens } = await service$session.issue(user, meta); // auto-issue
	log.info(
		{ userId: user.id, inviteId: invite.id },
		'invite.accept: user created',
	);
	return tokens;
}

// --- revoke ---------------------------------------------------------

async function revoke(input: { email: string; invitedBy: string }) {
	const client = pg();
	const [row] = await client
		.update(invites)
		.set({ status: 'revoked' })
		.where(
			and(
				eq(invites.email, input.email),
				eq(invites.invited_by, input.invitedBy),
				eq(invites.status, 'pending'),
			),
		)
		.returning();

	// no row ⇒ not found, not the owner, or not pending — don't disclose which
	if (!row) throw new AppError(enum$error.key.NOT_FOUND);
	log.info({ inviteId: row.id }, 'invite.revoke: revoked');
	return row;
}

// --- expirePending (called when an account appears another way) -----

async function expirePending(email: string) {
	const client = pg();
	await client
		.update(invites)
		.set({ status: 'expired' })
		.where(and(eq(invites.email, email), eq(invites.status, 'pending')));
}

export const service$invite = { create, accept, revoke, expirePending };
