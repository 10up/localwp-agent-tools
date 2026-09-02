import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'http';
import { randomBytes } from 'crypto';
import { SiteConfigRegistry } from '../src/helpers/site-config';
import { createMcpHttpServer, stopMcpHttpServer } from '../src/mcp-server';
import type { LocalApi } from '../src/tools';
import { getFreePort, makeRequest, makeRawRequest, makeStreamingRequest } from './test-utils';

const TEST_TOKEN = 'auth-test-token-0123456789abcdef';

/**
 * Covers the two CRITICAL fixes in mcp-server.ts:
 *  - per-session bearer-token auth (every request needs `Authorization: Bearer <token>`)
 *  - Host/Origin validation to defeat DNS-rebinding attacks
 */
describe('MCP HTTP Server: bearer auth + DNS-rebinding protection', () => {
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

	it('rejects a request with no Authorization header', async () => {
		const res = await makeRequest(port, { method: 'GET', path: '/health' });
		expect(res.statusCode).toBe(401);
		expect(JSON.parse(res.body)).toEqual({ error: 'Unauthorized' });
	});

	it('rejects a request with the wrong token', async () => {
		const res = await makeRequest(port, {
			method: 'GET',
			path: '/health',
			headers: { Authorization: 'Bearer wrong-token' },
		});
		expect(res.statusCode).toBe(401);
		expect(JSON.parse(res.body)).toEqual({ error: 'Unauthorized' });
	});

	it('rejects a same-length but different token (exercises the timingSafeEqual false branch)', async () => {
		// A length-mismatched wrong token (the case above) short-circuits on the
		// length guard before timingSafeEqual ever runs. This one matches
		// TEST_TOKEN's length exactly with different bytes, so it's the only
		// case that actually reaches — and must fail — the constant-time compare.
		let wrongToken = randomBytes(Math.ceil(TEST_TOKEN.length / 2))
			.toString('hex')
			.slice(0, TEST_TOKEN.length);
		if (wrongToken === TEST_TOKEN) wrongToken = wrongToken.slice(0, -1) + (wrongToken.at(-1) === '0' ? '1' : '0');

		expect(wrongToken.length).toBe(TEST_TOKEN.length);
		expect(wrongToken).not.toBe(TEST_TOKEN);

		const res = await makeRequest(port, {
			method: 'GET',
			path: '/health',
			headers: { Authorization: `Bearer ${wrongToken}` },
		});
		expect(res.statusCode).toBe(401);
		expect(JSON.parse(res.body)).toEqual({ error: 'Unauthorized' });
	});

	it('rejects an Authorization header missing the "Bearer " prefix', async () => {
		const res = await makeRequest(port, {
			method: 'GET',
			path: '/health',
			headers: { Authorization: TEST_TOKEN },
		});
		expect(res.statusCode).toBe(401);
	});

	it('rejects a correct token paired with a forged Host header', async () => {
		const res = await makeRequest(port, {
			method: 'GET',
			path: '/health',
			headers: { Authorization: `Bearer ${TEST_TOKEN}`, Host: 'evil.com' },
		});
		expect(res.statusCode).toBe(403);
		expect(JSON.parse(res.body)).toEqual({ error: 'Forbidden host' });
	});

	it('rejects a correct token + allowed Host paired with a forged Origin header', async () => {
		const res = await makeRequest(port, {
			method: 'GET',
			path: '/health',
			headers: { Authorization: `Bearer ${TEST_TOKEN}`, Origin: 'http://evil.com' },
		});
		expect(res.statusCode).toBe(403);
		expect(JSON.parse(res.body)).toEqual({ error: 'Forbidden host' });
	});

	it('rejects a request with no Host header at all', async () => {
		// HTTP/1.1 requires a Host header, so Node's own server-side parser
		// rejects an HTTP/1.1 request without one at the protocol level before
		// it ever reaches our handler. HTTP/1.0 has no such requirement, so a
		// raw HTTP/1.0 request is the only way to reach our own missing-Host
		// branch of isAllowedHost.
		const res = await makeRawRequest(port, {
			method: 'GET',
			path: '/health',
			headers: { Authorization: `Bearer ${TEST_TOKEN}` },
		});
		expect(res.statusCode).toBe(403);
		expect(JSON.parse(res.body)).toEqual({ error: 'Forbidden host' });
	});

	it('rejects a Host header with a spoofed subdomain suffix (127.0.0.1.evil.com)', async () => {
		const res = await makeRequest(port, {
			method: 'GET',
			path: '/health',
			headers: { Authorization: `Bearer ${TEST_TOKEN}`, Host: '127.0.0.1.evil.com' },
		});
		expect(res.statusCode).toBe(403);
		expect(JSON.parse(res.body)).toEqual({ error: 'Forbidden host' });
	});

	it('rejects a Host header smuggling userinfo (evil.com@localhost)', async () => {
		const res = await makeRequest(port, {
			method: 'GET',
			path: '/health',
			headers: { Authorization: `Bearer ${TEST_TOKEN}`, Host: 'evil.com@localhost' },
		});
		expect(res.statusCode).toBe(403);
		expect(JSON.parse(res.body)).toEqual({ error: 'Forbidden host' });
	});

	it('allows a correct token + allowed host through to routing', async () => {
		const res = await makeRequest(port, {
			method: 'GET',
			path: '/health',
			headers: { Authorization: `Bearer ${TEST_TOKEN}` },
		});
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body);
		expect(body.status).toBe('ok');
		expect(body.sites).toBeUndefined(); // no siteId enumeration
		expect(body.activeSessions).toBe(0);
	});

	it('allows a correct token + explicit allowed Origin through to routing', async () => {
		const res = await makeRequest(port, {
			method: 'GET',
			path: '/health',
			headers: { Authorization: `Bearer ${TEST_TOKEN}`, Origin: `http://127.0.0.1:${port}` },
		});
		expect(res.statusCode).toBe(200);
	});

	// Some MCP clients (Cursor, Windsurf, VS Code Copilot) don't reliably
	// forward a configured Authorization header on every request. The
	// query-parameter token is a fallback channel carrying the same secret,
	// so those clients still authenticate.
	describe('query-parameter token fallback (no Authorization header)', () => {
		it('authorizes a request with no Authorization header but a correct ?token= query parameter', async () => {
			const res = await makeRequest(port, {
				method: 'GET',
				path: `/health?token=${TEST_TOKEN}`,
			});
			expect(res.statusCode).toBe(200);
			const body = JSON.parse(res.body);
			expect(body.status).toBe('ok');
		});

		it('rejects a same-length but wrong ?token= query parameter (exercises the query path’s timingSafeEqual false branch)', async () => {
			// Same construction as the header-based equivalent above: a
			// length-mismatched wrong token would short-circuit on the length
			// guard before timingSafeEqual runs, so this matches TEST_TOKEN's
			// length exactly with different bytes.
			let wrongToken = randomBytes(Math.ceil(TEST_TOKEN.length / 2))
				.toString('hex')
				.slice(0, TEST_TOKEN.length);
			if (wrongToken === TEST_TOKEN)
				wrongToken = wrongToken.slice(0, -1) + (wrongToken.at(-1) === '0' ? '1' : '0');

			expect(wrongToken.length).toBe(TEST_TOKEN.length);
			expect(wrongToken).not.toBe(TEST_TOKEN);

			const res = await makeRequest(port, {
				method: 'GET',
				path: `/health?token=${wrongToken}`,
			});
			expect(res.statusCode).toBe(401);
			expect(JSON.parse(res.body)).toEqual({ error: 'Unauthorized' });
		});

		it('still rejects a forged Host header even with a correct ?token= query parameter', async () => {
			// The Host/Origin check must run regardless of which channel
			// carried a valid token — the query token must never bypass it.
			const res = await makeRequest(port, {
				method: 'GET',
				path: `/health?token=${TEST_TOKEN}`,
				headers: { Host: 'evil.com' },
			});
			expect(res.statusCode).toBe(403);
			expect(JSON.parse(res.body)).toEqual({ error: 'Forbidden host' });
		});
	});

	it('completes a real MCP initialize handshake with the port-scoped allowlist wired in', async () => {
		const res = await makeRequest(port, {
			method: 'POST',
			path: '/sites/test-site/mcp',
			headers: {
				Authorization: `Bearer ${TEST_TOKEN}`,
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
		expect(res.headers['mcp-session-id']).toBeDefined();
	});

	describe('established session — every method still requires Authorization', () => {
		let sessionId: string;

		beforeAll(async () => {
			const res = await makeRequest(port, {
				method: 'POST',
				path: '/sites/test-site/mcp',
				headers: {
					Authorization: `Bearer ${TEST_TOKEN}`,
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
			sessionId = res.headers['mcp-session-id'] as string;
			expect(sessionId).toBeDefined();
		});

		// Auth is checked before session/method routing, so a request missing
		// Authorization must 401 even when it names a real, live session ID —
		// an established session must never become a way to skip the auth gate.
		it('rejects a POST to an established session with no Authorization header', async () => {
			const res = await makeRequest(port, {
				method: 'POST',
				path: '/sites/test-site/mcp',
				headers: { 'mcp-session-id': sessionId },
				body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
			});
			expect(res.statusCode).toBe(401);
		});

		it('rejects a GET (SSE stream) on an established session with no Authorization header', async () => {
			const res = await makeRequest(port, {
				method: 'GET',
				path: '/sites/test-site/mcp',
				headers: { 'mcp-session-id': sessionId },
			});
			expect(res.statusCode).toBe(401);
		});

		// The scenario this whole fix targets: some MCP clients open the SSE
		// GET stream without re-sending the Authorization header. With no
		// header at all, the ?token= query parameter must still authorize the
		// stream and let it reach the SDK's session routing (200, not 401).
		it('authorizes the SSE GET stream via ?token= query parameter with no Authorization header', async () => {
			const res = await makeStreamingRequest(port, {
				method: 'GET',
				path: `/sites/test-site/mcp?token=${TEST_TOKEN}`,
				headers: { 'mcp-session-id': sessionId, Accept: 'application/json, text/event-stream' },
			});
			expect(res.statusCode).toBe(200);
			expect(res.headers['content-type']).toContain('text/event-stream');
		});

		it('rejects a DELETE on an established session with no Authorization header', async () => {
			const res = await makeRequest(port, {
				method: 'DELETE',
				path: '/sites/test-site/mcp',
				headers: { 'mcp-session-id': sessionId },
			});
			expect(res.statusCode).toBe(401);
		});
	});
});
