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
exports.default = default_1;
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const fs = __importStar(require("fs-extra"));
const net = __importStar(require("net"));
const LocalMain = __importStar(require("@getflywheel/local/main"));
const child_process_1 = require("child_process");
const paths_1 = require("./helpers/paths");
/** The key we use inside any mcpServers object to identify our entry */
const MCP_SERVER_KEY = 'local-wp';
const AGENT_TARGETS = {
    claude: {
        label: 'Claude Code',
        mcpConfigPath: '.mcp.json',
        contextFilePath: 'CLAUDE.md',
        supportsSkills: true,
        gitignoreEntries: ['.agent-tools/', '.mcp.json', 'CLAUDE.md'],
    },
    cursor: {
        label: 'Cursor',
        mcpConfigPath: path.join('.cursor', 'mcp.json'),
        contextFilePath: '.cursorrules',
        supportsSkills: false,
        gitignoreEntries: ['.cursorrules'],
    },
    windsurf: {
        label: 'Windsurf',
        mcpConfigPath: path.join('.windsurf', 'mcp.json'),
        contextFilePath: '.windsurfrules',
        supportsSkills: false,
        gitignoreEntries: ['.windsurfrules'],
    },
    vscode: {
        label: 'VS Code Copilot',
        mcpConfigPath: path.join('.vscode', 'mcp.json'),
        contextFilePath: path.join('.github', 'copilot-instructions.md'),
        supportsSkills: false,
        gitignoreEntries: [],
    },
};
// Marker comments used in .gitignore and context files so we can identify our content
const GITIGNORE_MARKER_START = '# >>> Agent Tools (auto-generated, do not edit)';
const GITIGNORE_MARKER_END = '# <<< Agent Tools';
const CONTEXT_MARKER_START = '<!-- >>> Agent Tools (auto-generated, do not edit) -->';
const CONTEXT_MARKER_END = '<!-- <<< Agent Tools -->';
// Skills that the add-on manages — used for selective cleanup
const MANAGED_SKILLS = [
    'wp-debugger',
    'wp-db-explorer',
];
// ---------------------------------------------------------------------------
// Bridge Server Constants & Types
// ---------------------------------------------------------------------------
const BRIDGE_SOCKET_PATH = process.platform === 'win32'
    ? '\\\\.\\pipe\\local-agent-tools-bridge'
    : '/tmp/local-agent-tools-bridge.sock';
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getSitePath(site) {
    const rawPath = site.longPath || site.path;
    return (0, paths_1.resolveSitePath)(rawPath);
}
function getProjectPath(sitePath, projectDir) {
    if (!projectDir)
        return sitePath;
    return path.join(sitePath, projectDir);
}
function getStoredProjectDir(site) {
    var _a;
    return ((_a = site.customOptions) === null || _a === void 0 ? void 0 : _a.agentToolsProjectDir) || '';
}
function getStoredAgents(site) {
    var _a, _b;
    const stored = (_a = site.customOptions) === null || _a === void 0 ? void 0 : _a.agentToolsAgents;
    if (Array.isArray(stored) && stored.length > 0)
        return stored;
    // Migration: old sites that were enabled before multi-agent support default to claude
    if ((_b = site.customOptions) === null || _b === void 0 ? void 0 : _b.agentToolsEnabled)
        return ['claude'];
    return [];
}
function getBundledPath() {
    return path.join(__dirname, '..', 'bundled');
}
function execCommand(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        (0, child_process_1.execFile)(command, args, {
            cwd: options.cwd,
            env: Object.assign(Object.assign({}, process.env), options.env),
            maxBuffer: 10 * 1024 * 1024,
        }, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(`Command failed: ${command} ${args.join(' ')}\n${stderr || error.message}`));
            }
            else {
                resolve(stdout);
            }
        });
    });
}
function isAgentToolsEnabled(site) {
    var _a;
    return !!((_a = site.customOptions) === null || _a === void 0 ? void 0 : _a.agentToolsEnabled);
}
function getNpmExtraPaths() {
    if (process.platform === 'win32') {
        const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
        return [
            path.join(appData, 'npm'),
            'C:\\Program Files\\nodejs',
            'C:\\Program Files (x86)\\nodejs',
        ];
    }
    return [
        '/usr/local/bin',
        '/opt/homebrew/bin',
        '/usr/bin',
        '/snap/bin',
    ];
}
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
// ---------------------------------------------------------------------------
// MCP Config — Safe Merge
// ---------------------------------------------------------------------------
/**
 * Builds our MCP server entry (the value, not the whole config file).
 */
