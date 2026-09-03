import { t } from '@rniverse/utils'; // = valibot

// Reusable valibot field pipes, shared across the request schemas.

export const email = t.pipe(t.string(), t.email(), t.toLowerCase());

export const password = t.pipe(t.string(), t.minLength(8), t.maxLength(32));

export const username = t.pipe(
	t.string(),
	t.minLength(3),
	t.maxLength(32),
	t.regex(/^[a-zA-Z0-9]+(?:[_.][a-zA-Z0-9]+)*$/),
	t.toLowerCase(),
);

export const name = t.pipe(
	t.string(),
	t.maxLength(64),
	// alphanumerics with single space or "." separators — no leading, doubled, or trailing separator
	t.regex(/^[a-zA-Z0-9]+(?:[ .][a-zA-Z0-9]+)*$/),
);
