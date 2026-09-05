import { t } from '@rniverse/utils'; // = valibot

const withToken = t.object({ refreshToken: t.string() });

export const schema$session = {
	refresh: withToken,
	revoke: withToken,
};