function buildMcpServerEntry(site) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j;
        const sitePath = getSitePath(site);
        const siteId = site.id;
        const phpVersion = ((_b = (_a = site.services) === null || _a === void 0 ? void 0 : _a.php) === null || _b === void 0 ? void 0 : _b.version) || '';
        const mysqlService = ((_c = site.services) === null || _c === void 0 ? void 0 : _c.mysql) || ((_d = site.services) === null || _d === void 0 ? void 0 : _d.mariadb);
        const mysqlVersion = (mysqlService === null || mysqlService === void 0 ? void 0 : mysqlService.version) || '';
        const mysqlServiceName = (mysqlService === null || mysqlService === void 0 ? void 0 : mysqlService.name) || 'mysql';
        const phpBin = yield (0, paths_1.findPhpBinary)(phpVersion);
        const mysqlBin = yield (0, paths_1.findMysqlBinary)(mysqlVersion, mysqlServiceName);
        const mysqlSocket = (0, paths_1.findMysqlSocket)(siteId);
        const wpCliBin = yield (0, paths_1.findWpCli)(phpVersion);
        const mysqlPort = (_f = (_e = mysqlService === null || mysqlService === void 0 ? void 0 : mysqlService.ports) === null || _e === void 0 ? void 0 : _e.MYSQL) === null || _f === void 0 ? void 0 : _f[0];
        const domain = site.domain || '';
        const siteUrl = `https://${domain}`;
        const env = {
            SITE_PATH: sitePath,
            SITE_ID: siteId,
            WP_PATH: path.join(sitePath, 'app', 'public'),
            DB_NAME: ((_g = site.mysql) === null || _g === void 0 ? void 0 : _g.database) || 'local',
            DB_USER: ((_h = site.mysql) === null || _h === void 0 ? void 0 : _h.user) || 'root',
            DB_PASSWORD: ((_j = site.mysql) === null || _j === void 0 ? void 0 : _j.password) || 'root',
            SITE_DOMAIN: domain,
            SITE_URL: siteUrl,
            LOG_PATH: path.join(sitePath, 'logs'),
            BRIDGE_SOCKET: BRIDGE_SOCKET_PATH,
        };
        if (mysqlSocket)
            env.DB_SOCKET = mysqlSocket;
        if (mysqlPort) {
            env.DB_PORT = String(mysqlPort);
            env.DB_HOST = '127.0.0.1';
        }
        else if (process.platform === 'win32') {
            env.DB_HOST = '127.0.0.1';
        }
        if (phpBin)
            env.PHP_BIN = phpBin;
        if (mysqlBin)
            env.MYSQL_BIN = mysqlBin;
        if (wpCliBin)
            env.WP_CLI_BIN = wpCliBin;
        return {
            command: 'node',
            args: [path.join(sitePath, '.agent-tools', 'mcp-server', 'build', 'index.js')],
            env,
        };
    });
}
/**
 * Safely merges our MCP server entry into an existing MCP config file.
 * Creates the file (and parent directories) if it doesn't exist.
 * Preserves all other entries in the file.
 */
function mergeMcpConfig(configPath, serverEntry) {
    return __awaiter(this, void 0, void 0, function* () {
        let existing = {};
        if (yield fs.pathExists(configPath)) {
            try {
                existing = yield fs.readJSON(configPath);
            }
            catch (_a) {
                // File exists but isn't valid JSON — back it up before overwriting
                const backupPath = configPath + '.backup';
                yield fs.copy(configPath, backupPath);
                console.warn(`[Agent Tools] Backed up invalid JSON at ${configPath} to ${backupPath}`);
                existing = {};
            }
        }
        if (!existing.mcpServers || typeof existing.mcpServers !== 'object') {
            existing.mcpServers = {};
        }
        existing.mcpServers[MCP_SERVER_KEY] = serverEntry;
        yield fs.ensureDir(path.dirname(configPath));
        yield fs.writeJSON(configPath, existing, { spaces: 2 });
    });
}
/**
 * Removes our MCP server entry from a config file.
 * If the file becomes empty (no other servers), deletes it.
 * If the file has other servers, leaves them intact.
 */
function removeMcpConfigEntry(configPath) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        if (!(yield fs.pathExists(configPath)))
            return;
        try {
            const existing = yield fs.readJSON(configPath);
            if ((_a = existing === null || existing === void 0 ? void 0 : existing.mcpServers) === null || _a === void 0 ? void 0 : _a[MCP_SERVER_KEY]) {
                delete existing.mcpServers[MCP_SERVER_KEY];
                if (Object.keys(existing.mcpServers).length === 0) {
                    // Check if there's anything else in the file besides mcpServers
                    const otherKeys = Object.keys(existing).filter(k => k !== 'mcpServers');
                    if (otherKeys.length === 0) {
                        yield fs.remove(configPath);
                        // Clean up empty parent dirs (e.g. .cursor/, .windsurf/, .vscode/)
                        yield removeEmptyParentDirs(configPath);
                        return;
                    }
                }
                yield fs.writeJSON(configPath, existing, { spaces: 2 });
            }
        }
        catch (_b) {
            // Can't parse the file — leave it alone
        }
    });
}
/**
 * Removes empty parent directories up to (but not including) the project root.
 * Only removes directories that we might have created (.cursor, .windsurf, .vscode, .github).
 */
function removeEmptyParentDirs(filePath) {
    return __awaiter(this, void 0, void 0, function* () {
        const managedDirs = ['.cursor', '.windsurf', '.vscode', '.github'];
        const dir = path.dirname(filePath);
        const dirName = path.basename(dir);
        if (!managedDirs.includes(dirName))
            return;
        try {
            const contents = yield fs.readdir(dir);
            if (contents.length === 0) {
                yield fs.remove(dir);
            }
        }
        catch (_a) { }
    });
}
// ---------------------------------------------------------------------------
// Project Context — Safe Merge with Markers
// ---------------------------------------------------------------------------
/**
 * Generates the project context content (the WordPress site info).
 */
