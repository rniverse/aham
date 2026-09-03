import Elysia from 'elysia';
import { authAPI } from './auth.api';
import { healthAPI } from './health.api';
import { oauthAPI } from './oauth.api';
import { sessionAPI } from './session.api';

// wellknownAPI is deliberately NOT mounted here — /.well-known/jwks.json must
// live at the domain root per spec, not nested under this /api-prefixed
// router. It's mounted directly on the root app in src/index.ts instead.
export const publicAPI = new Elysia()
	.use(healthAPI)
	.use(authAPI)
	.use(oauthAPI)
	.use(sessionAPI);
