import * as http from 'http';
import { randomUUID, timingSafeEqual } from 'crypto';
import { SiteConfigRegistry } from './helpers/site-config';
import { allToolDefinitions, handleToolCall, LocalApi } from './tools';

// ---------------------------------------------------------------------------
// MCP SDK — loaded via require() for CJS compatibility.
// The SDK ships CJS builds and exports them via package.json "exports" map.
// Node.js resolves these correctly at runtime; we use require() to bypass
// TypeScript's "node" moduleResolution which doesn't read exports maps.
// ---------------------------------------------------------------------------

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

// ---------------------------------------------------------------------------
// MCP SDK Type Aliases
// TODO: Replace with proper types when the MCP SDK ships TypeScript declarations
// ---------------------------------------------------------------------------

/** Transport instance from @modelcontextprotocol/sdk */
type McpTransport = any;
/** Server instance from @modelcontextprotocol/sdk */
type McpServer = any;
/** Request object from MCP SDK request handlers */
type McpRequest = any;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SessionEntry {
	transport: McpTransport;
	server: McpServer;
	siteId: string;
	lastActivity: number;
}

interface McpHttpServerOptions {
	registry: SiteConfigRegistry;
	localApi: LocalApi;
	/** Per-install bearer token; every request must present `Authorization: Bearer <authToken>`. */
	authToken: string;
	/** Port the server is bound to — used to scope DNS-rebinding allowlists to this instance. */
	port: number;
}

// ---------------------------------------------------------------------------
// Session Management
// ---------------------------------------------------------------------------

const MAX_BODY_SIZE = 1 * 1024 * 1024; // 1 MB

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

const sessions = new Map<string, SessionEntry>();
let cleanupInterval: NodeJS.Timeout | null = null;

function startSessionCleanup(): void {
	if (cleanupInterval) return;
	cleanupInterval = setInterval(() => {
		const now = Date.now();
		for (const [sessionId, entry] of sessions) {
			if (now - entry.lastActivity > SESSION_TIMEOUT_MS) {
				console.log(`[Agent Tools] Closing inactive MCP session ${sessionId}`);
				try {
					entry.transport.close();
				} catch {
					/* intentionally empty */
				}
				try {
					entry.server.close();
				} catch {
					/* intentionally empty */
				}
				sessions.delete(sessionId);
			}
		}
	}, 60_000); // Check every minute
}

function stopSessionCleanup(): void {
	if (cleanupInterval) {
		clearInterval(cleanupInterval);
		cleanupInterval = null;
	}
}

/**
 * Close all MCP sessions associated with a specific site.
 * Called when a site is stopped or unregistered.
 */
export function closeSessionsForSite(siteId: string): void {
	for (const [sessionId, entry] of sessions) {
		if (entry.siteId === siteId) {
			console.log(`[Agent Tools] Closing MCP session ${sessionId} for site ${siteId}`);
			try {
				entry.transport.close();
			} catch {
				/* intentionally empty */
			}
			try {
				entry.server.close();
			} catch {
				/* intentionally empty */
			}
			sessions.delete(sessionId);
		}
	}
}

function closeAllSessions(): void {
	for (const [sessionId, entry] of sessions) {
		try {
			entry.transport.close();
		} catch {
			/* intentionally empty */
		}
		try {
			entry.server.close();
		} catch {
			/* intentionally empty */
		}
	}
	sessions.clear();
}

// ---------------------------------------------------------------------------
// MCP Server Factory — creates a Server instance for a specific site
// ---------------------------------------------------------------------------

