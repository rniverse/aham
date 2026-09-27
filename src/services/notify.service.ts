import { http } from '@connections';
import { AppError, enum$error } from '@enums/errors.enum';
import { log } from '@rniverse/utils';

type SendInput = {
	to: string;
	subject: string;
	html: string;
};

type SendResponse = { ok: boolean; data: { status: string; id: string } };

/**
 * Email goes through notify's own send pipeline (retries, delivery
 * tracking) instead of aham talking to Resend directly — aham has no
 * email provider of its own. notify throws on a sync send that fails
 * (non-2xx). Any failure here — HTTP-level or notify unreachable — maps
 * to the same typed error; the caller only needs yes/no.
 *
 * Catch-all, not `instanceof HttpError`: `shared`'s `@rniverse/utils`/
 * `@rniverse/connectors` peerDependencies do make cross-package
 * `instanceof` work correctly now (verified), so narrowing to HttpError
 * specifically would work here — kept broad anyway to match the original
 * Resend-based implementation's behavior (any failure -> EMAIL_SEND_FAILED).
 */
async function send(input: SendInput) {
	const client = http().get('notify');
	if (!client) {
		log.error("notify.send: failed — no http client registered for 'notify'");
		throw new AppError(enum$error.key.EMAIL_SEND_FAILED);
	}
	try {
		const response = await client.post<SendResponse>(
			'/api/notification/send/sync',
			{
				body: {
					channel: 'email',
					payload: { to: [input.to], subject: input.subject, html: input.html },
				},
			},
		);
		return response.data;
	} catch (err) {
		log.error(err, 'notify.send: failed');
		throw new AppError(enum$error.key.EMAIL_SEND_FAILED);
	}
}

export const service$notify = { send };
