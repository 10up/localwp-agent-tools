import * as net from 'node:net';
// ── Environment ────────────────────────────────────────────────────────
const BRIDGE_SOCKET = process.env.BRIDGE_SOCKET || '';
const SITE_ID = process.env.SITE_ID || '';
const SITE_PATH = process.env.SITE_PATH || '';
// ── Bridge Client ─────────────────────────────────────────────────────
/**
 * Sends a request to the Local bridge server over a Unix domain socket
 * (or named pipe on Windows). The bridge runs inside Local's Electron
 * main process and has access to the SiteProcessManager for controlling
 * site services.
 *
 * Protocol: newline-delimited JSON.
 *   Request:  { "action": string, "siteId"?: string }\n
 *   Response: { "success": boolean, "data"?: any, "error"?: string }\n
 */
function callBridge(action, siteId) {
    return new Promise((resolve, reject) => {
        const socketPath = BRIDGE_SOCKET;
        if (!socketPath) {
            reject(new Error('BRIDGE_SOCKET environment variable is not configured. ' +
                'The Local bridge server must be running for environment management tools to work.'));
            return;
        }
        const client = net.createConnection(socketPath, () => {
            const payload = { action };
            if (siteId) {
                payload.siteId = siteId;
            }
            client.write(JSON.stringify(payload) + '\n');
        });
        let buffer = '';
        // The bridge server sends newline-delimited JSON but does NOT close the
        // socket after responding (it supports multiple messages per connection).
        // So we parse as soon as we see a complete newline-terminated JSON message
        // rather than waiting for the 'end' event.
        client.on('data', (chunk) => {
            buffer += chunk.toString();
            const newlineIdx = buffer.indexOf('\n');
            if (newlineIdx !== -1) {
                const line = buffer.slice(0, newlineIdx).trim();
                client.destroy(); // We got our response, close the connection
                try {
                    resolve(JSON.parse(line));
                }
                catch {
                    reject(new Error(`Invalid JSON response from bridge server: ${line}`));
                }
            }
        });
        client.on('end', () => {
            // Fallback: if the server closes the connection before sending a newline
            const trimmed = buffer.trim();
            if (!trimmed)
                return; // Already resolved via 'data' handler
            try {
                resolve(JSON.parse(trimmed));
            }
            catch {
                reject(new Error(`Invalid JSON response from bridge server: ${buffer}`));
            }
        });
        client.on('error', (err) => {
            if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED') {
                reject(new Error('Cannot connect to the Local bridge server. ' +
                    'Make sure Local is running and the Claude add-on is active.'));
            }
            else {
                reject(new Error(`Bridge connection error: ${err.message}`));
            }
        });
        // Timeout after 30 seconds — site start/stop can take a while
        client.setTimeout(30_000, () => {
            client.destroy();
            reject(new Error('Bridge connection timed out after 30 seconds'));
        });
    });
}
/**
 * Resolves the effective site ID for a bridge request.
 * Uses the explicit siteId argument if provided, otherwise falls back
 * to the SITE_ID environment variable (set in .mcp.json by the add-on).
 */
function resolveSiteId(siteId) {
    if (siteId)
        return siteId;
    if (SITE_ID)
        return SITE_ID;
    return undefined;
}
// ── Tool Definitions ───────────────────────────────────────────────────
export const toolDefinitions = [
    {
        name: 'site_start',
        description: 'Start a Local site\'s services (PHP, MySQL, web server). ' +
            'If siteId is omitted, operates on the current site.',
        inputSchema: {
            type: 'object',
            properties: {
                siteId: {
                    type: 'string',
                    description: 'The Local site ID. Optional — defaults to the current site.',
                },
            },
        },
    },
    {
        name: 'site_stop',
        description: 'Stop a Local site\'s services (PHP, MySQL, web server). ' +
            'If siteId is omitted, operates on the current site.',
        inputSchema: {
            type: 'object',
            properties: {
                siteId: {
                    type: 'string',
                    description: 'The Local site ID. Optional — defaults to the current site.',
                },
            },
        },
    },
    {
        name: 'site_restart',
        description: 'Restart a Local site\'s services (PHP, MySQL, web server). ' +
            'If siteId is omitted, operates on the current site.',
        inputSchema: {
            type: 'object',
            properties: {
                siteId: {
                    type: 'string',
                    description: 'The Local site ID. Optional — defaults to the current site.',
                },
            },
        },
    },
    {
        name: 'site_status',
        description: 'Get the current status (running, halted, etc.) of a Local site. ' +
            'If siteId is omitted, operates on the current site.',
        inputSchema: {
            type: 'object',
            properties: {
                siteId: {
                    type: 'string',
                    description: 'The Local site ID. Optional — defaults to the current site.',
                },
            },
        },
    },
    {
        name: 'list_sites',
        description: 'List all Local sites with their ID, name, domain, path, and current status.',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
];
// ── Tool Handler ───────────────────────────────────────────────────────
export async function handleTool(name, args) {
    try {
        switch (name) {
            case 'site_start':
                return handleSiteAction('start', args);
            case 'site_stop':
                return handleSiteAction('stop', args);
            case 'site_restart':
                return handleSiteAction('restart', args);
            case 'site_status':
                return handleSiteAction('status', args);
            case 'list_sites':
                return handleListSites();
            default:
                return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
        }
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Environment Error: ${msg}` }] };
    }
}
// ── site_start / site_stop / site_restart / site_status ───────────────
async function handleSiteAction(action, args) {
    const siteId = resolveSiteId(args.siteId);
    if (!siteId) {
        return {
            content: [
                {
                    type: 'text',
                    text: 'Error: No siteId provided and SITE_ID environment variable is not set. ' +
                        'Please provide a siteId argument, or use list_sites to find available site IDs.' +
                        (SITE_PATH ? `\n\nCurrent site path: ${SITE_PATH}` : ''),
                },
            ],
        };
    }
    const response = await callBridge(action, siteId);
    if (!response.success) {
        return {
            content: [
                {
                    type: 'text',
                    text: `Failed to ${action} site: ${response.error || 'Unknown error'}`,
                },
            ],
        };
    }
    return {
        content: [
            {
                type: 'text',
                text: JSON.stringify(response.data, null, 2),
            },
        ],
    };
}
// ── list_sites ────────────────────────────────────────────────────────
async function handleListSites() {
    const response = await callBridge('list');
    if (!response.success) {
        return {
            content: [
                {
                    type: 'text',
                    text: `Failed to list sites: ${response.error || 'Unknown error'}`,
                },
            ],
        };
    }
    return {
        content: [
            {
                type: 'text',
                text: JSON.stringify(response.data, null, 2),
            },
        ],
    };
}
//# sourceMappingURL=environment.js.map