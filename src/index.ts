import { createAPI } from '@api';
import { wellknownAPI } from '@api/public/wellknown.api';
import { config } from '@config';
import { connections } from '@connections';
import { BOOTSTRAP_ERRORS } from '@enums/errors.enum';
import { boot, createApp, listen } from '@rniverse/shared/bootstrap';
import Elysia from 'elysia';

export const init = async () => {
	await connections().init();

	// wellknownAPI is mounted at root — /.well-known/jwks.json, not under
	// /api — so it's composed into the plugin handed to createApp() rather
	// than needing its own parameter there.
	const api = new Elysia().use(wellknownAPI).use(await createAPI());
	return createApp({ api, errors: BOOTSTRAP_ERRORS });
};

export { listen };

// Only bootstrap a real server when run directly (`bun run src/index.ts`).
// When imported (e.g. from tests) this block is skipped — callers use `init()`
// to get the app and drive it with `app.handle()`.
if (import.meta.main) {
	boot(init, config.server, () => connections().close());
}
