import { guard } from '@middlewares/auth.middleware';
import Elysia from 'elysia';
import { authAPI } from './auth.api';
import { userAPI } from './user.api';

export const protectedAPI = new Elysia()
	.use(guard.base)
	.use(authAPI)
	.use(userAPI);
