import { enum$error } from '@enums/errors.enum';
import { schema$user } from '@schema/api/user.schema';
import { AppError, service$user } from '@services';
import { ok, sanitize } from '@utils';
import Elysia from 'elysia';

export const userAPI = new Elysia({ prefix: '/user' })
	.get('/me', async ({ user }) => {
		const record = await service$user.find({ id: user.sub });
		if (!record) throw new AppError(enum$error.key.NOT_FOUND);
		return ok(sanitize(record));
	})
	.post(
		'/change/username',
		async ({ body, user }) => {
			const _user = await service$user.change.username(user.sub, body.username);
			return ok(sanitize(_user));
		},
		{ body: schema$user.username.change },
	);
