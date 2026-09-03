import { password } from '@rniverse/utils'; // = argon2, re-exported directly

async function hash(plain: string) {
	return password.hash(plain);
}

async function verify(plain: string, digest: string) {
	return password.verify(digest, plain);
}

export const utils$password = { hash, verify };