function createMcpServer(siteId: string, registry: SiteConfigRegistry, localApi: LocalApi): McpServer {
	const server = new Server({ name: 'local-wp', version: '1.0.0' }, { capabilities: { tools: {} } });

	server.setRequestHandler(ListToolsRequestSchema, async () => {
		return { tools: allToolDefinitions };
	});

	server.setRequestHandler(CallToolRequestSchema, async (request: McpRequest) => {
		const { name, arguments: args } = request.params;
		console.log(`[Agent Tools] Tool called: ${name} (site: ${siteId})`);

		// Look up config fresh on every call so we always use the latest
		// (e.g., after site start updates socket paths, PHP binary, etc.)
		const config = registry.get(siteId);
		if (!config) {
			return {
				content: [{ type: 'text', text: `Site ${siteId} is no longer registered.` }],
				isError: true,
			};
		}

		try {
			return await handleToolCall(name, (args ?? {}) as Record<string, unknown>, config, localApi);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[Agent Tools] Tool error (${name}): ${msg}`);
			return {
				content: [{ type: 'text', text: `Error executing ${name}: ${msg}` }],
				isError: true,
			};
		}
	});

	return server;
}

// ---------------------------------------------------------------------------
// Request Body Parser
// ---------------------------------------------------------------------------

function readBody(req: http.IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let totalBytes = 0;
		req.on('data', (chunk: Buffer) => {
			totalBytes += chunk.length;
			if (totalBytes > MAX_BODY_SIZE) {
				req.destroy();
				reject(new Error(`Request body exceeds maximum size of ${MAX_BODY_SIZE} bytes`));
				return;
			}
			chunks.push(chunk);
		});
		req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
		req.on('error', reject);
	});
}

// ---------------------------------------------------------------------------
// URL Routing
// ---------------------------------------------------------------------------

/** Extract siteId from URL path like /sites/{siteId}/mcp */
function parseSiteId(url: string): string | null {
	const match = url.match(/^\/sites\/([^/]+)\/mcp$/);
	return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// Auth & DNS-Rebinding Protection
// ---------------------------------------------------------------------------

/**
 * The single loopback allowlist, in `hostname:port` form. Both rebinding
 * layers compare against this one list — our own Host/Origin gate and the
 * SDK's `allowedHosts`/`allowedOrigins` on the transport — so they can never
 * accept and reject different sets. Scoped to the port this instance is bound
 * to: a page served from another local port is a different origin and has no
 * business reaching us.
 */
function buildAllowedHosts(port: number): string[] {
	return [`127.0.0.1:${port}`, `localhost:${port}`];
}

/**
 * Constant-time comparison of a candidate token against the expected one, so
 * response timing can't be used to guess the token byte-by-byte. Guards
 * length first since `timingSafeEqual` throws on mismatched buffer lengths.
 */
function tokenMatches(candidate: string, expected: string): boolean {
	const provided = Buffer.from(candidate, 'utf-8');
	const expectedBuf = Buffer.from(expected, 'utf-8');

	if (provided.length !== expectedBuf.length) return false;

	return timingSafeEqual(provided, expectedBuf);
}

/**
 * Verifies the request carries our per-install token in an
 * `Authorization: Bearer <authToken>` header. The header is the only accepted
 * channel: a `?token=` query parameter would land the secret in client logs,
 * browser history, and referrers (RFC 6750 §2.3 deprecates it), and reading it
 * would mean parsing an attacker-controlled request target before auth. All
 * four supported clients (Claude Code, Cursor, Windsurf, VS Code) accept a
 * `headers` field for HTTP MCP servers, so nothing needs the query channel.
 */
function isAuthorized(req: http.IncomingMessage, authToken: string): boolean {
	const header = req.headers['authorization'];
	if (typeof header !== 'string') return false;

	// RFC 7235: the auth-scheme token ("Bearer") is case-insensitive, so match
	// it case-insensitively — but slice the token itself off the *original*
	// header so we never alter the token bytes we're about to compare.
	if (header.slice(0, 7).toLowerCase() !== 'bearer ') return false;

	return tokenMatches(header.slice(7), authToken);
}

/** Characters with no meaning in a bare `Host` header — their presence only
 * indicates an attempt to smuggle a second hostname past a naive parser
 * (e.g. `evil.com@localhost`, `localhost/evil.com`). */
const HOST_HEADER_FORBIDDEN_CHARS = /[@/#?\s]/;

/**
 * Defeats DNS-rebinding attacks: rejects any request whose Host header — and
 * Origin header, when it carries one — isn't exactly one of this instance's
 * loopback entries. Only a request with no Origin header at all passes;
 * MCP clients aren't browsers and don't send one. A header that is present
 * but empty is not "no Origin": nothing legitimate sends one, so it is
 * rejected like any other non-loopback value.
 *
 * The compare is byte-exact: no case folding, no trailing-dot handling, and
 * the Origin's scheme counts. A real client builds its Host header from the
 * URL we write into its config, which is lowercase `localhost:{port}`, so
 * exact match costs nothing. It also means this gate and the SDK's own
 * rebinding check — which compares the raw header against these same two
 * lists — reach the same verdict on every request, without this code having
 * to know anything about transport internals.
 */
function isAllowedHost(
	req: http.IncomingMessage,
	allowedHosts: readonly string[],
	allowedOrigins: readonly string[],
): boolean {
	const host = req.headers.host;
	if (!host) return false;

	// The exact compare below would reject these anyway. They stay, ahead of
	// it, to name the smuggling shapes this gate exists to stop — and to keep
	// the check sound if the allowlist ever grows.
	if (HOST_HEADER_FORBIDDEN_CHARS.test(host)) return false;

	// Bracketed IPv6 literals (e.g. `[::1]:24842`) can never match: the server
	// binds IPv4 loopback only (`server.listen(port, '127.0.0.1')`), so no
	// allowlist entry is an IPv6 address. Reject rather than compare further.
	if (host.startsWith('[')) return false;

	if (!allowedHosts.includes(host)) return false;

	// `!== undefined`, not a truthiness check: `Origin:` with an empty value is
	// a header the client chose to send, so it has to clear the allowlist like
	// any other value. Only an absent header skips the compare.
	const origin = req.headers.origin;
	if (origin !== undefined && !allowedOrigins.includes(origin)) return false;

	return true;
}

// ---------------------------------------------------------------------------
// HTTP Server
// ---------------------------------------------------------------------------

export function createMcpHttpServer(options: McpHttpServerOptions): http.Server {
	const { registry, localApi, authToken, port } = options;

	// An empty token would make isAuthorized's length check pass for an empty
	// (or missing-but-coerced-empty) Authorization value — never let a server
	// come up in a state where it can't actually enforce auth.
	if (!authToken) throw new Error('createMcpHttpServer requires a non-empty authToken');

	// Built once, used by both rebinding layers. `allowedOrigins` is the same
	// list as an origin: this server speaks plain HTTP on loopback only.
	const allowedHosts = buildAllowedHosts(port);
	const allowedOrigins = allowedHosts.map((host) => `http://${host}`);

	const httpServer = http.createServer(async (req, res) => {
		// Both gates run inside this try: they read attacker-controlled headers,
		// so any unexpected throw must still produce a response rather than
		// leaving the socket open with nothing written to it.
		try {
			// Auth: every request must present our per-install bearer token.
			if (!isAuthorized(req, authToken)) {
				res.writeHead(401, {
					'Content-Type': 'application/json',
					'WWW-Authenticate': 'Bearer realm="Agent Tools"',
					'Cache-Control': 'no-store',
				});
				res.end(
					JSON.stringify({
						error: 'Unauthorized',
						hint: 'Regenerate config from the Agent Tools panel in Local',
					}),
				);
				return;
			}

			// DNS-rebinding protection: Host (and Origin, if present) must be loopback.
			if (!isAllowedHost(req, allowedHosts, allowedOrigins)) {
				res.writeHead(403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
				res.end(JSON.stringify({ error: 'Forbidden host' }));
				return;
			}

			const url = (req.url || '').split('?')[0]; // strip query string
			const method = req.method || 'GET';

			// Health check — no siteId enumeration; auth is already enforced above.
			if (url === '/health' && method === 'GET') {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ status: 'ok', activeSessions: sessions.size }));
				return;
			}

			// MCP endpoint: /sites/:siteId/mcp
			const siteId = parseSiteId(url);
			if (!siteId) {
				res.writeHead(404, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: 'Not found. Use /sites/{siteId}/mcp' }));
				return;
			}

			const config = registry.get(siteId);
			if (!config) {
				res.writeHead(404, { 'Content-Type': 'application/json' });
				res.end(
					JSON.stringify({
						error: `Site not registered: ${siteId}. The site may not be running or Agent Tools may not be enabled.`,
					}),
				);
				return;
			}

			const sessionId = req.headers['mcp-session-id'] as string | undefined;

			if (method === 'POST') {
				let bodyStr: string;
				try {
					bodyStr = await readBody(req);
				} catch {
					if (!res.headersSent) {
						res.writeHead(413, { 'Content-Type': 'application/json' });
						res.end(
							JSON.stringify({
								jsonrpc: '2.0',
								error: { code: -32000, message: 'Request body too large' },
								id: null,
							}),
						);
					}
					return;
				}
				let body: McpRequest;
				try {
					body = JSON.parse(bodyStr);
				} catch {
					res.writeHead(400, { 'Content-Type': 'application/json' });
					res.end(
						JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }),
					);
					return;
				}

				if (sessionId && sessions.has(sessionId)) {
					// Existing session — route to its transport
					const entry = sessions.get(sessionId)!;
					entry.lastActivity = Date.now();
					await entry.transport.handleRequest(req, res, body);
					return;
				}

				// New session — must be an initialize request
				const isInit =
					body?.method === 'initialize' ||
					(Array.isArray(body) && body.some((msg: McpRequest) => msg?.method === 'initialize'));

				if (!isInit) {
					res.writeHead(400, { 'Content-Type': 'application/json' });
					res.end(
						JSON.stringify({
							jsonrpc: '2.0',
							error: {
								code: -32000,
								message: 'Bad Request: No valid session and not an initialize request',
							},
							id: body?.id ?? null,
						}),
					);
					return;
				}

				// Create new session
				const transport = new StreamableHTTPServerTransport({
					sessionIdGenerator: () => randomUUID(),
					enableJsonResponse: true,
					// Defense-in-depth: the top-level Host/Origin check above is the real
					// fix and applies regardless of transport internals; this lets the SDK
					// enforce the same policy from the same lists. Both compares are
					// exact on the raw header, so the two layers can never disagree
					// about a request.
					enableDnsRebindingProtection: true,
					allowedHosts,
					allowedOrigins,
					onsessioninitialized: (newSessionId: string) => {
						sessions.set(newSessionId, {
							transport,
							server: mcpServer,
							siteId,
							lastActivity: Date.now(),
						});
						console.log(`[Agent Tools] New MCP session ${newSessionId} for site ${siteId}`);
					},
				});

				transport.onclose = () => {
					const sid = transport.sessionId;
					if (sid && sessions.has(sid)) {
						sessions.delete(sid);
						console.log(`[Agent Tools] MCP session ${sid} closed`);
					}
				};

				const mcpServer = createMcpServer(siteId, registry, localApi);
				await mcpServer.connect(transport);
				await transport.handleRequest(req, res, body);
			} else if (method === 'GET') {
				// SSE stream for existing session
				if (!sessionId || !sessions.has(sessionId)) {
					res.writeHead(400, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ error: 'Invalid or missing session ID' }));
					return;
				}
				const entry = sessions.get(sessionId)!;
				entry.lastActivity = Date.now();
				await entry.transport.handleRequest(req, res);
			} else if (method === 'DELETE') {
				// Session termination
				if (!sessionId || !sessions.has(sessionId)) {
					res.writeHead(400, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ error: 'Invalid or missing session ID' }));
					return;
				}
				const entry = sessions.get(sessionId)!;
				await entry.transport.handleRequest(req, res);
				try {
					entry.server.close();
				} catch {
					/* intentionally empty */
				}
				sessions.delete(sessionId);
			} else {
				res.writeHead(405, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: 'Method not allowed' }));
			}
		} catch (err) {
			console.error('[Agent Tools] MCP request error:', err);
			if (!res.headersSent) {
				res.writeHead(500, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: 'Internal server error' }));
			}
		}
	});

	return httpServer;
}

/**
 * Start the MCP HTTP server on the given port.
 * Returns a promise that resolves when the server is listening.
 */
export function startMcpHttpServer(server: http.Server, port: number): Promise<void> {
	return new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(port, '127.0.0.1', () => {
			console.log(`[Agent Tools] MCP HTTP server listening on http://127.0.0.1:${port}`);
			startSessionCleanup();
			resolve();
		});
	});
}

/**
 * Stop the MCP HTTP server and clean up all sessions.
 */
export function stopMcpHttpServer(server: http.Server): Promise<void> {
	return new Promise((resolve) => {
		stopSessionCleanup();
		closeAllSessions();
		server.close(() => {
			console.log('[Agent Tools] MCP HTTP server stopped');
			resolve();
		});
	});
}
