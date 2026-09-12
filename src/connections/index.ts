import { config } from '@config';
import { createRegistry } from '@rniverse/shared/registry';
import { postgres } from './postgres.connection';

const registry = createRegistry({
	connections: [{ name: 'postgres', connector: postgres, required: true }],
	http: [{ name: 'notify', baseURL: config.services.notify.url }],
});

export const connections = registry.connections;
export const http = registry.http;

export const pg = () => postgres.getInstance();
