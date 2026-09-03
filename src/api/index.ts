import { config } from '@config';
import { cors } from '@elysiajs/cors';
import Elysia from 'elysia';
import { protectedAPI } from './protected';
import { publicAPI } from './public';

export const createAPI = async () => {
	const allowAll = config.cors.origins.includes('*');

	const api = new Elysia({ prefix: '/api' })
		.use(
			cors({
				origin: allowAll ? true : config.cors.origins,
				credentials: true,
				allowedHeaders: ['content-type', 'authorization'],
			}),
		)
		.use(publicAPI)
		.use(protectedAPI);

	return api;
};
