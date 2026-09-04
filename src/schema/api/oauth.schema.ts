import { t } from '@rniverse/utils'; // = valibot

export const schema$oauth = {
	start: {
		params: t.object({ provider: t.string() }),
		query: t.object({ redirect: t.optional(t.string()) }),
	},
	callback: {
		params: t.object({ provider: t.string() }),
		query: t.object({ code: t.string(), state: t.string() }),
	},
	exchange: {
		body: t.object({ code: t.string() }),
	},
};
