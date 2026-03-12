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
exports.toolDefinitions = void 0;
exports.handleTool = handleTool;
const promises_1 = require("fs/promises");
const fs_1 = require("fs");
const path = __importStar(require("path"));
// ── Tool Definitions ───────────────────────────────────────────────────
exports.toolDefinitions = [
    {
        name: 'read_error_log',
        description: 'Read the PHP error log for the Local site. Returns the last N lines (default 50), parsed into structured entries when possible.',
        inputSchema: {
            type: 'object',
            properties: {
                lines: {
                    type: 'number',
                    description: 'Number of lines to return from the end of the log. Default 50.',
                    default: 50,
                },
                filter: {
                    type: 'string',
                    description: 'Optional string to filter log lines (case-insensitive).',
                },
            },
        },
    },
    {
        name: 'read_access_log',
        description: 'Read the nginx access log for the Local site. Returns the last N lines (default 50).',
        inputSchema: {
            type: 'object',
            properties: {
                lines: {
                    type: 'number',
                    description: 'Number of lines to return from the end of the log. Default 50.',
                    default: 50,
                },
                filter: {
                    type: 'string',
                    description: 'Optional string to filter log lines (case-insensitive).',
                },
            },
        },
    },
    {
        name: 'wp_debug_toggle',
        description: 'Enable or disable WordPress debug mode. Modifies WP_DEBUG, WP_DEBUG_LOG, and SCRIPT_DEBUG constants in wp-config.php.',
        inputSchema: {
            type: 'object',
            properties: {
                enable: {
                    type: 'boolean',
                    description: 'Set to true to enable debug mode, false to disable.',
                },
                debug_log: {
                    type: 'boolean',
                    description: 'Enable WP_DEBUG_LOG (writes errors to wp-content/debug.log). Defaults to same value as enable.',
                },
                script_debug: {
                    type: 'boolean',
                    description: 'Enable SCRIPT_DEBUG (loads non-minified scripts). Defaults to same value as enable.',
                },
            },
            required: ['enable'],
        },
    },
];
// ── Tool Handler ───────────────────────────────────────────────────────
function handleTool(name, args, config) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            switch (name) {
                case 'read_error_log':
                    return handleReadErrorLog(args, config);
                case 'read_access_log':
                    return handleReadAccessLog(args, config);
                case 'wp_debug_toggle':
                    return handleWpDebugToggle(args, config);
                default:
                    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
            }
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text', text: `Error: ${msg}` }] };
        }
    });
}
// ── read_error_log ─────────────────────────────────────────────────────
/**
 * Finds the most relevant PHP error log file.
 *
 * When WP_DEBUG and WP_DEBUG_LOG are true, WordPress calls
 * ini_set('error_log', WP_CONTENT_DIR . '/debug.log') which redirects
 * PHP errors away from the server's error.log to wp-content/debug.log.
 * We check both locations and return whichever was modified most recently.
 */
