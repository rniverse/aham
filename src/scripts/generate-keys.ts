// Prints a fresh RS256 keypair as base64-encoded PEM, ready to paste into .env
// (JWT_PRIVATE_KEY / JWT_PUBLIC_KEY). Writes nothing.

import { jose } from '@rniverse/utils';

const { privateKey, publicKey } = await jose.generateKeyPair('RS256', {
	extractable: true,
});
const privatePem = await jose.exportPKCS8(privateKey);
const publicPem = await jose.exportSPKI(publicKey);

console.log(`JWT_PRIVATE_KEY=${Buffer.from(privatePem).toString('base64')}`);
console.log(`JWT_PUBLIC_KEY=${Buffer.from(publicPem).toString('base64')}`);
