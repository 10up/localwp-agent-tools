import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'http';
import { SiteConfigRegistry } from '../src/helpers/site-config';
import { createMcpHttpServer, stopMcpHttpServer } from '../src/mcp-server';
import type { LocalApi } from '../src/tools';
import { getFreePort, makeRequest } from './test-utils';

const TEST_TOKEN = 'mcp-server-test-token';

const AUTH_HEADERS = { Authorization: `Bearer ${TEST_TOKEN}` };

describe('MCP HTTP Server', () => {
	let server: http.Server;
	let port: number;
	const registry = new SiteConfigRegistry();

	const mockLocalApi: LocalApi = {
		startSite: async () => ({ id: 'test', status: 'running' }),
		stopSite: async () => ({ id: 'test', status: 'halted' }),
		restartSite: async () => ({ id: 'test', status: 'running' }),
		getSiteStatus: async () => ({ id: 'test', status: 'running' }),
		listSites: async () => [],
	};

	beforeAll(async () => {
		registry.register({
			siteId: 'test-site',
			sitePath: '/tmp/test-site',
			wpPath: '/tmp/test-site/app/public',
			phpBin: '/usr/bin/php',
			phpIniDir: '/tmp/test-site/conf/php',
			wpCliBin: '/usr/local/bin/wp',
			mysqlBin: '/usr/bin/mysql',
			dbName: 'local',
			dbUser: 'root',
			dbPassword: 'root',
			dbSocket: '/tmp/mysql.sock',
			dbPort: 3306,
			dbHost: 'localhost',
			siteDomain: 'test.local',
			siteUrl: 'http://test.local',
			logPath: '/tmp/test-site/logs',
		});

		// The DNS-rebinding allowlist is scoped to a specific port, so unlike
		// port 0 (OS-assigned), we need to know the port before creating the
		// server — mirroring how main.ts picks a port before listening.
		port = await getFreePort();
		server = createMcpHttpServer({ registry, localApi: mockLocalApi, authToken: TEST_TOKEN, port });
		await new Promise<void>((resolve, reject) => {
			server.once('error', reject);
			server.listen(port, '127.0.0.1', () => resolve());
		});
	});

	afterAll(async () => {
		await stopMcpHttpServer(server);
	});

	it('GET /health returns 200 with status ok', async () => {
		const res = await makeRequest(port, { method: 'GET', path: '/health', headers: AUTH_HEADERS });
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body);
		expect(body.status).toBe('ok');
		expect(body.activeSessions).toBeDefined();
	});

	it('POST /sites/{siteId}/mcp with initialize creates session', async () => {
		const res = await makeRequest(port, {
			method: 'POST',
			path: '/sites/test-site/mcp',
			headers: {
				...AUTH_HEADERS,
				Accept: 'application/json, text/event-stream',
			},
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: {
					protocolVersion: '2025-03-26',
					capabilities: {},
					clientInfo: { name: 'test', version: '1.0' },
				},
			}),
		});
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body);
		expect(body.result).toBeDefined();
		expect(body.result.protocolVersion).toBeDefined();
		expect(body.result.capabilities).toBeDefined();
		expect(res.headers['mcp-session-id']).toBeDefined();
	});

	it('POST with invalid JSON returns parse error -32700', async () => {
		const res = await makeRequest(port, {
			method: 'POST',
			path: '/sites/test-site/mcp',
			headers: AUTH_HEADERS,
			body: '{invalid json',
		});
		expect(res.statusCode).toBe(400);
		const body = JSON.parse(res.body);
		expect(body.error.code).toBe(-32700);
	});

	it('POST to unknown site returns 404', async () => {
		const res = await makeRequest(port, {
			method: 'POST',
			path: '/sites/nonexistent/mcp',
			headers: AUTH_HEADERS,
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
		});
		expect(res.statusCode).toBe(404);
	});

	it('PUT returns 405 method not allowed', async () => {
		const res = await makeRequest(port, {
			method: 'PUT',
			path: '/sites/test-site/mcp',
			headers: AUTH_HEADERS,
			body: '{}',
		});
		expect(res.statusCode).toBe(405);
	});

	it('GET on unknown path returns 404', async () => {
		const res = await makeRequest(port, { method: 'GET', path: '/unknown', headers: AUTH_HEADERS });
		expect(res.statusCode).toBe(404);
	});

	it('POST without session and non-initialize returns 400', async () => {
		const res = await makeRequest(port, {
			method: 'POST',
			path: '/sites/test-site/mcp',
			headers: AUTH_HEADERS,
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
		});
		expect(res.statusCode).toBe(400);
		const body = JSON.parse(res.body);
		expect(body.error.code).toBe(-32000);
	});
});
