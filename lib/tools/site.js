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
const child_process_1 = require("child_process");
const util_1 = require("util");
const path = __importStar(require("path"));
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
/** Build an env object for WP-CLI calls that includes MySQL binaries and DB connection vars. */
function wpCliEnv(config) {
    const mysqlBinDir = config.mysqlBin ? path.dirname(config.mysqlBin) : '';
    return Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({}, process.env), { PHP: config.phpBin, PATH: mysqlBinDir ? `${mysqlBinDir}:${process.env.PATH || ''}` : process.env.PATH }), (config.dbSocket ? { MYSQL_UNIX_PORT: config.dbSocket } : {})), (config.dbHost ? { MYSQL_HOST: config.dbHost } : {})), (config.dbPort ? { MYSQL_TCP_PORT: String(config.dbPort) } : {})), { MYSQL_PWD: config.dbPassword || '', DB_HOST: config.dbHost || 'localhost', DB_USER: config.dbUser || 'root', DB_PASSWORD: config.dbPassword || 'root', DB_NAME: config.dbName || 'local' }), (config.dbSocket ? { DB_SOCKET: config.dbSocket } : {})), (config.dbPort ? { DB_PORT: String(config.dbPort) } : {}));
}
// ── Tool Definitions ───────────────────────────────────────────────────
exports.toolDefinitions = [
    {
        name: 'get_site_info',
        description: 'Get comprehensive information about the Local site: paths, URLs, database config, PHP version, WordPress version, active plugins and theme.',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'site_health_check',
        description: 'Run a health check on the WordPress site: tests database connectivity, file permissions, WP_DEBUG status, log file sizes, and PHP version.',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
];
// ── Tool Handler ───────────────────────────────────────────────────────
function handleTool(name, _args, config) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            switch (name) {
                case 'get_site_info':
                    return handleGetSiteInfo(config);
                case 'site_health_check':
                    return handleSiteHealthCheck(config);
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
// ── get_site_info ──────────────────────────────────────────────────────
function handleGetSiteInfo(config) {
    return __awaiter(this, void 0, void 0, function* () {
        const info = {
            sitePath: config.sitePath,
            wpPath: config.wpPath,
            siteDomain: config.siteDomain,
            siteUrl: config.siteUrl,
            logPath: config.logPath,
            database: {
                name: config.dbName,
                user: config.dbUser,
                socket: config.dbSocket || null,
                port: config.dbPort,
            },
        };
        // Read WordPress version from wp-includes/version.php
        const versionFile = path.join(config.wpPath, 'wp-includes', 'version.php');
        if ((0, fs_1.existsSync)(versionFile)) {
            try {
                const versionContent = yield (0, promises_1.readFile)(versionFile, 'utf-8');
                const wpVersionMatch = versionContent.match(/\$wp_version\s*=\s*['"]([^'"]+)['"]/);
                const dbVersionMatch = versionContent.match(/\$wp_db_version\s*=\s*(\d+)/);
                info.wpVersion = wpVersionMatch ? wpVersionMatch[1] : 'unknown';
                info.wpDbVersion = dbVersionMatch ? dbVersionMatch[1] : 'unknown';
            }
            catch (_a) {
                info.wpVersion = 'error reading version file';
            }
        }
        // Get PHP version
        try {
            const { stdout } = yield execFileAsync(config.phpBin, ['-v'], { timeout: 5000 });
            const phpVersionMatch = stdout.match(/PHP\s+([\d.]+)/);
            info.phpVersion = phpVersionMatch ? phpVersionMatch[1] : stdout.split('\n')[0];
        }
        catch (_b) {
            info.phpVersion = 'unable to determine';
        }
        // Parse wp-config.php for key settings
        const configPath = path.join(config.wpPath, 'wp-config.php');
        if ((0, fs_1.existsSync)(configPath)) {
            try {
                const configContent = yield (0, promises_1.readFile)(configPath, 'utf-8');
                const debugMatch = configContent.match(/define\s*\(\s*['"]WP_DEBUG['"]\s*,\s*([^)]+?)\s*\)/);
                info.wpDebug = debugMatch ? debugMatch[1].trim() : 'not set';
                const prefixMatch = configContent.match(/\$table_prefix\s*=\s*['"]([^'"]+)['"]/);
                info.tablePrefix = prefixMatch ? prefixMatch[1] : 'wp_';
            }
            catch (_c) {
                // non-critical
            }
        }
        // Try WP-CLI for active plugins and theme
        if (config.wpCliBin && (0, fs_1.existsSync)(config.wpCliBin)) {
            const wpCliArgs = (extraArgs) => {
                const args = [];
                if (config.dbSocket) {
                    args.push('-d', `mysqli.default_socket=${config.dbSocket}`);
                    args.push('-d', `pdo_mysql.default_socket=${config.dbSocket}`);
                }
                args.push(config.wpCliBin, ...extraArgs, `--path=${config.wpPath}`, '--skip-themes', '--skip-plugins');
                return args;
            };
            try {
                const { stdout: pluginOut } = yield execFileAsync(config.phpBin, wpCliArgs(['plugin', 'list', '--status=active', '--format=json']), { cwd: config.wpPath, timeout: 15000, env: wpCliEnv(config) });
                info.activePlugins = JSON.parse(pluginOut);
            }
            catch (_d) {
                info.activePlugins = 'unable to retrieve (WP-CLI error)';
            }
            try {
                const { stdout: themeOut } = yield execFileAsync(config.phpBin, wpCliArgs(['theme', 'list', '--status=active', '--format=json']), { cwd: config.wpPath, timeout: 15000, env: wpCliEnv(config) });
                info.activeTheme = JSON.parse(themeOut);
            }
            catch (_e) {
                info.activeTheme = 'unable to retrieve (WP-CLI error)';
            }
        }
        return {
            content: [{ type: 'text', text: JSON.stringify(info, null, 2) }],
        };
    });
}
// ── site_health_check ──────────────────────────────────────────────────
function handleSiteHealthCheck(config) {
    return __awaiter(this, void 0, void 0, function* () {
        const checks = [];
        // 1. Database connectivity (via WP-CLI)
        if (config.wpCliBin && (0, fs_1.existsSync)(config.wpCliBin)) {
            try {
                const wpCliArgs = [];
                if (config.dbSocket) {
                    wpCliArgs.push('-d', `mysqli.default_socket=${config.dbSocket}`);
                    wpCliArgs.push('-d', `pdo_mysql.default_socket=${config.dbSocket}`);
                }
                wpCliArgs.push(config.wpCliBin, 'db', 'check', `--path=${config.wpPath}`, '--skip-themes', '--skip-plugins');
                yield execFileAsync(config.phpBin, wpCliArgs, { cwd: config.wpPath, timeout: 15000, env: wpCliEnv(config) });
                const countArgs = [];
                if (config.dbSocket) {
                    countArgs.push('-d', `mysqli.default_socket=${config.dbSocket}`);
                    countArgs.push('-d', `pdo_mysql.default_socket=${config.dbSocket}`);
                }
                countArgs.push(config.wpCliBin, 'db', 'query', 'SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()', '--skip-column-names', `--path=${config.wpPath}`, '--skip-themes', '--skip-plugins');
                const { stdout: countOut } = yield execFileAsync(config.phpBin, countArgs, { cwd: config.wpPath, timeout: 15000, env: wpCliEnv(config) });
                const tableCount = parseInt(countOut.trim(), 10) || 0;
                checks.push({
                    check: 'Database connectivity',
                    status: 'ok',
                    details: `Connected successfully. ${tableCount} tables in ${config.dbName}.`,
                });
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                checks.push({
                    check: 'Database connectivity',
                    status: 'error',
                    details: `Connection failed: ${msg}`,
                });
            }
        }
        else {
            checks.push({
                check: 'Database connectivity',
                status: 'warning',
                details: 'WP-CLI not available — cannot test database connectivity.',
            });
        }
        // 2. File permissions on key directories
        const keyDirs = [
            { label: 'wp-content', path: path.join(config.wpPath, 'wp-content') },
            { label: 'wp-content/uploads', path: path.join(config.wpPath, 'wp-content', 'uploads') },
            { label: 'wp-content/plugins', path: path.join(config.wpPath, 'wp-content', 'plugins') },
            { label: 'wp-content/themes', path: path.join(config.wpPath, 'wp-content', 'themes') },
        ];
        for (const dir of keyDirs) {
            if (!(0, fs_1.existsSync)(dir.path)) {
                checks.push({
                    check: `File permissions: ${dir.label}`,
                    status: 'warning',
                    details: `Directory does not exist: ${dir.path}`,
                });
                continue;
            }
            try {
                yield (0, promises_1.access)(dir.path, promises_1.constants.R_OK | promises_1.constants.W_OK);
                checks.push({
                    check: `File permissions: ${dir.label}`,
                    status: 'ok',
                    details: 'Readable and writable.',
                });
            }
            catch (_a) {
                checks.push({
                    check: `File permissions: ${dir.label}`,
                    status: 'error',
                    details: `Not writable: ${dir.path}`,
                });
            }
        }
        // 3. WP_DEBUG status
        const wpConfigPath = path.join(config.wpPath, 'wp-config.php');
        if ((0, fs_1.existsSync)(wpConfigPath)) {
            try {
                const configContent = yield (0, promises_1.readFile)(wpConfigPath, 'utf-8');
                const debugMatch = configContent.match(/define\s*\(\s*['"]WP_DEBUG['"]\s*,\s*([^)]+?)\s*\)/);
                const debugValue = debugMatch ? debugMatch[1].trim() : 'not defined';
                const isEnabled = /true/i.test(debugValue);
                checks.push({
                    check: 'WP_DEBUG',
                    status: isEnabled ? 'warning' : 'ok',
                    details: `WP_DEBUG is ${debugValue}${isEnabled ? ' (consider disabling in production)' : ''}.`,
                });
            }
            catch (_b) {
                checks.push({
                    check: 'WP_DEBUG',
                    status: 'warning',
                    details: 'Could not read wp-config.php.',
                });
            }
        }
        // 4. Log file sizes
        const logFiles = [
            { label: 'PHP error log', path: path.join(config.logPath, 'php', 'error.log') },
            { label: 'WP debug log', path: path.join(config.wpPath, 'wp-content', 'debug.log') },
            { label: 'Nginx access log', path: path.join(config.logPath, 'nginx', 'access.log') },
            { label: 'Nginx error log', path: path.join(config.logPath, 'nginx', 'error.log') },
        ];
        for (const log of logFiles) {
            if (!(0, fs_1.existsSync)(log.path)) {
                checks.push({
                    check: `Log: ${log.label}`,
                    status: 'ok',
                    details: 'Not present.',
                });
                continue;
            }
            try {
                const logStat = yield (0, promises_1.stat)(log.path);
                const sizeMb = logStat.size / (1024 * 1024);
                if (sizeMb > 100) {
                    checks.push({
                        check: `Log: ${log.label}`,
                        status: 'warning',
                        details: `Large log file: ${sizeMb.toFixed(1)} MB. Consider rotating or truncating.`,
                    });
                }
                else {
                    checks.push({
                        check: `Log: ${log.label}`,
                        status: 'ok',
                        details: `${sizeMb.toFixed(1)} MB`,
                    });
                }
            }
            catch (_c) {
                checks.push({
                    check: `Log: ${log.label}`,
                    status: 'warning',
                    details: `Cannot stat file: ${log.path}`,
                });
            }
        }
        // 5. PHP version
        try {
            const { stdout } = yield execFileAsync(config.phpBin, ['-v'], { timeout: 5000 });
            const phpVersionMatch = stdout.match(/PHP\s+([\d.]+)/);
            const phpVersion = phpVersionMatch ? phpVersionMatch[1] : 'unknown';
            const major = parseInt(phpVersion.split('.')[0] || '0', 10);
            const minor = parseInt(phpVersion.split('.')[1] || '0', 10);
            if (major < 8 || (major === 8 && minor < 1)) {
                checks.push({
                    check: 'PHP version',
                    status: 'warning',
                    details: `PHP ${phpVersion} — WordPress recommends PHP 8.1+.`,
                });
            }
            else {
                checks.push({
                    check: 'PHP version',
                    status: 'ok',
                    details: `PHP ${phpVersion}`,
                });
            }
        }
        catch (_d) {
            checks.push({
                check: 'PHP version',
                status: 'error',
                details: `Cannot execute PHP binary at: ${config.phpBin}`,
            });
        }
        // 6. wp-config.php exists
        checks.push({
            check: 'wp-config.php',
            status: (0, fs_1.existsSync)(wpConfigPath) ? 'ok' : 'error',
            details: (0, fs_1.existsSync)(wpConfigPath) ? 'Present.' : `Not found at: ${wpConfigPath}`,
        });
        const errors = checks.filter((c) => c.status === 'error').length;
        const warnings = checks.filter((c) => c.status === 'warning').length;
        const summary = errors > 0
            ? `${errors} error(s), ${warnings} warning(s)`
            : warnings > 0
                ? `${warnings} warning(s), no errors`
                : 'All checks passed';
        return {
            content: [{ type: 'text', text: JSON.stringify({ summary, checks }, null, 2) }],
        };
    });
}
//# sourceMappingURL=site.js.map