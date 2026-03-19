"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.closeSessionsForSite = closeSessionsForSite;
exports.createMcpHttpServer = createMcpHttpServer;
exports.startMcpHttpServer = startMcpHttpServer;
exports.stopMcpHttpServer = stopMcpHttpServer;
const http = __importStar(require("http"));
const crypto_1 = require("crypto");
const tools_1 = require("./tools");
// ---------------------------------------------------------------------------
// MCP SDK — loaded via require() for CJS compatibility.
// The SDK ships CJS builds and exports them via package.json "exports" map.
// Node.js resolves these correctly at runtime; we use require() to bypass
// TypeScript's "node" moduleResolution which doesn't read exports maps.
// ---------------------------------------------------------------------------
/* eslint-disable @typescript-eslint/no-var-requires */
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { CallToolRequestSchema, ListToolsRequestSchema, } = require('@modelcontextprotocol/sdk/types.js');
// ---------------------------------------------------------------------------
// Session Management
// ---------------------------------------------------------------------------
const MAX_BODY_SIZE = 1 * 1024 * 1024; // 1 MB
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const sessions = new Map();
let cleanupInterval = null;
function startSessionCleanup() {
    if (cleanupInterval)
        return;
    cleanupInterval = setInterval(() => {
        const now = Date.now();
        for (const [sessionId, entry] of sessions) {
            if (now - entry.lastActivity > SESSION_TIMEOUT_MS) {
                console.log(`[Agent Tools] Closing inactive MCP session ${sessionId}`);
                try {
                    entry.transport.close();
                }
                catch (_a) { }
                try {
                    entry.server.close();
                }
                catch (_b) { }
                sessions.delete(sessionId);
            }
        }
    }, 60000); // Check every minute
}
function stopSessionCleanup() {
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = null;
    }
}
/**
 * Close all MCP sessions associated with a specific site.
 * Called when a site is stopped or unregistered.
 */
function closeSessionsForSite(siteId) {
    for (const [sessionId, entry] of sessions) {
        if (entry.siteId === siteId) {
            console.log(`[Agent Tools] Closing MCP session ${sessionId} for site ${siteId}`);
            try {
                entry.transport.close();
            }
            catch (_a) { }
            try {
                entry.server.close();
            }
            catch (_b) { }
            sessions.delete(sessionId);
        }
    }
}
function closeAllSessions() {
    for (const [sessionId, entry] of sessions) {
        try {
            entry.transport.close();
        }
        catch (_a) { }
        try {
            entry.server.close();
        }
        catch (_b) { }
    }
    sessions.clear();
}
// ---------------------------------------------------------------------------
// MCP Server Factory — creates a Server instance for a specific site
// ---------------------------------------------------------------------------
function createMcpServer(siteId, registry, localApi) {
    const server = new Server({ name: 'local-wp', version: '1.0.0' }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, () => __awaiter(this, void 0, void 0, function* () {
        return { tools: tools_1.allToolDefinitions };
    }));
    server.setRequestHandler(CallToolRequestSchema, (request) => __awaiter(this, void 0, void 0, function* () {
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
            return yield (0, tools_1.handleToolCall)(name, (args !== null && args !== void 0 ? args : {}), config, localApi);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[Agent Tools] Tool error (${name}): ${msg}`);
            return {
                content: [{ type: 'text', text: `Error executing ${name}: ${msg}` }],
                isError: true,
            };
        }
    }));
    return server;
}
// ---------------------------------------------------------------------------
// Request Body Parser
// ---------------------------------------------------------------------------
function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let totalBytes = 0;
        req.on('data', (chunk) => {
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
function parseSiteId(url) {
    const match = url.match(/^\/sites\/([^/]+)\/mcp$/);
    return match ? match[1] : null;
}
// ---------------------------------------------------------------------------
// HTTP Server
// ---------------------------------------------------------------------------
function createMcpHttpServer(options) {
    const { registry, localApi } = options;
    const httpServer = http.createServer((req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a;
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
        const sessionId = req.headers['mcp-session-id'];
        try {
            if (method === 'POST') {
                let bodyStr;
                try {
                    bodyStr = yield readBody(req);
                }
                catch (err) {
                    if (!res.headersSent) {
                        res.writeHead(413, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Request body too large' }, id: null }));
                    }
                    return;
                }
                let body;
                try {
                    body = JSON.parse(bodyStr);
                }
                catch (_b) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }));
                    return;
                }
                if (sessionId && sessions.has(sessionId)) {
                    // Existing session — route to its transport
                    const entry = sessions.get(sessionId);
                    entry.lastActivity = Date.now();
                    yield entry.transport.handleRequest(req, res, body);
                    return;
                }
                // New session — must be an initialize request
                const isInit = (body === null || body === void 0 ? void 0 : body.method) === 'initialize' ||
                    (Array.isArray(body) && body.some((msg) => (msg === null || msg === void 0 ? void 0 : msg.method) === 'initialize'));
                if (!isInit) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        jsonrpc: '2.0',
                        error: { code: -32000, message: 'Bad Request: No valid session and not an initialize request' },
                        id: (_a = body === null || body === void 0 ? void 0 : body.id) !== null && _a !== void 0 ? _a : null,
                    }));
                    return;
                }
                // Create new session
                const transport = new StreamableHTTPServerTransport({
                    sessionIdGenerator: () => (0, crypto_1.randomUUID)(),
                    enableJsonResponse: true,
                    onsessioninitialized: (newSessionId) => {
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
                yield mcpServer.connect(transport);
                yield transport.handleRequest(req, res, body);
            }
            else if (method === 'GET') {
                // SSE stream for existing session
                if (!sessionId || !sessions.has(sessionId)) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid or missing session ID' }));
                    return;
                }
                const entry = sessions.get(sessionId);
                entry.lastActivity = Date.now();
                yield entry.transport.handleRequest(req, res);
            }
            else if (method === 'DELETE') {
                // Session termination
                if (!sessionId || !sessions.has(sessionId)) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid or missing session ID' }));
                    return;
                }
                const entry = sessions.get(sessionId);
                yield entry.transport.handleRequest(req, res);
                try {
                    entry.server.close();
                }
                catch (_c) { }
                sessions.delete(sessionId);
            }
            else {
                res.writeHead(405, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Method not allowed' }));
            }
        }
        catch (err) {
            console.error('[Agent Tools] MCP request error:', err);
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Internal server error' }));
            }
        }
    }));
    return httpServer;
}
/**
 * Start the MCP HTTP server on the given port.
 * Returns a promise that resolves when the server is listening.
 */
function startMcpHttpServer(server, port) {
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
function stopMcpHttpServer(server) {
    return new Promise((resolve) => {
        stopSessionCleanup();
        closeAllSessions();
        server.close(() => {
            console.log('[Agent Tools] MCP HTTP server stopped');
            resolve();
        });
    });
}
//# sourceMappingURL=mcp-server.js.map