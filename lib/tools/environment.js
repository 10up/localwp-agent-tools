"use strict";
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
exports.toolDefinitions = void 0;
exports.handleTool = handleTool;
// ── Tool Definitions ───────────────────────────────────────────────────
exports.toolDefinitions = [
    {
        name: 'site_start',
        description: "Start a Local site's services (PHP, MySQL, web server). " +
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
        description: "Stop a Local site's services (PHP, MySQL, web server). " +
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
        description: "Restart a Local site's services (PHP, MySQL, web server). " +
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
function handleTool(name, args, config, localApi) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            switch (name) {
                case 'site_start':
                    return handleSiteAction('start', args, config, localApi);
                case 'site_stop':
                    return handleSiteAction('stop', args, config, localApi);
                case 'site_restart':
                    return handleSiteAction('restart', args, config, localApi);
                case 'site_status':
                    return handleSiteAction('status', args, config, localApi);
                case 'list_sites':
                    return handleListSites(localApi);
                default:
                    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
            }
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text', text: `Environment Error: ${msg}` }] };
        }
    });
}
// ── site_start / site_stop / site_restart / site_status ───────────────
function handleSiteAction(action, args, config, localApi) {
    return __awaiter(this, void 0, void 0, function* () {
        const siteId = args.siteId || config.siteId;
        if (!siteId) {
            return {
                content: [
                    {
                        type: 'text',
                        text: 'Error: No siteId provided and current site ID is not available. ' +
                            'Please provide a siteId argument, or use list_sites to find available site IDs.',
                    },
                ],
            };
        }
        try {
            let result;
            switch (action) {
                case 'start':
                    result = yield localApi.startSite(siteId);
                    break;
                case 'stop':
                    result = yield localApi.stopSite(siteId);
                    break;
                case 'restart':
                    result = yield localApi.restartSite(siteId);
                    break;
                case 'status':
                    result = yield localApi.getSiteStatus(siteId);
                    break;
            }
            return {
                content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
                content: [{ type: 'text', text: `Failed to ${action} site: ${msg}` }],
            };
        }
    });
}
// ── list_sites ────────────────────────────────────────────────────────
function handleListSites(localApi) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const sites = yield localApi.listSites();
            return {
                content: [{ type: 'text', text: JSON.stringify(sites, null, 2) }],
            };
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
                content: [{ type: 'text', text: `Failed to list sites: ${msg}` }],
            };
        }
    });
}
//# sourceMappingURL=environment.js.map