function generateProjectContext(site) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f;
        const sitePath = getSitePath(site);
        const phpVersion = ((_b = (_a = site.services) === null || _a === void 0 ? void 0 : _a.php) === null || _b === void 0 ? void 0 : _b.version) || 'unknown';
        const mysqlService = ((_c = site.services) === null || _c === void 0 ? void 0 : _c.mysql) || ((_d = site.services) === null || _d === void 0 ? void 0 : _d.mariadb);
        const mysqlVersion = (mysqlService === null || mysqlService === void 0 ? void 0 : mysqlService.version) || 'unknown';
        const webServer = ((_e = site.services) === null || _e === void 0 ? void 0 : _e.nginx) ? 'nginx' : ((_f = site.services) === null || _f === void 0 ? void 0 : _f.apache) ? 'Apache' : 'unknown';
        const multiSite = site.multiSite;
        const multisiteType = multiSite === 'ms-subdomain' ? 'Yes (subdomain)' : multiSite === 'ms-subdirectory' ? 'Yes (subdirectory)' : 'No';
        let pluginsSection = '';
        let themeSection = '';
        let wpVersion = '';
        const wpCliBin = yield (0, paths_1.findWpCli)(phpVersion);
        const phpBin = yield (0, paths_1.findPhpBinary)(phpVersion);
        if (wpCliBin && phpBin) {
            const wpPath = path.join(sitePath, 'app', 'public');
            const wpCliEnv = Object.assign(Object.assign({}, process.env), { PHP: phpBin });
            const mysqlSocket = (0, paths_1.findMysqlSocket)(site.id);
            try {
                const isWpCliPhar = wpCliBin.endsWith('.phar');
                const wpCmd = isWpCliPhar ? phpBin : wpCliBin;
                const wpBaseArgs = isWpCliPhar
                    ? [wpCliBin, '--path=' + wpPath]
                    : ['--path=' + wpPath];
                if (mysqlSocket)
                    wpCliEnv.DB_SOCKET = mysqlSocket;
                try {
                    const versionOutput = yield execCommand(wpCmd, [...wpBaseArgs, 'core', 'version'], { cwd: wpPath, env: wpCliEnv });
                    wpVersion = versionOutput.trim();
                }
                catch ( /* site may not be running */_g) { /* site may not be running */ }
                try {
                    const pluginOutput = yield execCommand(wpCmd, [...wpBaseArgs, 'plugin', 'list', '--status=active', '--format=csv', '--fields=name,version'], { cwd: wpPath, env: wpCliEnv });
                    const lines = pluginOutput.trim().split('\n').slice(1);
                    if (lines.length > 0 && lines[0]) {
                        pluginsSection = '\n## Active Plugins\n' + lines.map(line => {
                            const [name, version] = line.split(',');
                            return `- ${name} ${version || ''}`.trim();
                        }).join('\n') + '\n';
                    }
                }
                catch ( /* site may not be running */_h) { /* site may not be running */ }
                try {
                    const themeOutput = yield execCommand(wpCmd, [...wpBaseArgs, 'theme', 'list', '--status=active', '--format=csv', '--fields=name,version'], { cwd: wpPath, env: wpCliEnv });
                    const lines = themeOutput.trim().split('\n').slice(1);
                    if (lines.length > 0 && lines[0]) {
                        themeSection = '\n## Active Theme\n' + lines.map(line => {
                            const [name, version] = line.split(',');
                            return `- ${name} ${version || ''}`.trim();
                        }).join('\n') + '\n';
                    }
                }
                catch ( /* site may not be running */_j) { /* site may not be running */ }
            }
            catch (_k) {
                // WP-CLI calls may fail if the site isn't started
            }
        }
        const wpVersionLine = wpVersion ? `- WordPress: ${wpVersion}` : '- WordPress: (start site to detect)';
        return `# WordPress Site: ${site.name}

This is a WordPress site managed by Local.

## Environment
- PHP: ${phpVersion}
- MySQL: ${mysqlVersion}
- Web Server: ${webServer}
${wpVersionLine}
- Site URL: https://${site.domain}
- Multisite: ${multisiteType}
${pluginsSection}${themeSection}
## File Structure
- Site root: ${sitePath}
- WordPress root: app/public/
- Theme files: app/public/wp-content/themes/
- Plugin files: app/public/wp-content/plugins/
- Uploads: app/public/wp-content/uploads/
- Logs: logs/
- Local config: conf/

## MCP Tools Available
This project has a Local MCP server configured.
You can use the following tools to interact with the site:

- **db_query** — Run SQL queries against the WordPress database
- **db_table_info** — List database tables with schemas and row counts
- **wp_cli** — Run any WP-CLI command
- **read_error_log** — Read and parse the PHP error log
- **read_access_log** — Read the web server access log
- **read_wp_config** — Parse wp-config.php constants
- **edit_wp_config** — Modify wp-config.php constants safely
- **get_site_info** — Get site metadata and environment info
- **site_health_check** — Run a comprehensive site health check
- **wp_debug_toggle** — Enable/disable WP_DEBUG and related constants
- **db_export** — Export the database as a SQL file

## Notes
- The database credentials are pre-configured in the MCP server environment.
- WP-CLI commands run with the site's PHP version.
- This file was auto-generated by the "Agent Tools" add-on. Regenerate it from Local if your site configuration changes.
`;
    });
}
/**
 * Writes project context to a file. For CLAUDE.md (which we fully own),
 * we write the whole file. For shared context files (.cursorrules, etc.),
 * we use markers to manage only our section.
 */
