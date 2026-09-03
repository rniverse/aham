import { config } from '@config';
import { SQLConnector } from '@rniverse/connectors';

export const postgres = new SQLConnector({ url: config.database.url });
