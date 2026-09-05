import { pg } from '@connections';
import { oauth_accounts, users } from '@db/schema';
import { enum$error } from '@enums/errors.enum';
import { ulid } from '@rniverse/utils';
import { and, eq, isNull } from 'drizzle-orm';
import { AppError } from './error.service';

type FindQuery = { id: string } | { email: string } | { username: string };

function condition(query: FindQuery) {
	if ('id' in query) return eq(users.id, query.id);
	if ('email' in query) return eq(users.email, query.email);
	return eq(users.username, query.username);
}

async function find(query: FindQuery) {
	const client = pg();
	const [user] = await client
		.select()
		.from(users)
		.where(condition(query))
		.limit(1);
	return user ?? null;
}

type CreateInput = {
	email: string;
	name?: string | null;
	hash: string | null;
	username?: string | null;
	emailVerifiedAt?: Date | null;
};

async function create(input: CreateInput) {
	const client = pg();
	const now = new Date();
	const [user] = await client
		.insert(users)
		.values({
			id: ulid.generate(),
			email: input.email,
			name: input.name ?? null,
			hash: input.hash,
			username: input.username ?? null,
			email_verified_at: input.emailVerifiedAt ?? null,
			created_at: now,
			updated_at: now,
		})
		.returning();
	return user;
}

// Only name is allowed via the generic update path.
async function update(query: FindQuery, input: { name: string }) {
	const client = pg();
	const [_user] = await client
		.update(users)
		.set({ ...input, updated_at: new Date() })
		.where(condition(query))
		.returning();
	return _user;
}

async function changePassword(id: string, hash: string) {
	const client = pg();
	const [_user] = await client
		.update(users)
		.set({ hash, updated_at: new Date() })
		.where(eq(users.id, id))
		.returning();
	return _user;
}

// Username is set at most once: only writes when the current value is null.
async function changeUsername(id: string, username: string) {
	const taken = await find({ username });
	if (taken) throw new AppError(enum$error.key.USERNAME_ALREADY_EXISTS);

	const client = pg();
	const [user] = await client
		.update(users)
		.set({ username, updated_at: new Date() })
		.where(and(eq(users.id, id), isNull(users.username)))
		.returning();

	if (!user) {
		const existing = await find({ id });
		if (!existing) throw new AppError(enum$error.key.NOT_FOUND);
		throw new AppError(enum$error.key.USERNAME_ALREADY_SET);
	}

	return user;
}

async function findOAuthAccount(query: {
	provider: string;
	providerAccountId: string;
}) {
	const client = pg();
	const [row] = await client
		.select()
		.from(oauth_accounts)
		.where(
			and(
				eq(oauth_accounts.provider, query.provider),
				eq(oauth_accounts.provider_account_id, query.providerAccountId),
			),
		)
		.limit(1);
	return row ?? null;
}

async function linkOAuthAccount(
	userId: string,
	input: { provider: string; providerAccountId: string },
) {
	const client = pg();
	const [row] = await client
		.insert(oauth_accounts)
		.values({
			id: ulid.generate(),
			user_id: userId,
			provider: input.provider,
			provider_account_id: input.providerAccountId,
			created_at: new Date(),
		})
		.returning();
	return row;
}

export const service$user = {
	find,
	create,
	update,
	change: {
		username: changeUsername,
		password: changePassword,
	},
	oauth: { find: findOAuthAccount, link: linkOAuthAccount },
};
