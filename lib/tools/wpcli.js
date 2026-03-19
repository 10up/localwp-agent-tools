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
exports.isBlockedCommand = isBlockedCommand;
exports.handleTool = handleTool;
exports.splitArgs = splitArgs;
const child_process_1 = require("child_process");
const util_1 = require("util");
const utils_1 = require("../helpers/utils");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
/**
 * Commands that are too destructive to allow through the MCP tool.
 * Checked against the first one or two parsed arguments.
 * Users can still run these directly in a terminal.
 */
const BLOCKED_COMMANDS = [
    ['eval'],
    ['eval-file'],
    ['shell'],
    ['db', 'drop'],
    ['db', 'reset'],
    ['db', 'import'],
    ['site', 'empty'],
    ['site', 'delete'],
];
function isBlockedCommand(args) {
    for (const blocked of BLOCKED_COMMANDS) {
        if (blocked.every((part, i) => { var _a; return ((_a = args[i]) === null || _a === void 0 ? void 0 : _a.toLowerCase()) === part; })) {
            return blocked.join(' ');
        }
    }
    return null;
}
// ── Core WP-CLI execution ──────────────────────────────────────────────
function runWpCli(wpArgs, config, options) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        if (!config.wpCliBin) {
            throw new Error('WP-CLI is not installed or not found. To install:\n' +
                '  curl -O https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar\n' +
                '  chmod +x wp-cli.phar\n' +
                '  sudo mv wp-cli.phar /usr/local/bin/wp\n\n' +
                'Or set the WP_CLI_BIN environment variable to the path of your wp-cli binary.');
        }
        const cmdArgs = [];
        // Local's wp-config.php uses DB_HOST=localhost, which makes PHP's mysqli
        // connect via Unix socket. Pass the correct socket path via PHP -d directive.
        if (config.dbSocket) {
            cmdArgs.push('-d', `mysqli.default_socket=${config.dbSocket}`);
            cmdArgs.push('-d', `pdo_mysql.default_socket=${config.dbSocket}`);
        }
        cmdArgs.push(config.wpCliBin, ...wpArgs);
        // Always ensure --path is set unless the user explicitly passed it
        const hasPathArg = wpArgs.some((a) => a.startsWith('--path=') || a === '--path');
        if (!hasPathArg && config.wpPath) {
            cmdArgs.push(`--path=${config.wpPath}`);
        }
        // Skip themes/plugins that may fatally error
        cmdArgs.push('--skip-themes', '--skip-plugins');
        const timeout = (_a = options === null || options === void 0 ? void 0 : options.timeout) !== null && _a !== void 0 ? _a : 60000;
        const env = (0, utils_1.buildWpCliEnv)(config);
        return execFileAsync(config.phpBin, cmdArgs, {
            cwd: config.wpPath,
            timeout,
            maxBuffer: 10 * 1024 * 1024,
            env,
        });
    });
}
// ── Tool Definitions ───────────────────────────────────────────────────
exports.toolDefinitions = [
    {
        name: 'wp_cli',
        description: 'Run an arbitrary WP-CLI command. Pass arguments without the leading "wp" prefix. Example: args="post list --post_type=page --format=json"\n\n' +
            'WARNING: Some WP-CLI commands are destructive and should only be run after confirming with the user:\n' +
            '- "eval" / "eval-file" / "shell" — execute arbitrary PHP code\n' +
            '- "db drop" / "db reset" — destroy the database\n' +
            '- "db import" — overwrite the database\n' +
            '- "plugin install <url>" / "theme install <url>" — install code from external sources\n' +
            '- "site empty" / "site delete" — delete site content\n' +
            '- "search-replace" (without --dry-run) — bulk modify database content\n' +
            'Always confirm with the user before running these commands.',
        inputSchema: {
            type: 'object',
            properties: {
                args: {
                    type: 'string',
                    description: 'WP-CLI arguments (without "wp" prefix). Example: "post list --post_type=page --format=json"',
                },
            },
            required: ['args'],
        },
    },
];
// ── Tool Handler ───────────────────────────────────────────────────────
function handleTool(name, args, config) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            switch (name) {
                case 'wp_cli':
                    return handleWpCli(args, config);
                default:
                    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
            }
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text', text: `WP-CLI Error: ${msg}` }] };
        }
    });
}
// ── wp_cli ─────────────────────────────────────────────────────────────
function handleWpCli(args, config) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const rawArgs = String((_a = args.args) !== null && _a !== void 0 ? _a : '').trim();
        if (!rawArgs) {
            return { content: [{ type: 'text', text: 'Error: args parameter is required.' }] };
        }
        const wpArgs = splitArgs(rawArgs);
        const blockedCmd = isBlockedCommand(wpArgs);
        if (blockedCmd) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error: "wp ${blockedCmd}" is blocked for safety. This command is destructive and must be run manually in a terminal.`,
                    },
                ],
            };
        }
        const { stdout, stderr } = yield runWpCli(wpArgs, config);
        let output = stdout;
        if (stderr && stderr.trim()) {
            output += `\n--- stderr ---\n${stderr.trim()}`;
        }
        return { content: [{ type: 'text', text: output || '(no output)' }] };
    });
}
// ── Utility: split command-line string into args array ─────────────────
function splitArgs(str) {
    const args = [];
    let current = '';
    let inSingle = false;
    let inDouble = false;
    let escaped = false;
    for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        if (escaped) {
            current += ch;
            escaped = false;
            continue;
        }
        // Backslash escapes the next character (except inside single quotes)
        if (ch === '\\' && !inSingle) {
            escaped = true;
            continue;
        }
        if (ch === "'" && !inDouble) {
            inSingle = !inSingle;
        }
        else if (ch === '"' && !inSingle) {
            inDouble = !inDouble;
        }
        else if (ch === ' ' && !inSingle && !inDouble) {
            if (current) {
                args.push(current);
                current = '';
            }
        }
        else {
            current += ch;
        }
    }
    if (current)
        args.push(current);
    return args;
}
//# sourceMappingURL=wpcli.js.map