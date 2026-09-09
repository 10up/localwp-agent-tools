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

	const mockStatus = {
		id: 'test-site',
		name: 'Test Site',
		domain: 'test.local',
		sitePath: '/tmp/test-site',
		projectDir: '',
		enabled: true,
		agents: ['claude' as const],
		registered: true,
		mcpUrl: 'http://localhost:24842/sites/test-site/mcp',
	};

	const mockLocalApi: LocalApi = {
		startSite: async () => ({ id: 'test', status: 'running' }),
		stopSite: async () => ({ id: 'test', status: 'halted' }),
		restartSite: async () => ({ id: 'test', status: 'running' }),
		getSiteStatus: async () => ({ id: 'test', status: 'running' }),
		listSites: async () => [],
		createSite: async (opts) => ({
			id: 'new-site',
			name: opts.name,
			domain: 'new-site.local',
			path: '/tmp/new-site',
			url: 'http://new-site.local',
			status: 'adding',
			phpVersion: '8.2.29',
			database: 'mysql-8.4.0',
			webServer: 'nginx-1.26.1',
			multisite: 'none' as const,
			wpAdminUsername: 'admin',
			wpAdminPassword: 'admin',
			wpAdminEmail: 'dev@local',
			agentToolsEnabled: false,
			pending: true,
		}),
		listServiceVersions: async () => ({ php: [], database: [], webServer: [], note: '' }),
		enableAgentTools: async () => mockStatus,
		disableAgentTools: async () => ({ ...mockStatus, enabled: false, mcpUrl: null }),
		getAgentToolsStatus: async () => [mockStatus],
	};

	/** Run the MCP handshake against an endpoint and return its session id. */
	async function initSession(path: string): Promise<string> {
		const res = await makeRequest(port, {
			method: 'POST',
			path,
			headers: { Accept: 'application/json, text/event-stream' },
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
		return res.headers['mcp-session-id'] as string;
	}

	/** Send a JSON-RPC request on an established session. */
	async function rpc(path: string, sessionId: string, method: string, params: unknown = {}) {
		const res = await makeRequest(port, {
			method: 'POST',
			path,
			headers: {
				Accept: 'application/json, text/event-stream',
				'mcp-session-id': sessionId,
			},
			body: JSON.stringify({ jsonrpc: '2.0', id: 2, method, params }),
		});
		return JSON.parse(res.body);
	}

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
		expect(body.globalEndpoint).toBe('/sites/mcp');
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

	// ── Global endpoint ─────────────────────────────────────────────────

	describe('global endpoint /sites/mcp', () => {
		it('accepts initialize without any site being registered', async () => {
			const res = await makeRequest(port, {
				method: 'POST',
				path: '/sites/mcp',
				headers: { Accept: 'application/json, text/event-stream' },
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
			expect(res.headers['mcp-session-id']).toBeDefined();
		});

		it('advertises the Local-wide tools but not the site-scoped ones', async () => {
			const sessionId = await initSession('/sites/mcp');
			const body = await rpc('/sites/mcp', sessionId, 'tools/list');
			const names = body.result.tools.map((t: { name: string }) => t.name);

			expect(names).toContain('list_sites');
			expect(names).toContain('create_site');
			expect(names).toContain('enable_agent_tools');
			expect(names).toContain('disable_agent_tools');
			expect(names).toContain('agent_tools_status');

			expect(names).not.toContain('wp_cli');
			expect(names).not.toContain('read_error_log');
			expect(names).not.toContain('get_site_info');
		});

		it('runs a Local-wide tool with no bound site', async () => {
			const sessionId = await initSession('/sites/mcp');
			const body = await rpc('/sites/mcp', sessionId, 'tools/call', {
				name: 'agent_tools_status',
				arguments: {},
			});
			expect(body.result.content[0].text).toContain('test-site');
		});

		it('refuses a site-scoped tool and points at the per-site endpoint', async () => {
			const sessionId = await initSession('/sites/mcp');
			const body = await rpc('/sites/mcp', sessionId, 'tools/call', {
				name: 'wp_cli',
				arguments: { command: 'plugin list' },
			});
			expect(body.result.content[0].text).toContain('not available on the global endpoint');
			expect(body.result.content[0].text).toContain('/sites/{siteId}/mcp');
		});

		it('still serves the full surface on a per-site endpoint', async () => {
			const sessionId = await initSession('/sites/test-site/mcp');
			const body = await rpc('/sites/test-site/mcp', sessionId, 'tools/list');
			const names = body.result.tools.map((t: { name: string }) => t.name);

			expect(names).toContain('wp_cli');
			expect(names).toContain('list_sites');
			expect(names).toContain('enable_agent_tools');
		});

		it('does not shadow a site whose id is literally "mcp"', async () => {
			// /sites/mcp is the global route; a site called "mcp" lives at /sites/mcp/mcp.
			const res = await makeRequest(port, {
				method: 'POST',
				path: '/sites/mcp/mcp',
				body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
			});
			expect(res.statusCode).toBe(404);
			expect(JSON.parse(res.body).error).toContain('Site not registered: mcp');
		});
	});
});
