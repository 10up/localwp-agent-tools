import * as http from 'http';
import { randomUUID } from 'crypto';
import { SiteConfig, SiteConfigRegistry } from './helpers/site-config';
import { allToolDefinitions, handleToolCall, LocalApi } from './tools';

// ---------------------------------------------------------------------------
// MCP SDK — loaded via require() for CJS compatibility.
// The SDK ships CJS builds and exports them via package.json "exports" map.
// Node.js resolves these correctly at runtime; we use require() to bypass
// TypeScript's "node" moduleResolution which doesn't read exports maps.
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-var-requires */
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
/* eslint-enable @typescript-eslint/no-var-requires */

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
}

// ---------------------------------------------------------------------------
// Session Management
// ---------------------------------------------------------------------------

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
				try { entry.transport.close(); } catch {}
				try { entry.server.close(); } catch {}
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
			try { entry.transport.close(); } catch {}
			try { entry.server.close(); } catch {}
			sessions.delete(sessionId);
		}
	}
}

function closeAllSessions(): void {
	for (const [sessionId, entry] of sessions) {
		try { entry.transport.close(); } catch {}
		try { entry.server.close(); } catch {}
	}
	sessions.clear();
}

// ---------------------------------------------------------------------------
// MCP Server Factory — creates a Server instance for a specific site
// ---------------------------------------------------------------------------

function createMcpServer(siteId: string, registry: SiteConfigRegistry, localApi: LocalApi): McpServer {
	const server = new Server(
		{ name: 'local-wp', version: '1.0.0' },
		{ capabilities: { tools: {} } },
	);

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
		req.on('data', (chunk: Buffer) => chunks.push(chunk));
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
// HTTP Server
// ---------------------------------------------------------------------------

export function createMcpHttpServer(options: McpHttpServerOptions): http.Server {
	const { registry, localApi } = options;

	const httpServer = http.createServer(async (req, res) => {
		const url = (req.url || '').split('?')[0]; // strip query string
		const method = req.method || 'GET';

		// CORS headers for local development
		res.setHeader('Access-Control-Allow-Origin', '*');
		res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
		res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id');
		res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');

		if (method === 'OPTIONS') {
			res.writeHead(204);
			res.end();
			return;
		}

		// Health check
		if (url === '/health' && method === 'GET') {
			const sites = registry.getAllIds();
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ status: 'ok', sites, activeSessions: sessions.size }));
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
			res.end(JSON.stringify({
				error: `Site not registered: ${siteId}. The site may not be running or Agent Tools may not be enabled.`,
			}));
			return;
		}

		const sessionId = req.headers['mcp-session-id'] as string | undefined;

		try {
			if (method === 'POST') {
				const bodyStr = await readBody(req);
				let body: McpRequest;
				try {
					body = JSON.parse(bodyStr);
				} catch {
					res.writeHead(400, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }));
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
				const isInit = body?.method === 'initialize' ||
					(Array.isArray(body) && body.some((msg: McpRequest) => msg?.method === 'initialize'));

				if (!isInit) {
					res.writeHead(400, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({
						jsonrpc: '2.0',
						error: { code: -32000, message: 'Bad Request: No valid session and not an initialize request' },
						id: body?.id ?? null,
					}));
					return;
				}

				// Create new session
				const transport = new StreamableHTTPServerTransport({
					sessionIdGenerator: () => randomUUID(),
					enableJsonResponse: true,
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
				try { entry.server.close(); } catch {}
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