function writeContextFile(filePath, content, agent) {
    return __awaiter(this, void 0, void 0, function* () {
        if (agent === 'claude') {
            // CLAUDE.md — we own this file entirely
            yield fs.ensureDir(path.dirname(filePath));
            yield fs.writeFile(filePath, content, 'utf-8');
            return;
        }
        // For other agents, use marked sections to avoid overwriting user content
        const markedContent = `${CONTEXT_MARKER_START}\n${content}\n${CONTEXT_MARKER_END}`;
        yield fs.ensureDir(path.dirname(filePath));
        if (yield fs.pathExists(filePath)) {
            let existing = yield fs.readFile(filePath, 'utf-8');
            // Check if we already have a marked section — update it
            const markerRegex = new RegExp(`${escapeRegex(CONTEXT_MARKER_START)}[\\s\\S]*?${escapeRegex(CONTEXT_MARKER_END)}`, 'g');
            if (markerRegex.test(existing)) {
                existing = existing.replace(markerRegex, markedContent);
                yield fs.writeFile(filePath, existing, 'utf-8');
            }
            else {
                // Append our section
                const separator = existing.endsWith('\n') ? '\n' : '\n\n';
                yield fs.writeFile(filePath, existing + separator + markedContent + '\n', 'utf-8');
            }
        }
        else {
            yield fs.writeFile(filePath, markedContent + '\n', 'utf-8');
        }
    });
}
/**
 * Removes our marked section from a context file.
 * For CLAUDE.md, removes the whole file (we own it).
 * For other files, removes only our marked section.
 * If the file becomes empty after removal, deletes it.
 */
function removeContextFile(filePath, agent) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!(yield fs.pathExists(filePath)))
            return;
        if (agent === 'claude') {
            yield fs.remove(filePath);
            return;
        }
        let content = yield fs.readFile(filePath, 'utf-8');
        const markerRegex = new RegExp(`\\n?${escapeRegex(CONTEXT_MARKER_START)}[\\s\\S]*?${escapeRegex(CONTEXT_MARKER_END)}\\n?`, 'g');
        content = content.replace(markerRegex, '');
        const trimmed = content.trim();
        if (!trimmed) {
            yield fs.remove(filePath);
            yield removeEmptyParentDirs(filePath);
        }
        else {
            yield fs.writeFile(filePath, content, 'utf-8');
        }
    });
}
// ---------------------------------------------------------------------------
// Gitignore — aggregate entries from all active agents
// ---------------------------------------------------------------------------
function buildGitignoreEntries(agents) {
    const entries = new Set();
    // Always include .agent-tools/ if any agent is enabled (MCP server lives there)
    entries.add('.agent-tools/');
    for (const agent of agents) {
        const config = AGENT_TARGETS[agent];
        for (const entry of config.gitignoreEntries) {
            entries.add(entry);
        }
    }
    return Array.from(entries);
}
function updateGitignore(dirPath, agents) {
    return __awaiter(this, void 0, void 0, function* () {
        const gitignorePath = path.join(dirPath, '.gitignore');
        let content = '';
        if (yield fs.pathExists(gitignorePath)) {
            content = yield fs.readFile(gitignorePath, 'utf-8');
        }
        // Remove existing marked block
        const markerRegex = new RegExp(`\\n?${escapeRegex(GITIGNORE_MARKER_START)}[\\s\\S]*?${escapeRegex(GITIGNORE_MARKER_END)}\\n?`, 'g');
        content = content.replace(markerRegex, '');
        if (agents.length > 0) {
            const entries = buildGitignoreEntries(agents);
            const block = [
                '',
                GITIGNORE_MARKER_START,
                ...entries,
                GITIGNORE_MARKER_END,
                '',
            ].join('\n');
            content = content.trimEnd() + '\n' + block;
        }
        yield fs.writeFile(gitignorePath, content, 'utf-8');
    });
}
// ---------------------------------------------------------------------------
// Core Functions
// ---------------------------------------------------------------------------
/**
 * Sets up Agent Tools for a site with the specified agent targets.
 */
