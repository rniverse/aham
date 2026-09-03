import { t } from '@rniverse/utils'; // = valibot
import { username } from '@schema/fields';

export const schema$user = {
	username: {
		change: t.object({ username }),
	},
};
