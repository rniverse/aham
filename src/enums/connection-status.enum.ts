export const CONNECTION_STATUS = {
	IDLE: 'IDLE',
	INITIALIZING: 'INITIALIZING',
	READY: 'READY',
	ERROR: 'ERROR',
	CLOSING: 'CLOSING',
	CLOSED: 'CLOSED',
} as const;

export type ConnectionStatus =
	(typeof CONNECTION_STATUS)[keyof typeof CONNECTION_STATUS];
