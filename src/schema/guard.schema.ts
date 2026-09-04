import { t } from '@rniverse/utils'; // = valibot

export const schema$guard = {
	// Required — validates presence and Bearer scheme, strips the prefix.
	bearer: t.object({
		authorization: t.pipe(
			t.string(),
			t.startsWith('Bearer '),
			t.transform((v) => v.slice(7)),
		),
	}),
	// Optional — absent is fine, but a present value must carry the Bearer scheme.
	soft: t.object({
		authorization: t.optional(
			t.pipe(
				t.string(),
				t.startsWith('Bearer '),
				t.transform((v) => v.slice(7)),
			),
		),
	}),
};
