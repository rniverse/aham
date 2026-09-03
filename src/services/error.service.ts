import { type ErrorKey, enum$error } from '@enums/errors.enum';

export class AppError extends Error {
	key: ErrorKey;
	code: string = '000000';
	status_code: number = 400;
	details?: Record<string, unknown>;

	constructor(key: ErrorKey, details?: Record<string, unknown>) {
		super(enum$error.messages[key]);
		this.name = 'AppError';
		this.key = key;
		this.code = enum$error.codes[key];
		this.status_code =
			(details?.status_code as number) ?? enum$error.status[key] ?? 400;
		this.details = details;
	}
}
