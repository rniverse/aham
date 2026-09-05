import { mail } from '@connections';
import { enum$error } from '@enums/errors.enum';
import { AppError } from './error.service';

type SendInput = {
	from: string;
	to: string;
	subject: string;
	html: string;
};

// Resend's send() doesn't throw on API failure — it returns { data, error }.
async function send(input: SendInput) {
	const client = mail();
	const { data, error } = await client.send(input);
	if (error) throw new AppError(enum$error.key.EMAIL_SEND_FAILED);
	return data;
}

export const service$email = { send };