function findErrorLog(config) {
    return __awaiter(this, void 0, void 0, function* () {
        const serverLog = path.join(config.logPath, 'php', 'error.log');
        const debugLog = path.join(config.wpPath, 'wp-content', 'debug.log');
        const serverExists = (0, fs_1.existsSync)(serverLog);
        const debugExists = (0, fs_1.existsSync)(debugLog);
        if (serverExists && debugExists) {
            const serverMtime = (yield (0, promises_1.stat)(serverLog)).mtimeMs;
            const debugMtime = (yield (0, promises_1.stat)(debugLog)).mtimeMs;
            return debugMtime >= serverMtime ? debugLog : serverLog;
        }
        if (debugExists)
            return debugLog;
        if (serverExists)
            return serverLog;
        return null;
    });
}
function handleReadErrorLog(args, config) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const numLines = Number((_a = args.lines) !== null && _a !== void 0 ? _a : 50);
        const filter = args.filter ? String(args.filter) : null;
        const logFile = yield findErrorLog(config);
        if (!logFile) {
            return {
                content: [{ type: 'text', text: `PHP error log not found. Searched:\n  ${path.join(config.logPath, 'php', 'error.log')}\n  ${path.join(config.wpPath, 'wp-content', 'debug.log')}` }],
            };
        }
        const content = yield (0, promises_1.readFile)(logFile, 'utf-8');
        let lines = content.split('\n').filter((l) => l.trim());
        if (filter) {
            const lowerFilter = filter.toLowerCase();
            lines = lines.filter((l) => l.toLowerCase().includes(lowerFilter));
        }
        const lastLines = lines.slice(-numLines);
        const entries = lastLines.map((line) => parsePhpErrorLine(line));
        const logStat = yield (0, promises_1.stat)(logFile);
        const sizeKb = Math.round(logStat.size / 1024);
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({ file: logFile, sizeKb, totalLines: lines.length, showing: lastLines.length, entries }, null, 2),
                },
            ],
        };
    });
}
// ── read_access_log ────────────────────────────────────────────────────
function handleReadAccessLog(args, config) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const numLines = Number((_a = args.lines) !== null && _a !== void 0 ? _a : 50);
        const filter = args.filter ? String(args.filter) : null;
        const candidates = [
            path.join(config.logPath, 'nginx', 'access.log'),
            path.join(config.logPath, 'nginx', 'access.log.1'),
            path.join(config.logPath, 'apache', 'access.log'),
        ];
        let logFile = null;
        for (const candidate of candidates) {
            if ((0, fs_1.existsSync)(candidate)) {
                logFile = candidate;
                break;
            }
        }
        if (!logFile) {
            return {
                content: [
                    { type: 'text', text: `Access log not found. Searched:\n${candidates.join('\n')}` },
                ],
            };
        }
        const content = yield (0, promises_1.readFile)(logFile, 'utf-8');
        let lines = content.split('\n').filter((l) => l.trim());
        if (filter) {
            const lowerFilter = filter.toLowerCase();
            lines = lines.filter((l) => l.toLowerCase().includes(lowerFilter));
        }
        const lastLines = lines.slice(-numLines);
        const logStat = yield (0, promises_1.stat)(logFile);
        const sizeKb = Math.round(logStat.size / 1024);
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({ file: logFile, sizeKb, totalLines: lines.length, showing: lastLines.length, lines: lastLines }, null, 2),
                },
            ],
        };
    });
}
// ── wp_debug_toggle ────────────────────────────────────────────────────
function handleWpDebugToggle(args, config) {
    return __awaiter(this, void 0, void 0, function* () {
        const enable = Boolean(args.enable);
        const debugLog = args.debug_log !== undefined ? Boolean(args.debug_log) : enable;
        const scriptDebug = args.script_debug !== undefined ? Boolean(args.script_debug) : enable;
        const configPath = path.join(config.wpPath, 'wp-config.php');
        if (!(0, fs_1.existsSync)(configPath)) {
            return {
                content: [{ type: 'text', text: `wp-config.php not found at: ${configPath}` }],
            };
        }
        const backupPath = `${configPath}.bak`;
        yield (0, promises_1.copyFile)(configPath, backupPath);
        let fileContent = yield (0, promises_1.readFile)(configPath, 'utf-8');
        const boolStr = (val) => (val ? 'true' : 'false');
        fileContent = setWpConstant(fileContent, 'WP_DEBUG', boolStr(enable));
        fileContent = setWpConstant(fileContent, 'WP_DEBUG_LOG', boolStr(debugLog));
        fileContent = setWpConstant(fileContent, 'SCRIPT_DEBUG', boolStr(scriptDebug));
        yield (0, promises_1.writeFile)(configPath, fileContent, 'utf-8');
        return {
            content: [
                {
                    type: 'text',
                    text: [
                        `Debug settings updated in ${configPath}:`,
                        `  WP_DEBUG = ${boolStr(enable)}`,
                        `  WP_DEBUG_LOG = ${boolStr(debugLog)}`,
                        `  SCRIPT_DEBUG = ${boolStr(scriptDebug)}`,
                        ``,
                        `Backup saved to: ${backupPath}`,
                    ].join('\n'),
                },
            ],
        };
    });
}
// ── Helpers ────────────────────────────────────────────────────────────
function setWpConstant(content, name, value) {
    const regex = new RegExp(`(define\\s*\\(\\s*['"]${name}['"]\\s*,\\s*)([^)]+?)(\\s*\\)\\s*;)`, 'g');
    if (regex.test(content)) {
        return content.replace(regex, `$1${value}$3`);
    }
    const marker = /\/\*.*?That's all.*?\*\//i;
    const insertLine = `define( '${name}', ${value} );\n`;
    if (marker.test(content)) {
        return content.replace(marker, `${insertLine}$&`);
    }
    const settingsLine = /require_once.*wp-settings\.php/;
    if (settingsLine.test(content)) {
        return content.replace(settingsLine, `${insertLine}$&`);
    }
    return content + `\n${insertLine}`;
}
function parsePhpErrorLine(line) {
    const match = line.match(/^\[([^\]]+)\]\s+(?:PHP\s+)?(Fatal error|Warning|Notice|Deprecated|Parse error|Strict Standards|Recoverable fatal error)?:?\s*(.*?)(?:\s+in\s+(\S+?)(?:\s+on\s+line\s+(\d+))?)?$/i);
    if (!match) {
        return { raw: line };
    }
    return {
        raw: line,
        timestamp: match[1] || undefined,
        level: match[2] || undefined,
        message: match[3] || undefined,
        file: match[4] || undefined,
        line: match[5] ? parseInt(match[5], 10) : undefined,
    };
}
//# sourceMappingURL=logs.js.map