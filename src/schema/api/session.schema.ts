import { t } from '@rniverse/utils'; // = valibot

export const schema$session = {
	refresh: t.object({ refreshToken: t.string() }),
	revoke: t.object({ refreshToken: t.string() }),
};
