import { boundedParseInt, duration, environment as env } from '@rniverse/utils';

export const config = Object.freeze({
	get environment() {
		return env.get('NODE_ENV', 'development');
	},

	// Every connection's client name (Postgres `application_name`) —
	// required, the connectors have no default.
	get appName() {
		return env.required('INSTANCE_NAME');
	},

	services: {
		notify: {
			get url() {
				return env.required('NOTIFY_SERVICE_URL', 'http://localhost:3001');
			},
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
			return env.get('HOST', '0.0.0.0');
		},
	},

	url: {
		get auth() {
			return env.required('AUTH_SERVICE_URL', 'http://localhost:3000');
		},
		get client() {
			return env.required('CLIENT_URL', 'http://localhost:5173');
		},
	},

	database: {
		get url() {
			return env.required('DATABASE_URL');
		},
	},

	cors: {
		get origins() {
			return env
				.get('CORS_ORIGINS', '*')
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean);
		},
	},

	jwt: {
		key: {
			get private() {
				return Buffer.from(env.get('JWT_PRIVATE_KEY', ''), 'base64').toString(
					'utf-8',
				);
			},
			get public() {
				return Buffer.from(env.get('JWT_PUBLIC_KEY', ''), 'base64').toString(
					'utf-8',
				);
			},
			get id() {
				return env.get('JWT_KEY_ID', 'auth-key-1');
			},
		},
		ttl: {
			get accessToken() {
				return env.get('ACCESS_TOKEN_TTL', '15m');
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
				return env.get('GOOGLE_CLIENT_ID', '');
			},
			get secret() {
				return env.get('GOOGLE_CLIENT_SECRET', '');
			},
		},
		get redirectURI() {
			return env.get('GOOGLE_REDIRECT_URI', '');
		},
	},

	invite: {
		// seconds — parsed from a compact duration string (default 1 day)
		get ttl() {
			return duration.toSeconds(env.get('INVITE_TOKEN_TTL', '1d'));
		},
	},
});
