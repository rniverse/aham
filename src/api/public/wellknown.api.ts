import { utils$token } from '@utils/token.util';
import Elysia from 'elysia';

export const wellknownAPI = new Elysia().get('/.well-known/jwks.json', () =>
	utils$token.jwks(),
);
