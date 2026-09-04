// Prepares the test database for `bun run test` (via the `pretest` script):
// creates it if missing, resets its schema, then applies src/db/migrations.
// The migrations folder is git-ignored and regenerated from src/db/schema.ts,
// so a clean re-apply each run keeps the test DB deterministic regardless of
// whatever migration history a previous run left behind.
// Committed source; reads TEST_DATABASE_URL directly (a dev script, not app code).

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
	throw new Error('TEST_DATABASE_URL is not set (expected in .env)');
}

const dbName = new URL(testUrl).pathname.slice(1);

// 1. Ensure the database exists — connect to the server's default `postgres` db.
const adminUrl = new URL(testUrl);
adminUrl.pathname = '/postgres';
const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
try {
	const [row] = await admin`
		SELECT 1 AS ok FROM pg_database WHERE datname = ${dbName}
	`;
	if (!row) {
		await admin.unsafe(`CREATE DATABASE "${dbName}"`);
		console.log(`created database "${dbName}"`);
	}
} finally {
	await admin.end();
}

// 2. Wipe the schema (incl. drizzle's migration bookkeeping) and re-apply.
const sql = postgres(testUrl, { max: 1, onnotice: () => {} });
try {
	await sql.unsafe(`
		DROP SCHEMA IF EXISTS drizzle CASCADE;
		DROP SCHEMA public CASCADE;
		CREATE SCHEMA public;
	`);
	await migrate(drizzle(sql), { migrationsFolder: './src/db/migrations' });
	console.log(`test db "${dbName}" reset + migrated`);
} finally {
	await sql.end();
}
