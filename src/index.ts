import { createAPI } from '@api';
import { wellknownAPI } from '@api/public/wellknown.api';
import { config } from '@config';
import { connections } from '@connections';
import { openapi } from '@elysiajs/openapi';
import { enum$error } from '@enums/errors.enum';
import { logger } from '@middlewares/log.middleware';
import { log, runWithContext } from '@rniverse/utils';
import { AppError } from '@services';
import { toJsonSchema } from '@valibot/to-json-schema';
import Elysia from 'elysia';

export const init = async () => {
	await connections.init();

	const api = await createAPI();

	const app = new Elysia({ strictPath: true })
		.use(logger())
		.error({ AppError })
		.onError(({ error, code, set }) => {
			if (error instanceof AppError) {
				set.status = error.status_code;
				return {
					ok: false,
					error: { code: error.code, message: error.message },
				};
			}
			if (code === 'VALIDATION') {
				set.status = enum$error.status.VALIDATION_FAILED;
				return {
					ok: false,
					error: {
						code: enum$error.codes.VALIDATION_FAILED,
						message: enum$error.messages.VALIDATION_FAILED,
					},
				};
			}
			if (code === 'NOT_FOUND') {
				set.status = enum$error.status.NOT_FOUND;
				return {
					ok: false,
					error: {
						code: enum$error.codes.NOT_FOUND,
						message: enum$error.messages.NOT_FOUND,
					},
				};
			}
			log.error(error, 'Unhandled error');
			set.status = enum$error.status.INTERNAL_ERROR;
			return {
				ok: false,
				error: {
					code: enum$error.codes.INTERNAL_ERROR,
					message: enum$error.messages.INTERNAL_ERROR,
				},
			};
		})
		.use(
			openapi({
				mapJsonSchema: {
					// `errorMode: 'ignore'` — transforms like toLowerCase() have no
					// JSON Schema equivalent; skip them silently in the docs schema
					// instead of logging a warning per request. Runtime validation
					// (and the transform itself) is unaffected.
					valibot: (schema: Parameters<typeof toJsonSchema>[0]) =>
						toJsonSchema(schema, { errorMode: 'ignore' }),
				},
			}),
		)
		.use(wellknownAPI) // mounted at root — /.well-known/jwks.json, not under /api
		.use(api);
	return app;
};

export const listen = (app: any) => {
	app.listen(config.server.port);
	log.info(`Elysia is running at ${app.server?.hostname}:${app.server?.port}`);
};

const unknownErrorListener = async (e: Error) => {
	log.error(e, 'Server shutting down due to a critical error');
	await connections.close();
	process.exit(1);
};

const shutdown = async (signal: string) => {
	log.info(`Received ${signal}, starting clean shutdown...`);
	try {
		await connections.close();
		log.info('Clean shutdown completed successfully');
		process.exit(0);
	} catch (err) {
		log.error(err, 'Error during clean shutdown');
		process.exit(1);
	}
};

// Only bootstrap a real server when run directly (`bun run src/index.ts`).
// When imported (e.g. from tests) this block is skipped — callers use `init()`
// to get the app and drive it with `app.handle()`.
if (import.meta.main) {
	runWithContext(async () => init().then(listen), {
		requestId: 'SERVER_LOG',
	}).catch(unknownErrorListener);

	process.on('uncaughtException', unknownErrorListener);
	process.on('unhandledRejection', unknownErrorListener);
	process.on('SIGINT', () => shutdown('SIGINT'));
	process.on('SIGTERM', () => shutdown('SIGTERM'));
}
