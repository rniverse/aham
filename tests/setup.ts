// Preloaded by bunfig.toml for every test file. Opens connections once and
// clears the database before each test.
import { afterAll, beforeEach, spyOn } from 'bun:test';
import { connections } from '@connections';
import { service$notify } from '@services';
import { getApp, resetDb } from './utils';

// Never hit the real notify service from a test run — callers that need to
// assert on the payload can re-spy this in an individual test.
spyOn(service$notify, 'send').mockResolvedValue({
	status: 'sent',
	id: 'test-email-id',
});

beforeEach(async () => {
	await getApp();
	await resetDb();
});

afterAll(async () => {
	await connections().close();
});
