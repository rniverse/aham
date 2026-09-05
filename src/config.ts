import { boundedParseInt } from '@rniverse/utils';
import { utils$duration } from '@utils/duration.util';

function required(name: string, fallback?: string): string {
	const value = process.env[name] ?? fallback;
	if (value === undefined) {
		throw new Error(`Missing required environment variable: ${name}`);
	}
	return value;
}

export const config = Object.freeze({
	get environment() {
		return process.env.NODE_ENV ?? 'development';
	},

	resend: {
		get key() {
			return required('RESEND_API_KEY');
		},
		get from() {
			return process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev';
		},
	},

	server: {
		get port() {
			return boundedParseInt(process.env.PORT, {
				min: 1,
				max: 65535,
				fallback: 3000,
			});
		},
		get host() {
			return process.env.HOST ?? '0.0.0.0';
		},
	},

	url: {
		get auth() {
			return required('AUTH_SERVICE_URL', 'http://localhost:3000');
		},
		get client() {
			return required('CLIENT_URL', 'http://localhost:5173');
		},
	},

	database: {
		get url() {
			return required('DATABASE_URL');
		},
	},

	cors: {
		get origins() {
			return (process.env.CORS_ORIGINS ?? '*')
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean);
		},
	},

	jwt: {
		key: {
			get private() {
				return Buffer.from(
					process.env.JWT_PRIVATE_KEY ?? '',
					'base64',
				).toString('utf-8');
			},
			get public() {
				return Buffer.from(process.env.JWT_PUBLIC_KEY ?? '', 'base64').toString(
					'utf-8',
				);
			},
			get id() {
				return process.env.JWT_KEY_ID ?? 'auth-key-1';
			},
		},
		ttl: {
			get accessToken() {
				return process.env.ACCESS_TOKEN_TTL ?? '15m';
			},
			get refreshToken() {
				return boundedParseInt(process.env.REFRESH_TOKEN_TTL_DAYS, {
					min: 1,
					max: 90,
					fallback: 30,
				});
			},
		},
	},

	google: {
		client: {
			get id() {
				return process.env.GOOGLE_CLIENT_ID ?? '';
			},
			get secret() {
				return process.env.GOOGLE_CLIENT_SECRET ?? '';
			},
		},
		get redirectURI() {
			return process.env.GOOGLE_REDIRECT_URI ?? '';
		},
	},

	invite: {
		// seconds — parsed from a compact duration string (default 1 day)
		get ttl() {
			return utils$duration.toSeconds(process.env.INVITE_TOKEN_TTL ?? '1d');
		},
	},
});
