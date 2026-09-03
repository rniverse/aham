import { config } from '@config';
import { oauth$base } from './base.service';

export const service$oauth$google = oauth$base.create({
	url: {
		authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
		token: 'https://oauth2.googleapis.com/token',
		userinfo: 'https://www.googleapis.com/oauth2/v3/userinfo',
		redirect: config.google.redirectURI,
	},
	client: {
		id: config.google.clientId,
		secret: config.google.clientSecret,
	},
	scope: 'openid email profile',
	mapper: {
		profile: (raw) => ({
			providerAccountId: raw.sub,
			email: raw.email,
			emailVerified: raw.email_verified === true,
			name: raw.name,
			avatar: raw.picture,
		}),
	},
});
