import { config } from '@config';
import {
	CONNECTION_STATUS,
	type ConnectionStatus,
} from '@enums/connection-status.enum';
import { log } from '@rniverse/utils';
import { postgres } from './postgres.connection';

const __connections = { postgres };

const status = () => {
	let __status: ConnectionStatus = CONNECTION_STATUS.IDLE;
	return {
		get: () => __status,
		set: (state: ConnectionStatus) => {
			__status = state;
		},
	};
};
const __status = status();

const health = async () => {
	const checks = [{ name: 'postgres', required: true }] as const;
	const healths = await Promise.all(
		checks.map((check) => __connections[check.name].health()),
	);

	const ok = healths.every((h) => h.ok);
	let isInWorkingState = true;
	const services = checks.reduce(
		(acc, service, index) => {
			if (!healths[index].ok) {
				log.error(
					healths[index].error,
					`HEALTH CHECK: ${service.name} connection failed:`,
				);
				if (service.required) isInWorkingState = false;
			}
			acc[service.name] = healths[index];
			return acc;
		},
		{} as Record<
			(typeof checks)[number]['name'],
			{ ok: boolean; error?: unknown }
		>,
	);
	const result = {
		ok,
		services,
		isInWorkingState,
		environment: config.environment,
	};

	if (result.ok) {
		log.info('All connections are healthy');
	} else if (result.isInWorkingState) {
		log.warn(
			result.services,
			'Some connections are unhealthy, but working state is OK:',
		);
	} else {
		log.error(
			result.services,
			'Not in working state, some critical connections are unhealthy',
		);
		process.exit(1);
	}

	return result;
};

const init = async () => {
	__status.set(CONNECTION_STATUS.INITIALIZING);
	await Promise.all([postgres.connect()]).catch((err) => {
		log.error(err, 'Error initializing connections');
		__status.set(CONNECTION_STATUS.ERROR);
		process.exit(1);
	});
	await health();
	__status.set(CONNECTION_STATUS.READY);
};

const close = async () => {
	__status.set(CONNECTION_STATUS.CLOSING);
	await Promise.all([postgres.close()]).catch((err) => {
		log.error(err, 'Error closing connections');
		__status.set(CONNECTION_STATUS.ERROR);
		process.exit(1);
	});
	__status.set(CONNECTION_STATUS.CLOSED);
};

export const connections = {
	init,
	close,
	health,
	status: () => __status.get(),
};

export const pg = () => postgres.getInstance();
// redis() added here later — same shape, one more entry in `checks` above
