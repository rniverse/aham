import { config } from '@config';
import { jose } from '@rniverse/utils'; // the whole `jose` library, re-exported — no separate dependency needed

const privateKey = await jose.importPKCS8(config.jwt.key.private, 'RS256');
const publicKey = await jose.importSPKI(config.jwt.key.public, 'RS256');

export type AccessTokenPayload = {
	sub: string; // user id
	fid: string; // refresh-token family id, checked against the blocklist under strict verification
};

async function sign(payload: AccessTokenPayload) {
	return new jose.SignJWT(payload)
		.setProtectedHeader({ alg: 'RS256', kid: config.jwt.key.id })
		.setIssuedAt()
		.setIssuer(config.url.auth)
		.setExpirationTime(config.jwt.ttl.accessToken)
		.sign(privateKey);
}

async function verify(token: string) {
	// Signature + expiry only — no blocklist/DB lookup here. `algorithms` is
	// pinned explicitly so a tampered header can't switch to a weaker alg.
	const { payload } = await jose.jwtVerify<AccessTokenPayload>(
		token,
		publicKey,
		{
			algorithms: ['RS256'],
			issuer: config.url.auth,
		},
	);
	return payload;
}

async function jwks() {
	const jwk = await jose.exportJWK(publicKey);
	return {
		keys: [{ ...jwk, use: 'sig', alg: 'RS256', kid: config.jwt.key.id }],
	};
}

function random(bytes = 32) {
	const buffer = new Uint8Array(bytes);
	crypto.getRandomValues(buffer);
	return Buffer.from(buffer).toString('base64url');
}

async function digest(value: string) {
	const encoded = new TextEncoder().encode(value);
	const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
	return Buffer.from(hashBuffer).toString('hex');
}

export const utils$token = { sign, verify, jwks, random, digest };
