import { enum$error } from '@enums/errors.enum';
import { AppError } from '@services/error.service';
import { utils$token } from '@utils/token.util';

type ProviderConfig = {
	url: {
		authorize: string;
		token: string;
		userinfo: string;
		redirect: string;
	};
	client: {
		id: string;
		secret: string;
	};
	scope: string;
	mapper: {
		profile: (raw: any) => {
			providerAccountId: string;
			email: string;
			emailVerified: boolean;
			name?: string;
			avatar?: string;
		};
	};
};

function createProvider(providerConfig: ProviderConfig) {
	const start = () => {
		const state = utils$token.random(16);
		const url = new URL(providerConfig.url.authorize);
		url.searchParams.set('client_id', providerConfig.client.id);
		url.searchParams.set('redirect_uri', providerConfig.url.redirect);
		url.searchParams.set('scope', providerConfig.scope);
		url.searchParams.set('response_type', 'code');
		url.searchParams.set('state', state);
		return { url: url.toString(), state };
	};

	const exchange = async (code: string) => {
		const response = await fetch(providerConfig.url.token, {
			method: 'POST',
			headers: {
				'content-type': 'application/x-www-form-urlencoded',
				accept: 'application/json',
			},
			body: new URLSearchParams({
				client_id: providerConfig.client.id,
				client_secret: providerConfig.client.secret,
				redirect_uri: providerConfig.url.redirect,
				grant_type: 'authorization_code',
				code,
			}),
		});
		if (!response.ok)
			throw new AppError(enum$error.key.OAUTH_TOKEN_EXCHANGE_FAILED);
		return response.json();
	};

	const profile = async (accessToken: string) => {
		const response = await fetch(providerConfig.url.userinfo, {
			headers: { authorization: `Bearer ${accessToken}` },
		});
		if (!response.ok)
			throw new AppError(enum$error.key.OAUTH_PROFILE_FETCH_FAILED);
		const raw = await response.json();
		return providerConfig.mapper.profile(raw);
	};

	const callback = async (code: string) => {
		const token = await exchange(code);
		return profile(token.access_token);
	};

	return { start, exchange, profile, callback };
}

export const oauth$base = { create: createProvider };