function setupSite(site, notifier, projectDir, agents) {
    return __awaiter(this, void 0, void 0, function* () {
        const sitePath = getSitePath(site);
        const projectPath = getProjectPath(sitePath, projectDir);
        notifier.notify({
            title: 'Agent Tools',
            message: `Setting up Agent Tools for "${site.name}"...`,
            open: undefined,
        });
        // 1. Copy MCP server to site root (always at site root, shared by all agents)
        const mcpServerSrc = path.join(getBundledPath(), 'mcp-server');
        const mcpServerDest = path.join(sitePath, '.agent-tools', 'mcp-server');
        yield fs.remove(mcpServerDest);
        yield fs.ensureDir(mcpServerDest);
        yield fs.copy(mcpServerSrc, mcpServerDest, {
            filter: (src) => {
                const relativePath = path.relative(mcpServerSrc, src);
                return !relativePath.startsWith('node_modules');
            },
        });
        // 2. Build the MCP server entry once (same for all agents)
        const serverEntry = yield buildMcpServerEntry(site);
        // 3. Generate project context once (same content for all agents)
        const contextContent = yield generateProjectContext(site);
        // 4. For each selected agent, write configs
        for (const agent of agents) {
            const config = AGENT_TARGETS[agent];
            // Write MCP config (merge into existing)
            const mcpConfigPath = path.join(projectPath, config.mcpConfigPath);
            yield mergeMcpConfig(mcpConfigPath, serverEntry);
            // Write project context
            const contextPath = path.join(projectPath, config.contextFilePath);
            yield writeContextFile(contextPath, contextContent, agent);
            // Copy skills if supported
            if (config.supportsSkills) {
                const skillsSrc = path.join(getBundledPath(), 'skills');
                const skillsDest = path.join(projectPath, '.claude', 'skills');
                yield fs.ensureDir(skillsDest);
                for (const skillName of MANAGED_SKILLS) {
                    const skillSrcDir = path.join(skillsSrc, skillName);
                    const skillDestDir = path.join(skillsDest, skillName);
                    if (yield fs.pathExists(skillSrcDir)) {
                        yield fs.copy(skillSrcDir, skillDestDir, { overwrite: true });
                    }
                }
            }
        }
        // 5. Update .gitignore
        yield updateGitignore(projectPath, agents);
        // 6. Run npm install --production in the MCP server directory
        try {
            const npmExtraPaths = getNpmExtraPaths();
            const pathSep = process.platform === 'win32' ? ';' : ':';
            const augmentedPath = npmExtraPaths.join(pathSep) + pathSep + (process.env.PATH || '');
            yield new Promise((resolve, reject) => {
                (0, child_process_1.exec)('npm install --production', {
                    cwd: mcpServerDest,
                    env: Object.assign(Object.assign({}, process.env), { PATH: augmentedPath }),
                    timeout: 60000,
                }, (error, _stdout, stderr) => {
                    if (error) {
                        reject(new Error(stderr || error.message));
                    }
                    else {
                        resolve();
                    }
                });
            });
        }
        catch (err) {
            console.error('[Agent Tools] npm install failed:', err);
            notifier.notify({
                title: 'Agent Tools',
                message: `Warning: npm install failed in MCP server directory. You may need to run it manually.`,
                open: undefined,
            });
        }
        // 7. Store state
        LocalMain.SiteData.updateSite(site.id, {
            customOptions: Object.assign(Object.assign({}, site.customOptions), { agentToolsEnabled: true, agentToolsProjectDir: projectDir, agentToolsAgents: agents }),
        });
        const agentLabels = agents.map(a => AGENT_TARGETS[a].label).join(', ');
        notifier.notify({
            title: 'Agent Tools',
            message: `Agent Tools enabled for "${site.name}" (${agentLabels}).`,
            open: undefined,
        });
    });
}
function teardownSite(site, notifier) {
    return __awaiter(this, void 0, void 0, function* () {
        const sitePath = getSitePath(site);
        const projectDir = getStoredProjectDir(site);
        const projectPath = getProjectPath(sitePath, projectDir);
        const agents = getStoredAgents(site);
        // 1. Remove .agent-tools/ directory from site root
        yield fs.remove(path.join(sitePath, '.agent-tools'));
        // 2. For each agent, remove our config entries
        for (const agent of agents) {
            const config = AGENT_TARGETS[agent];
            // Remove MCP config entry (not the whole file)
            yield removeMcpConfigEntry(path.join(projectPath, config.mcpConfigPath));
            // Remove context file / our section
            yield removeContextFile(path.join(projectPath, config.contextFilePath), agent);
            // Remove managed skills if applicable
            if (config.supportsSkills) {
                for (const skillName of MANAGED_SKILLS) {
                    yield fs.remove(path.join(projectPath, '.claude', 'skills', skillName));
                }
                // Clean up empty directories (only if we emptied them)
                const skillsDir = path.join(projectPath, '.claude', 'skills');
                try {
                    const remaining = yield fs.readdir(skillsDir);
                    if (remaining.length === 0)
                        yield fs.remove(skillsDir);
                }
                catch ( /* directory may not exist */_a) { /* directory may not exist */ }
                const claudeDir = path.join(projectPath, '.claude');
                try {
                    const remaining = yield fs.readdir(claudeDir);
                    if (remaining.length === 0)
                        yield fs.remove(claudeDir);
                }
                catch ( /* directory may not exist */_b) { /* directory may not exist */ }
            }
        }
        // 3. Clean up .gitignore
        yield updateGitignore(projectPath, []);
        // 4. Unmark site
        const customOptions = Object.assign({}, site.customOptions);
        delete customOptions.agentToolsEnabled;
        delete customOptions.agentToolsProjectDir;
        delete customOptions.agentToolsAgents;
        LocalMain.SiteData.updateSite(site.id, { customOptions });
        notifier.notify({
            title: 'Agent Tools',
            message: `Agent Tools disabled for "${site.name}".`,
            open: undefined,
        });
    });
}
function changeProjectDir(site, newProjectDir, notifier) {
    return __awaiter(this, void 0, void 0, function* () {
        const sitePath = getSitePath(site);
        const oldProjectDir = getStoredProjectDir(site);
        const oldPath = getProjectPath(sitePath, oldProjectDir);
        const newPath = getProjectPath(sitePath, newProjectDir);
        const agents = getStoredAgents(site);
        if (oldPath === newPath)
            return;
        // Remove configs from old location
        for (const agent of agents) {
            const config = AGENT_TARGETS[agent];
            yield removeMcpConfigEntry(path.join(oldPath, config.mcpConfigPath));
            yield removeContextFile(path.join(oldPath, config.contextFilePath), agent);
            if (config.supportsSkills) {
                for (const skillName of MANAGED_SKILLS) {
                    yield fs.remove(path.join(oldPath, '.claude', 'skills', skillName));
                }
                const oldSkillsDir = path.join(oldPath, '.claude', 'skills');
                try {
                    const remaining = yield fs.readdir(oldSkillsDir);
                    if (remaining.length === 0)
                        yield fs.remove(oldSkillsDir);
                }
                catch (_a) { }
                const oldClaudeDir = path.join(oldPath, '.claude');
                try {
                    const remaining = yield fs.readdir(oldClaudeDir);
                    if (remaining.length === 0)
                        yield fs.remove(oldClaudeDir);
                }
                catch (_b) { }
            }
        }
        yield updateGitignore(oldPath, []);
        // Write configs to new location
        const serverEntry = yield buildMcpServerEntry(site);
        const contextContent = yield generateProjectContext(site);
        for (const agent of agents) {
            const config = AGENT_TARGETS[agent];
            yield mergeMcpConfig(path.join(newPath, config.mcpConfigPath), serverEntry);
            yield writeContextFile(path.join(newPath, config.contextFilePath), contextContent, agent);
            if (config.supportsSkills) {
                const skillsSrc = path.join(getBundledPath(), 'skills');
                const skillsDest = path.join(newPath, '.claude', 'skills');
                yield fs.ensureDir(skillsDest);
                for (const skillName of MANAGED_SKILLS) {
                    const skillSrcDir = path.join(skillsSrc, skillName);
                    const skillDestDir = path.join(skillsDest, skillName);
                    if (yield fs.pathExists(skillSrcDir)) {
                        yield fs.copy(skillSrcDir, skillDestDir, { overwrite: true });
                    }
                }
            }
        }
        yield updateGitignore(newPath, agents);
        // Update stored preference
        LocalMain.SiteData.updateSite(site.id, {
            customOptions: Object.assign(Object.assign({}, site.customOptions), { agentToolsProjectDir: newProjectDir }),
        });
        notifier.notify({
            title: 'Agent Tools',
            message: `Project directory changed to "${newProjectDir || 'site root'}" for "${site.name}".`,
            open: undefined,
        });
    });
}
/**
 * Updates which agents are configured for an already-enabled site.
 * Adds configs for newly selected agents, removes configs for deselected ones.
 */
