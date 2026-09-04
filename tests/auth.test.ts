import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'http';
import { randomBytes } from 'crypto';
import { SiteConfigRegistry } from '../src/helpers/site-config';
import { createMcpHttpServer, stopMcpHttpServer } from '../src/mcp-server';
import type { LocalApi } from '../src/tools';
import { getFreePort, makeRequest, makeRawRequest, makeStreamingRequest } from './test-utils';

const TEST_TOKEN = 'auth-test-token-0123456789abcdef';

const AUTH_HEADERS = { Authorization: `Bearer ${TEST_TOKEN}` };

/** The exact 401 body the server returns — the hint tells the user how to recover. */
const UNAUTHORIZED_BODY = {
	error: 'Unauthorized',
	hint: 'Regenerate config from the Agent Tools panel in Local',
};

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
		expect(JSON.parse(res.body)).toEqual(UNAUTHORIZED_BODY);
	});

	it('carries WWW-Authenticate, Cache-Control: no-store, and a recovery hint on a 401', async () => {
		const res = await makeRequest(port, { method: 'GET', path: '/health' });
		expect(res.statusCode).toBe(401);
		expect(res.headers['www-authenticate']).toBe('Bearer realm="Agent Tools"');
		expect(res.headers['cache-control']).toBe('no-store');
		expect(JSON.parse(res.body)).toEqual(UNAUTHORIZED_BODY);
	});

	// `GET http://evil.com:999999/health HTTP/1.1` is a legal absolute-form
	// request target (RFC 7230 §5.3.2) that `new URL()` cannot parse — the port
	// is out of range, so the parse throws ERR_INVALID_URL. The auth gate must
	// never touch `req.url`, so this has to come back as a clean 401 rather
	// than a thrown pre-auth error that leaves the socket hanging.
	it('returns 401 for an absolute-form request target instead of crashing pre-auth', async () => {
		const res = await makeRawRequest(port, {
			method: 'GET',
			path: 'http://evil.com:999999/health',
			version: '1.1',
			headers: { Host: `127.0.0.1:${port}`, Connection: 'close' },
		});
		expect(res.statusCode).toBe(401);
		expect(res.headers['www-authenticate']).toBe('Bearer realm="Agent Tools"');
		// The HTTP/1.1 response is chunked, so the raw body still carries chunk
		// framing — match on the hint text rather than parsing it as JSON.
		expect(res.body).toContain(UNAUTHORIZED_BODY.hint);
	});

	// The auth gate is the first statement in the handler, so it must fire
	// before routing, before the 404 branch, and before the 405 branch — no
	// method/path pair may reach a route without the token.
	describe('no method on any path is reachable without the token', () => {
		const methods = ['GET', 'POST', 'DELETE', 'PUT', 'OPTIONS', 'HEAD'];
		const paths = ['/health', '/sites/test-site/mcp', '/sites/unknown/mcp', '/nope'];

		for (const method of methods) {
			for (const path of paths) {
				it(`${method} ${path} returns 401 with no Authorization header`, async () => {
					const res = await makeRequest(port, { method, path });
					expect(res.statusCode).toBe(401);
					expect(res.headers['www-authenticate']).toBe('Bearer realm="Agent Tools"');
				});
			}
		}
	});

	it('rejects a request with the wrong token', async () => {
		const res = await makeRequest(port, {
			method: 'GET',
			path: '/health',
			headers: { Authorization: 'Bearer wrong-token' },
		});
		expect(res.statusCode).toBe(401);
		expect(JSON.parse(res.body)).toEqual(UNAUTHORIZED_BODY);
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
		expect(JSON.parse(res.body)).toEqual(UNAUTHORIZED_BODY);
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
			headers: { ...AUTH_HEADERS, Host: 'evil.com' },
		});
		expect(res.statusCode).toBe(403);
		expect(res.headers['cache-control']).toBe('no-store');
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

		// The header is the only auth channel, so it has to work on the SSE
		// GET stream too — that stream is what the removed ?token= fallback
		// existed to serve. With the header present it reaches the SDK's
		// session routing (200, not 401).
		it('authorizes the SSE GET stream with the Authorization header', async () => {
			const res = await makeStreamingRequest(port, {
				method: 'GET',
				path: '/sites/test-site/mcp',
				headers: {
					...AUTH_HEADERS,
					'mcp-session-id': sessionId,
					Accept: 'application/json, text/event-stream',
				},
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

	// Both rebinding layers — our own Host/Origin gate and the SDK's
	// `allowedHosts`/`allowedOrigins` on the transport — have to accept and
	// reject the same set. They do the same exact compare against the same two
	// lists, so agreement should be automatic; every row proves it by running
	// against a route that never touches the transport (`/health`) and a route
	// that goes all the way through it (an MCP `initialize`).
	describe('Host/Origin policy is identical on every route', () => {
		type Row = [label: string, expected: number, headers: (p: number) => Record<string, string>];

		const rows: Row[] = [
			['Host: localhost:{port}', 200, (p) => ({ Host: `localhost:${p}` })],
			['Host: LOCALHOST:{port} (case must match)', 403, (p) => ({ Host: `LOCALHOST:${p}` })],
			['Host: localhost.:{port} (trailing dot rejected)', 403, (p) => ({ Host: `localhost.:${p}` })],
			['Host: 127.0.0.1:{port}', 200, (p) => ({ Host: `127.0.0.1:${p}` })],
			['Host: localhost (no port)', 403, () => ({ Host: 'localhost' })],
			['Host: 127.0.0.1:1 (wrong port)', 403, () => ({ Host: '127.0.0.1:1' })],
			['Host: 127.0.0.1.evil.com:{port}', 403, (p) => ({ Host: `127.0.0.1.evil.com:${p}` })],
			['Host: evil.com@localhost:{port}', 403, (p) => ({ Host: `evil.com@localhost:${p}` })],
			['Origin: null', 403, () => ({ Origin: 'null' })],
			['Origin: http://evil.com', 403, () => ({ Origin: 'http://evil.com' })],
			// `Origin:` with an empty value is a header the client chose to
			// send, not the absent header on the row below — a truthiness check
			// on the header value would wave it through.
			['Origin: (present but empty)', 403, () => ({ Origin: '' })],
			['no Origin header', 200, () => ({})],
			['Origin: http://127.0.0.1:9999 (wrong port)', 403, () => ({ Origin: 'http://127.0.0.1:9999' })],
			[
				'Origin: https://localhost:{port} (scheme must match)',
				403,
				(p) => ({
					Origin: `https://localhost:${p}`,
				}),
			],
			['Origin: http://localhost:{port}', 200, (p) => ({ Origin: `http://localhost:${p}` })],
		];

		function initializeBody() {
			return JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: {
					protocolVersion: '2025-03-26',
					capabilities: {},
					clientInfo: { name: 'test', version: '1.0' },
				},
			});
		}

		it.each(rows)('%s → %d on /health and on the MCP route', async (_label, expected, buildHeaders) => {
			const rowHeaders = buildHeaders(port);

			const health = await makeRequest(port, {
				method: 'GET',
				path: '/health',
				headers: { ...AUTH_HEADERS, ...rowHeaders },
			});

			const mcp = await makeRequest(port, {
				method: 'POST',
				path: '/sites/test-site/mcp',
				headers: {
					...AUTH_HEADERS,
					Accept: 'application/json, text/event-stream',
					...rowHeaders,
				},
				body: initializeBody(),
			});

			expect(health.statusCode).toBe(expected);
			expect(mcp.statusCode).toBe(health.statusCode);

			if (expected === 200) {
				// A 200 on the MCP route only counts if the handshake actually
				// completed — the transport's own check has to have passed too.
				expect(mcp.headers['mcp-session-id']).toBeDefined();
			} else {
				expect(JSON.parse(health.body)).toEqual({ error: 'Forbidden host' });
				expect(health.headers['cache-control']).toBe('no-store');
			}
		});

		// `http.request` always emits a Host header for HTTP/1.1 and Node's
		// server-side parser rejects an HTTP/1.1 request without one before our
		// handler runs, so the missing-Host row needs a raw HTTP/1.0 request.
		// The gate rejects before any body is read, so no body is needed.
		it('missing Host header → 403 on /health and on the MCP route', async () => {
			const health = await makeRawRequest(port, {
				method: 'GET',
				path: '/health',
				headers: AUTH_HEADERS,
			});
			const mcp = await makeRawRequest(port, {
				method: 'POST',
				path: '/sites/test-site/mcp',
				headers: AUTH_HEADERS,
			});

			expect(health.statusCode).toBe(403);
			expect(mcp.statusCode).toBe(403);
		});
	});
});
