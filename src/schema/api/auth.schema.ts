import { t } from '@rniverse/utils'; // = valibot
import { email, name, password, username } from '@schema/fields';

export const schema$auth = {
	invite: {
		create: t.object({ email }),
		revoke: t.object({ email }),
	},
	signup: t.object({
		token: t.string(),
		name,
		username: t.optional(username),
		password,
	}),
	signin: t.object({
		email,
		password: t.string(), // presence only — don't re-enforce minLength on login
	}),
	password: {
		forgot: t.object({ email }),
		reset: t.object({ token: t.string(), password }),
		change: t.object({
			currentPassword: t.string(),
			nextPassword: password,
		}),
	},
};
