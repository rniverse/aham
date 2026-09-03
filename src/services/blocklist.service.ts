import { service$cache } from './cache.service';

// Callers name a family or a user; the `blocklist:` / `fid:` / `user:` key
// shapes stay in here.
async function add(key: string, ttlSeconds: number) {
	await service$cache.set(`blocklist:${key}`, '1', ttlSeconds);
}

async function check(key: string) {
	const value = await service$cache.get(`blocklist:${key}`);
	return value !== null;
}

export const service$blocklist = {
	family: {
		add: (fid: string, ttlSeconds: number) => add(`fid:${fid}`, ttlSeconds),
		check: (fid: string) => check(`fid:${fid}`),
	},
	user: {
		add: (userId: string, ttlSeconds: number) =>
			add(`user:${userId}`, ttlSeconds),
		check: (userId: string) => check(`user:${userId}`),
	},
};
