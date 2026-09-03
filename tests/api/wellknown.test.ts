import { describe, expect, it } from 'bun:test';
import { getApp } from '../utils';

describe('GET /.well-known/jwks.json', () => {
	it('publishes a single RS256 signing key with the configured kid', async () => {
		const app = await getApp();
		const res = await app.handle(
			new Request('http://localhost/.well-known/jwks.json'),
		);
		expect(res.status).toBe(200);

		const body = (await res.json()) as { keys: Record<string, unknown>[] };
		expect(Array.isArray(body.keys)).toBe(true);
		expect(body.keys).toHaveLength(1);

		const [jwk] = body.keys;
		expect(jwk.kty).toBe('RSA');
		expect(jwk.use).toBe('sig');
		expect(jwk.alg).toBe('RS256');
		expect(jwk.kid).toBe('auth-key-1');
		expect(typeof jwk.n).toBe('string');
		expect(typeof jwk.e).toBe('string');
		// the private component must never be published
		expect(jwk.d).toBeUndefined();
	});
});
