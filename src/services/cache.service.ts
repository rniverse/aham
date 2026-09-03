import { pg } from '@connections';
import { cache_entries } from '@db/schema';
import { and, eq, gt } from 'drizzle-orm';

async function get(key: string) {
	const client = pg();
	const [row] = await client
		.select()
		.from(cache_entries)
		.where(
			and(eq(cache_entries.key, key), gt(cache_entries.expires_at, new Date())),
		)
		.limit(1);
	return row ? row.value : null;
}

async function set(key: string, value: string, ttlSeconds: number) {
	const client = pg();
	const expires_at = new Date(Date.now() + ttlSeconds * 1000);
	await client
		.insert(cache_entries)
		.values({ key, value, expires_at })
		.onConflictDoUpdate({
			target: cache_entries.key,
			set: { value, expires_at },
		});
}

async function del(key: string) {
	const client = pg();
	await client.delete(cache_entries).where(eq(cache_entries.key, key));
}

// TODO: a periodic sweep of expired rows would keep this table from growing
// unbounded — not needed for correctness (get() already filters on expiry),
// only for tidiness. Revisit once there's a worker process to run it in.
export const service$cache = { get, set, del };
