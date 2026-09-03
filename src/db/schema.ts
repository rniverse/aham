import {
	type AnyPgColumn,
	pgTable,
	text,
	timestamp,
	unique,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
	id: text('id').primaryKey(),
	email: text('email').notNull().unique(),
	username: text('username').unique(),
	name: text('name'), // nullable — display name; set at signup or from an oauth profile
	hash: text('hash'), // nullable — oauth-only users have no password
	email_verified_at: timestamp('email_verified_at'),
	created_at: timestamp('created_at').defaultNow().notNull(),
	updated_at: timestamp('updated_at').defaultNow().notNull(),
});

export const oauth_accounts = pgTable(
	'oauth_accounts',
	{
		id: text('id').primaryKey(),
		user_id: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		provider: text('provider').notNull(),
		provider_account_id: text('provider_account_id').notNull(),
		created_at: timestamp('created_at').defaultNow().notNull(),
	},
	(t) => [unique().on(t.provider, t.provider_account_id)],
);

export const refresh_tokens = pgTable('refresh_tokens', {
	id: text('id').primaryKey(),
	user_id: text('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	token_hash: text('token_hash').notNull().unique(),
	family_id: text('family_id').notNull(),
	replaced_by: text('replaced_by').references(
		(): AnyPgColumn => refresh_tokens.id,
	),
	user_agent: text('user_agent'),
	ip: text('ip'),
	revoked_at: timestamp('revoked_at'),
	expires_at: timestamp('expires_at').notNull(),
	created_at: timestamp('created_at').defaultNow().notNull(),
});

export const verification_tokens = pgTable('verification_tokens', {
	id: text('id').primaryKey(),
	user_id: text('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	token_hash: text('token_hash').notNull().unique(),
	type: text('type').notNull(), // 'password_reset' (email verification moved to `invites`)
	expires_at: timestamp('expires_at').notNull(),
	used_at: timestamp('used_at'),
	created_at: timestamp('created_at').defaultNow().notNull(),
});

export const invites = pgTable('invites', {
	id: text('id').primaryKey(),
	email: text('email').notNull(),
	token_hash: text('token_hash').notNull().unique(), // raw token never stored
	invited_by: text('invited_by').references(() => users.id, {
		onDelete: 'set null',
	}), // null for self-signup
	user_id: text('user_id').references(() => users.id, { onDelete: 'set null' }), // set on acceptance
	status: text('status').notNull(), // 'pending' | 'accepted' | 'expired' | 'revoked'
	expires_at: timestamp('expires_at').notNull(),
	accepted_at: timestamp('accepted_at'),
	created_at: timestamp('created_at').defaultNow().notNull(),
});

export const cache_entries = pgTable('cache_entries', {
	key: text('key').primaryKey(),
	value: text('value').notNull(),
	expires_at: timestamp('expires_at').notNull(),
	created_at: timestamp('created_at').defaultNow().notNull(),
});