function updateAgents(site, newAgents, notifier) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!isAgentToolsEnabled(site))
            return;
        const sitePath = getSitePath(site);
        const projectDir = getStoredProjectDir(site);
        const projectPath = getProjectPath(sitePath, projectDir);
        const oldAgents = getStoredAgents(site);
        const added = newAgents.filter(a => !oldAgents.includes(a));
        const removed = oldAgents.filter(a => !newAgents.includes(a));
        // Remove configs for deselected agents
        for (const agent of removed) {
            const config = AGENT_TARGETS[agent];
            yield removeMcpConfigEntry(path.join(projectPath, config.mcpConfigPath));
            yield removeContextFile(path.join(projectPath, config.contextFilePath), agent);
            if (config.supportsSkills) {
                for (const skillName of MANAGED_SKILLS) {
                    yield fs.remove(path.join(projectPath, '.claude', 'skills', skillName));
                }
                const skillsDir = path.join(projectPath, '.claude', 'skills');
                try {
                    const remaining = yield fs.readdir(skillsDir);
                    if (remaining.length === 0)
                        yield fs.remove(skillsDir);
                }
                catch (_a) { }
                const claudeDir = path.join(projectPath, '.claude');
                try {
                    const remaining = yield fs.readdir(claudeDir);
                    if (remaining.length === 0)
                        yield fs.remove(claudeDir);
                }
                catch (_b) { }
            }
        }
        // Add configs for newly selected agents
        if (added.length > 0) {
            const serverEntry = yield buildMcpServerEntry(site);
            const contextContent = yield generateProjectContext(site);
            for (const agent of added) {
                const config = AGENT_TARGETS[agent];
                yield mergeMcpConfig(path.join(projectPath, config.mcpConfigPath), serverEntry);
                yield writeContextFile(path.join(projectPath, config.contextFilePath), contextContent, agent);
                if (config.supportsSkills) {
                    const skillsSrc = path.join(getBundledPath(), 'skills');
                    const skillsDest = path.join(projectPath, '.claude', 'skills');
                    yield fs.ensureDir(skillsDest);
                    for (const skillName of MANAGED_SKILLS) {
                        const skillSrcDir = path.join(skillsSrc, skillName);
                        const skillDestDir = path.join(skillsDest, skillName);
                        if (yield fs.pathExists(skillSrcDir)) {
                            yield fs.copy(skillSrcDir, skillDestDir, { overwrite: true });
                        }
                    }
                }
            }
        }
        // Update .gitignore with new agent set
        yield updateGitignore(projectPath, newAgents);
        // Store updated agents
        LocalMain.SiteData.updateSite(site.id, {
            customOptions: Object.assign(Object.assign({}, site.customOptions), { agentToolsAgents: newAgents }),
        });
        const agentLabels = newAgents.map(a => AGENT_TARGETS[a].label).join(', ');
        notifier.notify({
            title: 'Agent Tools',
            message: `Updated agents for "${site.name}" (${agentLabels}).`,
            open: undefined,
        });
    });
}
function regenerateConfig(site) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!isAgentToolsEnabled(site))
            return;
        const sitePath = getSitePath(site);
        const projectDir = getStoredProjectDir(site);
        const projectPath = getProjectPath(sitePath, projectDir);
        const agents = getStoredAgents(site);
        const serverEntry = yield buildMcpServerEntry(site);
        const contextContent = yield generateProjectContext(site);
        for (const agent of agents) {
            const config = AGENT_TARGETS[agent];
            yield mergeMcpConfig(path.join(projectPath, config.mcpConfigPath), serverEntry);
            yield writeContextFile(path.join(projectPath, config.contextFilePath), contextContent, agent);
        }
    });
}
function getStatus(site) {
    return __awaiter(this, void 0, void 0, function* () {
        const sitePath = getSitePath(site);
        const enabled = isAgentToolsEnabled(site);
        const projectDir = getStoredProjectDir(site);
        const agents = getStoredAgents(site);
        const mcpServerInstalled = yield fs.pathExists(path.join(sitePath, '.agent-tools', 'mcp-server', 'node_modules'));
        // Check if any MCP config exists
        const projectPath = getProjectPath(sitePath, projectDir);
        let configExists = false;
        for (const agent of agents) {
            const config = AGENT_TARGETS[agent];
            if (yield fs.pathExists(path.join(projectPath, config.mcpConfigPath))) {
                configExists = true;
                break;
            }
        }
        return {
            enabled,
            configExists,
            mcpServerInstalled,
            sitePath,
            projectDir,
            agents,
        };
    });
}
// ---------------------------------------------------------------------------
// Bridge Server
// ---------------------------------------------------------------------------
function handleBridgeRequest(request) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const serviceContainer = LocalMain.getServiceContainer();
            const siteProcessManager = serviceContainer.cradle.siteProcessManager;
            switch (request.action) {
                case 'list': {
                    const sites = LocalMain.SiteData.getSites();
                    const statuses = siteProcessManager.getSiteStatuses();
                    const siteList = Object.values(sites).map((site) => ({
                        id: site.id,
                        name: site.name,
                        domain: site.domain,
                        path: getSitePath(site),
                        status: statuses[site.id] || 'unknown',
                    }));
                    return { success: true, data: siteList };
                }
                case 'status': {
                    if (!request.siteId) {
                        return { success: false, error: 'siteId is required for status action' };
                    }
                    const site = LocalMain.SiteData.getSite(request.siteId);
                    if (!site) {
                        return { success: false, error: `Site not found: ${request.siteId}` };
                    }
                    const status = siteProcessManager.getSiteStatus(site);
                    return {
                        success: true,
                        data: {
                            id: site.id,
                            name: site.name,
                            domain: site.domain,
                            status,
                        },
                    };
                }
                case 'start': {
                    if (!request.siteId) {
                        return { success: false, error: 'siteId is required for start action' };
                    }
                    const site = LocalMain.SiteData.getSite(request.siteId);
                    if (!site) {
                        return { success: false, error: `Site not found: ${request.siteId}` };
                    }
                    const currentStatus = siteProcessManager.getSiteStatus(site);
                    if (currentStatus === 'running') {
                        return { success: true, data: { id: site.id, status: 'running', message: 'Site is already running' } };
                    }
                    yield siteProcessManager.start(site);
                    return {
                        success: true,
                        data: {
                            id: site.id,
                            name: site.name,
                            status: siteProcessManager.getSiteStatus(site),
                        },
                    };
                }
                case 'stop': {
                    if (!request.siteId) {
                        return { success: false, error: 'siteId is required for stop action' };
                    }
                    const site = LocalMain.SiteData.getSite(request.siteId);
                    if (!site) {
                        return { success: false, error: `Site not found: ${request.siteId}` };
                    }
                    const currentStatus = siteProcessManager.getSiteStatus(site);
                    if (currentStatus === 'halted') {
                        return { success: true, data: { id: site.id, status: 'halted', message: 'Site is already stopped' } };
                    }
                    yield siteProcessManager.stop(site);
                    return {
                        success: true,
                        data: {
                            id: site.id,
                            name: site.name,
                            status: siteProcessManager.getSiteStatus(site),
                        },
                    };
                }
                case 'restart': {
                    if (!request.siteId) {
                        return { success: false, error: 'siteId is required for restart action' };
                    }
                    const site = LocalMain.SiteData.getSite(request.siteId);
                    if (!site) {
                        return { success: false, error: `Site not found: ${request.siteId}` };
                    }
                    yield siteProcessManager.restart(site);
                    return {
                        success: true,
                        data: {
                            id: site.id,
                            name: site.name,
                            status: siteProcessManager.getSiteStatus(site),
                        },
                    };
                }
                default:
                    return { success: false, error: `Unknown action: ${request.action}` };
            }
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('[Agent Tools] Bridge request error:', message);
            return { success: false, error: message };
        }
    });
}
function startBridgeServer() {
    if (process.platform !== 'win32') {
        try {
            fs.removeSync(BRIDGE_SOCKET_PATH);
        }
        catch (_a) {
            // Ignore — file may not exist
        }
    }
    const server = net.createServer((socket) => {
        let buffer = '';
        socket.on('data', (chunk) => {
            buffer += chunk.toString();
            let newlineIdx;
            while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
                const raw = buffer.slice(0, newlineIdx).trim();
                buffer = buffer.slice(newlineIdx + 1);
                if (!raw)
                    continue;
                let request;
                try {
                    request = JSON.parse(raw);
                }
                catch (_a) {
                    const errResp = { success: false, error: 'Invalid JSON' };
                    socket.write(JSON.stringify(errResp) + '\n');
                    continue;
                }
                handleBridgeRequest(request)
                    .then((response) => {
                    if (!socket.destroyed) {
                        socket.write(JSON.stringify(response) + '\n');
                    }
                })
                    .catch((err) => {
                    if (!socket.destroyed) {
                        const errResp = {
                            success: false,
                            error: err instanceof Error ? err.message : String(err),
                        };
                        socket.write(JSON.stringify(errResp) + '\n');
                    }
                });
            }
        });
        socket.on('error', (err) => {
            console.error('[Agent Tools] Bridge socket connection error:', err.message);
        });
    });
    server.on('error', (err) => {
        console.error('[Agent Tools] Bridge server error:', err.message);
    });
    server.listen(BRIDGE_SOCKET_PATH, () => {
        console.log(`[Agent Tools] Bridge server listening on ${BRIDGE_SOCKET_PATH}`);
    });
    return server;
}
// ---------------------------------------------------------------------------
// Add-on Entry Point
// ---------------------------------------------------------------------------
function default_1(context) {
    const { notifier, electron } = context;
    const bridgeServer = startBridgeServer();
    electron.app.on('will-quit', () => {
        try {
            bridgeServer.close();
            if (process.platform !== 'win32') {
                fs.removeSync(BRIDGE_SOCKET_PATH);
            }
        }
        catch (_a) {
            // Best-effort cleanup
        }
    });
    electron.ipcMain.handle('agent-tools:enable-site', (_event, siteId, projectDir, agents) => __awaiter(this, void 0, void 0, function* () {
        try {
            const site = LocalMain.SiteData.getSite(siteId);
            yield setupSite(site, notifier, projectDir || '', agents);
            return { success: true };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('[Agent Tools] Enable failed:', message);
            notifier.notify({
                title: 'Agent Tools — Error',
                message: `Failed to enable Agent Tools: ${message}`,
                open: undefined,
            });
            return { success: false, error: message };
        }
    }));
    electron.ipcMain.handle('agent-tools:disable-site', (_event, siteId) => __awaiter(this, void 0, void 0, function* () {
        try {
            const site = LocalMain.SiteData.getSite(siteId);
            yield teardownSite(site, notifier);
            return { success: true };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('[Agent Tools] Disable failed:', message);
            return { success: false, error: message };
        }
    }));
    electron.ipcMain.handle('agent-tools:regenerate-config', (_event, siteId) => __awaiter(this, void 0, void 0, function* () {
        try {
            const site = LocalMain.SiteData.getSite(siteId);
            yield regenerateConfig(site);
            notifier.notify({
                title: 'Agent Tools',
                message: `Configuration regenerated for "${site.name}".`,
                open: undefined,
            });
            return { success: true };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('[Agent Tools] Regenerate failed:', message);
            return { success: false, error: message };
        }
    }));
    electron.ipcMain.handle('agent-tools:get-status', (_event, siteId) => __awaiter(this, void 0, void 0, function* () {
        try {
            const site = LocalMain.SiteData.getSite(siteId);
            return yield getStatus(site);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('[Agent Tools] Get status failed:', message);
            return { enabled: false, configExists: false, mcpServerInstalled: false, sitePath: '', projectDir: '', agents: [] };
        }
    }));
    electron.ipcMain.handle('agent-tools:update-agents', (_event, siteId, agents) => __awaiter(this, void 0, void 0, function* () {
        try {
            const site = LocalMain.SiteData.getSite(siteId);
            yield updateAgents(site, agents, notifier);
            return { success: true };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('[Agent Tools] Update agents failed:', message);
            return { success: false, error: message };
        }
    }));
    electron.ipcMain.handle('agent-tools:change-project-dir', (_event, siteId, newProjectDir) => __awaiter(this, void 0, void 0, function* () {
        try {
            const site = LocalMain.SiteData.getSite(siteId);
            yield changeProjectDir(site, newProjectDir || '', notifier);
            return { success: true };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('[Agent Tools] Change project dir failed:', message);
            return { success: false, error: message };
        }
    }));
    LocalMain.HooksMain.addAction('siteStarted', (site) => __awaiter(this, void 0, void 0, function* () {
        if (isAgentToolsEnabled(site)) {
            try {
                yield regenerateConfig(site);
                console.log(`[Agent Tools] Config regenerated for "${site.name}" on site start.`);
            }
            catch (err) {
                console.error('[Agent Tools] Failed to regenerate config on site start:', err);
            }
        }
    }));
}
//# sourceMappingURL=main.js.map