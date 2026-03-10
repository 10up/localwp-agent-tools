import { readFile, writeFile, copyFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
// ── Environment ────────────────────────────────────────────────────────
const LOG_PATH = process.env.LOG_PATH || '';
const WP_PATH = process.env.WP_PATH || '';
// ── Tool Definitions ───────────────────────────────────────────────────
export const toolDefinitions = [
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
export async function handleTool(name, args) {
    try {
        switch (name) {
            case 'read_error_log':
                return handleReadErrorLog(args);
            case 'read_access_log':
                return handleReadAccessLog(args);
            case 'wp_debug_toggle':
                return handleWpDebugToggle(args);
            default:
                return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
        }
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error: ${msg}` }] };
    }
}
// ── read_error_log ─────────────────────────────────────────────────────
async function handleReadErrorLog(args) {
    const numLines = Number(args.lines ?? 50);
    const filter = args.filter ? String(args.filter) : null;
    const logFile = path.join(LOG_PATH, 'php', 'error.log');
    if (!existsSync(logFile)) {
        return {
            content: [{ type: 'text', text: `PHP error log not found at: ${logFile}` }],
        };
    }
    const content = await readFile(logFile, 'utf-8');
    let lines = content.split('\n').filter((l) => l.trim());
    if (filter) {
        const lowerFilter = filter.toLowerCase();
        lines = lines.filter((l) => l.toLowerCase().includes(lowerFilter));
    }
    // Take the last N lines
    const lastLines = lines.slice(-numLines);
    // Try to parse PHP error log entries into structured format
    const entries = lastLines.map((line) => parsePhpErrorLine(line));
    const logStat = await stat(logFile);
    const sizeKb = Math.round(logStat.size / 1024);
    return {
        content: [
            {
                type: 'text',
                text: JSON.stringify({
                    file: logFile,
                    sizeKb,
                    totalLines: lines.length,
                    showing: lastLines.length,
                    entries,
                }, null, 2),
            },
        ],
    };
}
// ── read_access_log ────────────────────────────────────────────────────
async function handleReadAccessLog(args) {
    const numLines = Number(args.lines ?? 50);
    const filter = args.filter ? String(args.filter) : null;
    // Try multiple possible locations
    const candidates = [
        path.join(LOG_PATH, 'nginx', 'access.log'),
        path.join(LOG_PATH, 'nginx', 'access.log.1'),
        path.join(LOG_PATH, 'apache', 'access.log'),
    ];
    let logFile = null;
    for (const candidate of candidates) {
        if (existsSync(candidate)) {
            logFile = candidate;
            break;
        }
    }
    if (!logFile) {
        return {
            content: [
                {
                    type: 'text',
                    text: `Access log not found. Searched:\n${candidates.join('\n')}`,
                },
            ],
        };
    }
    const content = await readFile(logFile, 'utf-8');
    let lines = content.split('\n').filter((l) => l.trim());
    if (filter) {
        const lowerFilter = filter.toLowerCase();
        lines = lines.filter((l) => l.toLowerCase().includes(lowerFilter));
    }
    const lastLines = lines.slice(-numLines);
    const logStat = await stat(logFile);
    const sizeKb = Math.round(logStat.size / 1024);
    return {
        content: [
            {
                type: 'text',
                text: JSON.stringify({
                    file: logFile,
                    sizeKb,
                    totalLines: lines.length,
                    showing: lastLines.length,
                    lines: lastLines,
                }, null, 2),
            },
        ],
    };
}
// ── wp_debug_toggle ────────────────────────────────────────────────────
async function handleWpDebugToggle(args) {
    const enable = Boolean(args.enable);
    const debugLog = args.debug_log !== undefined ? Boolean(args.debug_log) : enable;
    const scriptDebug = args.script_debug !== undefined ? Boolean(args.script_debug) : enable;
    const configPath = path.join(WP_PATH, 'wp-config.php');
    if (!existsSync(configPath)) {
        return {
            content: [{ type: 'text', text: `wp-config.php not found at: ${configPath}` }],
        };
    }
    // Backup first
    const backupPath = `${configPath}.bak`;
    await copyFile(configPath, backupPath);
    let config = await readFile(configPath, 'utf-8');
    const boolStr = (val) => (val ? 'true' : 'false');
    // Apply each constant
    config = setWpConstant(config, 'WP_DEBUG', boolStr(enable));
    config = setWpConstant(config, 'WP_DEBUG_LOG', boolStr(debugLog));
    config = setWpConstant(config, 'SCRIPT_DEBUG', boolStr(scriptDebug));
    await writeFile(configPath, config, 'utf-8');
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
}
// ── Helpers ────────────────────────────────────────────────────────────
/**
 * Set a PHP constant in wp-config.php. If it exists, replace the value.
 * If not, insert it before the "That's all" comment line.
 */
function setWpConstant(config, name, value) {
    // Match: define( 'CONSTANT', value );  with flexible whitespace and quoting
    const regex = new RegExp(`(define\\s*\\(\\s*['"]${name}['"]\\s*,\\s*)([^)]+?)(\\s*\\)\\s*;)`, 'g');
    if (regex.test(config)) {
        // Replace existing
        return config.replace(regex, `$1${value}$3`);
    }
    // Insert before "That's all, stop editing!" comment
    const marker = /\/\*.*?That's all.*?\*\//i;
    const insertLine = `define( '${name}', ${value} );\n`;
    if (marker.test(config)) {
        return config.replace(marker, `${insertLine}$&`);
    }
    // Fallback: insert before the require_once line for wp-settings.php
    const settingsLine = /require_once.*wp-settings\.php/;
    if (settingsLine.test(config)) {
        return config.replace(settingsLine, `${insertLine}$&`);
    }
    // Last resort: append before the end
    return config + `\n${insertLine}`;
}
/**
 * Parse a PHP error log line into structured data.
 * Common format: [DD-Mon-YYYY HH:MM:SS TZ] PHP Warning: message in /path on line N
 */
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