import { sync$seq } from '@rniverse/utils';

const list = [
	['NOT_FOUND', 'Resource not found', 404],
	['VALIDATION_FAILED', 'Validation failed', 422],
	['INTERNAL_ERROR', 'Internal server error', 500],
	['UNAUTHORIZED', 'Unauthorized', 401],
	['INVALID_TOKEN', 'Invalid or expired token', 401],
	['INVALID_CREDENTIALS', 'Invalid email or password', 401],
	['EMAIL_NOT_VERIFIED', 'Email is not verified', 403],
	['EMAIL_ALREADY_EXISTS', 'An account with this email already exists', 409],
	['USERNAME_ALREADY_EXISTS', 'This username is already taken', 409],
	[
		'USERNAME_ALREADY_SET',
		'Username is already set and cannot be changed',
		409,
	],
	['VERIFICATION_TOKEN_INVALID', 'Invalid or expired verification token', 401],
	['INVITE_TOKEN_INVALID', 'Invalid or expired invite token', 401],
	[
		'INVITE_ALREADY_PENDING',
		'An invite for this email is already pending',
		409,
	],
	['OAUTH_STATE_MISMATCH', 'OAuth state does not match', 401],
	['OAUTH_TOKEN_EXCHANGE_FAILED', 'OAuth token exchange failed', 502],
	['OAUTH_PROFILE_FETCH_FAILED', 'OAuth profile fetch failed', 502],
	[
		'OAUTH_EMAIL_UNVERIFIED',
		'OAuth provider did not confirm a verified email',
		403,
	],
	['OAUTH_PROVIDER_UNKNOWN', 'Unknown OAuth provider', 404],
	['EMAIL_SEND_FAILED', 'Failed to send email', 502],
] as const;

export type ErrorKey = (typeof list)[number][0];

const messages = Object.fromEntries(list.map(([k, msg]) => [k, msg])) as Record<
	ErrorKey,
	string
>;
const status = Object.fromEntries(list.map(([k, , s]) => [k, s])) as Record<
	ErrorKey,
	number
>;
const get_next_code = sync$seq.get({ type: 'code', length: 10, radix: 10 });
const codes = Object.fromEntries(
	list.map(([k]) => [k, get_next_code()]),
) as Record<ErrorKey, string>;
const key = Object.keys(messages).reduce(
	(acc, k) => {
		acc[k as ErrorKey] = k as ErrorKey;
		return acc;
	},
	{} as Record<ErrorKey, ErrorKey>,
);

export const enum$error = { key, messages, codes, status };
