import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'http';
import { SiteConfigRegistry } from '../src/helpers/site-config';
import { createMcpHttpServer, stopMcpHttpServer } from '../src/mcp-server';
import type { LocalApi } from '../src/tools';

function makeRequest(
	port: number,
	options: { method: string; path: string; headers?: Record<string, string>; body?: string },
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
	return new Promise((resolve, reject) => {
		const req = http.request(
			{
				hostname: '127.0.0.1',
				port,
				path: options.path,
				method: options.method,
				headers: {
					'Content-Type': 'application/json',
					...options.headers,
				},
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on('data', (chunk: Buffer) => chunks.push(chunk));
				res.on('end', () => {
					resolve({
						statusCode: res.statusCode || 0,
						headers: res.headers,
						body: Buffer.concat(chunks).toString('utf-8'),
					});
				});
			},
		);
		req.on('error', reject);
		if (options.body) {
			req.write(options.body);
		}
		req.end();
	});
}

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

		server = createMcpHttpServer({ registry, localApi: mockLocalApi });
		// Use port 0 to let the OS assign a random available port
		await new Promise<void>((resolve, reject) => {
			server.once('error', reject);
			server.listen(0, '127.0.0.1', () => {
				const addr = server.address();
				port = typeof addr === 'object' && addr ? addr.port : 0;
				resolve();
			});
		});
	});

	afterAll(async () => {
		await stopMcpHttpServer(server);
	});

	it('GET /health returns 200 with status ok', async () => {
		const res = await makeRequest(port, { method: 'GET', path: '/health' });
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body);
		expect(body.status).toBe('ok');
		expect(body.sites).toContain('test-site');
	});

	it('POST /sites/{siteId}/mcp with initialize creates session', async () => {
		const res = await makeRequest(port, {
			method: 'POST',
			path: '/sites/test-site/mcp',
			headers: {
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
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
		});
		expect(res.statusCode).toBe(404);
	});

	it('PUT returns 405 method not allowed', async () => {
		const res = await makeRequest(port, {
			method: 'PUT',
			path: '/sites/test-site/mcp',
			body: '{}',
		});
		expect(res.statusCode).toBe(405);
	});

	it('GET on unknown path returns 404', async () => {
		const res = await makeRequest(port, { method: 'GET', path: '/unknown' });
		expect(res.statusCode).toBe(404);
	});

	it('POST without session and non-initialize returns 400', async () => {
		const res = await makeRequest(port, {
			method: 'POST',
			path: '/sites/test-site/mcp',
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
		});
		expect(res.statusCode).toBe(400);
		const body = JSON.parse(res.body);
		expect(body.error.code).toBe(-32000);
	});
});
