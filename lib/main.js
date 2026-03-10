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
const fs = __importStar(require("fs-extra"));
const LocalMain = __importStar(require("@getflywheel/local/main"));
const child_process_1 = require("child_process");
const paths_1 = require("./helpers/paths");
const site_config_1 = require("./helpers/site-config");
const port_1 = require("./helpers/port");
const mcp_server_1 = require("./mcp-server");
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
/** The key we use inside any mcpServers/servers object to identify our entry */
const MCP_SERVER_KEY = 'local-wp';
const AGENT_TARGETS = {
    claude: {
        label: 'Claude Code',
        mcpConfigPath: '.mcp.json',
        mcpConfigTopLevelKey: 'mcpServers',
        contextFilePath: 'CLAUDE.md',
        supportsSkills: true,
        gitignoreEntries: ['.mcp.json', 'CLAUDE.md'],
    },
    cursor: {
        label: 'Cursor',
        mcpConfigPath: path.join('.cursor', 'mcp.json'),
        mcpConfigTopLevelKey: 'mcpServers',
        contextFilePath: '.cursorrules',
        supportsSkills: false,
        gitignoreEntries: ['.cursorrules'],
    },
    windsurf: {
        label: 'Windsurf',
        mcpConfigPath: path.join('.windsurf', 'mcp.json'),
        mcpConfigTopLevelKey: 'mcpServers',
        contextFilePath: '.windsurfrules',
        supportsSkills: false,
        gitignoreEntries: ['.windsurfrules'],
    },
    vscode: {
        label: 'VS Code Copilot',
        mcpConfigPath: path.join('.vscode', 'mcp.json'),
        mcpConfigTopLevelKey: 'servers',
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
// Globals
// ---------------------------------------------------------------------------
const siteConfigRegistry = new site_config_1.SiteConfigRegistry();
let mcpServerPort = 0;
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
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
// ---------------------------------------------------------------------------
// SiteConfig Builder
// ---------------------------------------------------------------------------
function buildSiteConfig(site) {
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
        let dbHost = '';
        if (mysqlPort) {
            dbHost = '127.0.0.1';
        }
        else if (process.platform === 'win32') {
            dbHost = '127.0.0.1';
        }
        return {
            siteId,
            sitePath,
            wpPath: path.join(sitePath, 'app', 'public'),
            phpBin: phpBin || 'php',
            wpCliBin: wpCliBin || '',
            mysqlBin: mysqlBin || '',
            dbName: ((_g = site.mysql) === null || _g === void 0 ? void 0 : _g.database) || 'local',
            dbUser: ((_h = site.mysql) === null || _h === void 0 ? void 0 : _h.user) || 'root',
            dbPassword: ((_j = site.mysql) === null || _j === void 0 ? void 0 : _j.password) || 'root',
            dbSocket: mysqlSocket || null,
            dbPort: mysqlPort ? Number(mysqlPort) : 3306,
            dbHost,
            siteDomain: domain,
            siteUrl,
            logPath: path.join(sitePath, 'logs'),
        };
    });
}
// ---------------------------------------------------------------------------
// MCP Config — Per-Agent HTTP Format
// ---------------------------------------------------------------------------
/**
 * Builds the MCP server entry for a specific agent.
 * Each agent has different JSON shapes for HTTP MCP servers.
 */
function buildMcpServerEntry(agent, port, siteId) {
    const url = `http://localhost:${port}/sites/${siteId}/mcp`;
    switch (agent) {
        case 'claude':
            return { type: 'http', url };
        case 'cursor':
            return { url };
        case 'windsurf':
            return { serverUrl: url };
        case 'vscode':
            return { type: 'http', url };
    }
}
/**
 * Safely merges our MCP server entry into an existing MCP config file.
 * Creates the file (and parent directories) if it doesn't exist.
 * Preserves all other entries in the file.
 */
function mergeMcpConfig(configPath, serverEntry, topLevelKey) {
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
        if (!existing[topLevelKey] || typeof existing[topLevelKey] !== 'object') {
            existing[topLevelKey] = {};
        }
        existing[topLevelKey][MCP_SERVER_KEY] = serverEntry;
        yield fs.ensureDir(path.dirname(configPath));
        yield fs.writeJSON(configPath, existing, { spaces: 2 });
    });
}
/**
 * Removes our MCP server entry from a config file.
 * Handles both mcpServers and servers top-level keys.
 */
function removeMcpConfigEntry(configPath, topLevelKey) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        if (!(yield fs.pathExists(configPath)))
            return;
        try {
            const existing = yield fs.readJSON(configPath);
            if ((_a = existing === null || existing === void 0 ? void 0 : existing[topLevelKey]) === null || _a === void 0 ? void 0 : _a[MCP_SERVER_KEY]) {
                delete existing[topLevelKey][MCP_SERVER_KEY];
                if (Object.keys(existing[topLevelKey]).length === 0) {
                    const otherKeys = Object.keys(existing).filter(k => k !== topLevelKey);
                    if (otherKeys.length === 0) {
                        yield fs.remove(configPath);
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
 * Only removes directories that we might have created.
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

- **wp_cli** — Run any WP-CLI command (use this for database queries, imports, exports, search-replace, etc.)
- **read_error_log** — Read and parse the PHP error log
- **read_access_log** — Read the web server access log
- **read_wp_config** — Parse wp-config.php constants
- **edit_wp_config** — Modify wp-config.php constants safely
- **get_site_info** — Get site metadata and environment info
- **site_health_check** — Run a comprehensive site health check
- **wp_debug_toggle** — Enable/disable WP_DEBUG and related constants

## Notes
- WP-CLI commands run with the site's PHP version.
- For database operations, prefer WP-CLI commands (e.g. \`wp db query\`, \`wp db export\`, \`wp search-replace\`, \`wp option update\`).
- This file was auto-generated by the "Agent Tools" add-on. Regenerate it from Local if your site configuration changes.
`;
    });
}
function writeContextFile(filePath, content, agent) {
    return __awaiter(this, void 0, void 0, function* () {
        if (agent === 'claude') {
            yield fs.ensureDir(path.dirname(filePath));
            yield fs.writeFile(filePath, content, 'utf-8');
            return;
        }
        const markedContent = `${CONTEXT_MARKER_START}\n${content}\n${CONTEXT_MARKER_END}`;
        yield fs.ensureDir(path.dirname(filePath));
        if (yield fs.pathExists(filePath)) {
            let existing = yield fs.readFile(filePath, 'utf-8');
            const markerRegex = new RegExp(`${escapeRegex(CONTEXT_MARKER_START)}[\\s\\S]*?${escapeRegex(CONTEXT_MARKER_END)}`, 'g');
            if (markerRegex.test(existing)) {
                existing = existing.replace(markerRegex, markedContent);
                yield fs.writeFile(filePath, existing, 'utf-8');
            }
            else {
                const separator = existing.endsWith('\n') ? '\n' : '\n\n';
                yield fs.writeFile(filePath, existing + separator + markedContent + '\n', 'utf-8');
            }
        }
        else {
            yield fs.writeFile(filePath, markedContent + '\n', 'utf-8');
        }
    });
}
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
            if (entries.length > 0) {
                const block = [
                    '',
                    GITIGNORE_MARKER_START,
                    ...entries,
                    GITIGNORE_MARKER_END,
                    '',
                ].join('\n');
                content = content.trimEnd() + '\n' + block;
            }
        }
        yield fs.writeFile(gitignorePath, content, 'utf-8');
    });
}
// ---------------------------------------------------------------------------
// Core Functions
// ---------------------------------------------------------------------------
function setupSite(site, notifier, projectDir, agents) {
    return __awaiter(this, void 0, void 0, function* () {
        const sitePath = getSitePath(site);
        const projectPath = getProjectPath(sitePath, projectDir);
        notifier.notify({
            title: 'Agent Tools',
            message: `Setting up Agent Tools for "${site.name}"...`,
            open: undefined,
        });
        // 1. Build SiteConfig and register it
        const siteConfig = yield buildSiteConfig(site);
        siteConfigRegistry.register(siteConfig);
        // 2. Generate project context
        const contextContent = yield generateProjectContext(site);
        // 3. For each selected agent, write configs
        for (const agent of agents) {
            const agentConfig = AGENT_TARGETS[agent];
            // Write MCP config (HTTP format, per-agent shape)
            const mcpConfigPath = path.join(projectPath, agentConfig.mcpConfigPath);
            const serverEntry = buildMcpServerEntry(agent, mcpServerPort, site.id);
            yield mergeMcpConfig(mcpConfigPath, serverEntry, agentConfig.mcpConfigTopLevelKey);
            // Write project context
            const contextPath = path.join(projectPath, agentConfig.contextFilePath);
            yield writeContextFile(contextPath, contextContent, agent);
            // Copy skills if supported
            if (agentConfig.supportsSkills) {
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
        // 4. Update .gitignore
        yield updateGitignore(projectPath, agents);
        // 5. Store state
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
        // 1. Unregister from config registry and close MCP sessions
        siteConfigRegistry.unregister(site.id);
        (0, mcp_server_1.closeSessionsForSite)(site.id);
        // 2. Remove legacy .agent-tools/ directory if present (from old stdio architecture)
        yield fs.remove(path.join(sitePath, '.agent-tools'));
        // 3. For each agent, remove our config entries
        for (const agent of agents) {
            const agentConfig = AGENT_TARGETS[agent];
            yield removeMcpConfigEntry(path.join(projectPath, agentConfig.mcpConfigPath), agentConfig.mcpConfigTopLevelKey);
            yield removeContextFile(path.join(projectPath, agentConfig.contextFilePath), agent);
            if (agentConfig.supportsSkills) {
                for (const skillName of MANAGED_SKILLS) {
                    yield fs.remove(path.join(projectPath, '.claude', 'skills', skillName));
                }
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
        // 4. Clean up .gitignore
        yield updateGitignore(projectPath, []);
        // 5. Unmark site
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
            const agentConfig = AGENT_TARGETS[agent];
            yield removeMcpConfigEntry(path.join(oldPath, agentConfig.mcpConfigPath), agentConfig.mcpConfigTopLevelKey);
            yield removeContextFile(path.join(oldPath, agentConfig.contextFilePath), agent);
            if (agentConfig.supportsSkills) {
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
        const contextContent = yield generateProjectContext(site);
        for (const agent of agents) {
            const agentConfig = AGENT_TARGETS[agent];
            const serverEntry = buildMcpServerEntry(agent, mcpServerPort, site.id);
            yield mergeMcpConfig(path.join(newPath, agentConfig.mcpConfigPath), serverEntry, agentConfig.mcpConfigTopLevelKey);
            yield writeContextFile(path.join(newPath, agentConfig.contextFilePath), contextContent, agent);
            if (agentConfig.supportsSkills) {
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
            const agentConfig = AGENT_TARGETS[agent];
            yield removeMcpConfigEntry(path.join(projectPath, agentConfig.mcpConfigPath), agentConfig.mcpConfigTopLevelKey);
            yield removeContextFile(path.join(projectPath, agentConfig.contextFilePath), agent);
            if (agentConfig.supportsSkills) {
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
            const contextContent = yield generateProjectContext(site);
            for (const agent of added) {
                const agentConfig = AGENT_TARGETS[agent];
                const serverEntry = buildMcpServerEntry(agent, mcpServerPort, site.id);
                yield mergeMcpConfig(path.join(projectPath, agentConfig.mcpConfigPath), serverEntry, agentConfig.mcpConfigTopLevelKey);
                yield writeContextFile(path.join(projectPath, agentConfig.contextFilePath), contextContent, agent);
                if (agentConfig.supportsSkills) {
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
        // Rebuild SiteConfig and re-register
        const siteConfig = yield buildSiteConfig(site);
        siteConfigRegistry.register(siteConfig);
        const contextContent = yield generateProjectContext(site);
        for (const agent of agents) {
            const agentConfig = AGENT_TARGETS[agent];
            const serverEntry = buildMcpServerEntry(agent, mcpServerPort, site.id);
            yield mergeMcpConfig(path.join(projectPath, agentConfig.mcpConfigPath), serverEntry, agentConfig.mcpConfigTopLevelKey);
            yield writeContextFile(path.join(projectPath, agentConfig.contextFilePath), contextContent, agent);
        }
    });
}
function getStatus(site) {
    return __awaiter(this, void 0, void 0, function* () {
        const sitePath = getSitePath(site);
        const enabled = isAgentToolsEnabled(site);
        const projectDir = getStoredProjectDir(site);
        const agents = getStoredAgents(site);
        // Check if any MCP config exists
        const projectPath = getProjectPath(sitePath, projectDir);
        let configExists = false;
        for (const agent of agents) {
            const agentConfig = AGENT_TARGETS[agent];
            if (yield fs.pathExists(path.join(projectPath, agentConfig.mcpConfigPath))) {
                configExists = true;
                break;
            }
        }
        return {
            enabled,
            configExists,
            sitePath,
            projectDir,
            agents,
        };
    });
}
// ---------------------------------------------------------------------------
// LocalApi Implementation — wraps Local's SiteProcessManager
// ---------------------------------------------------------------------------
function createLocalApi() {
    return {
        startSite(siteId) {
            return __awaiter(this, void 0, void 0, function* () {
                const serviceContainer = LocalMain.getServiceContainer();
                const siteProcessManager = serviceContainer.cradle.siteProcessManager;
                const site = LocalMain.SiteData.getSite(siteId);
                if (!site)
                    throw new Error(`Site not found: ${siteId}`);
                const currentStatus = siteProcessManager.getSiteStatus(site);
                if (currentStatus === 'running') {
                    return { id: site.id, status: 'running', message: 'Site is already running' };
                }
                yield siteProcessManager.start(site);
                return {
                    id: site.id,
                    name: site.name,
                    status: siteProcessManager.getSiteStatus(site),
                };
            });
        },
        stopSite(siteId) {
            return __awaiter(this, void 0, void 0, function* () {
                const serviceContainer = LocalMain.getServiceContainer();
                const siteProcessManager = serviceContainer.cradle.siteProcessManager;
                const site = LocalMain.SiteData.getSite(siteId);
                if (!site)
                    throw new Error(`Site not found: ${siteId}`);
                const currentStatus = siteProcessManager.getSiteStatus(site);
                if (currentStatus === 'halted') {
                    return { id: site.id, status: 'halted', message: 'Site is already stopped' };
                }
                yield siteProcessManager.stop(site);
                return {
                    id: site.id,
                    name: site.name,
                    status: siteProcessManager.getSiteStatus(site),
                };
            });
        },
        restartSite(siteId) {
            return __awaiter(this, void 0, void 0, function* () {
                const serviceContainer = LocalMain.getServiceContainer();
                const siteProcessManager = serviceContainer.cradle.siteProcessManager;
                const site = LocalMain.SiteData.getSite(siteId);
                if (!site)
                    throw new Error(`Site not found: ${siteId}`);
                yield siteProcessManager.restart(site);
                return {
                    id: site.id,
                    name: site.name,
                    status: siteProcessManager.getSiteStatus(site),
                };
            });
        },
        getSiteStatus(siteId) {
            return __awaiter(this, void 0, void 0, function* () {
                const serviceContainer = LocalMain.getServiceContainer();
                const siteProcessManager = serviceContainer.cradle.siteProcessManager;
                const site = LocalMain.SiteData.getSite(siteId);
                if (!site)
                    throw new Error(`Site not found: ${siteId}`);
                return {
                    id: site.id,
                    name: site.name,
                    domain: site.domain,
                    status: siteProcessManager.getSiteStatus(site),
                };
            });
        },
        listSites() {
            return __awaiter(this, void 0, void 0, function* () {
                const serviceContainer = LocalMain.getServiceContainer();
                const siteProcessManager = serviceContainer.cradle.siteProcessManager;
                const sites = LocalMain.SiteData.getSites();
                const statuses = siteProcessManager.getSiteStatuses();
                return Object.values(sites).map((site) => ({
                    id: site.id,
                    name: site.name,
                    domain: site.domain || '',
                    path: getSitePath(site),
                    status: statuses[site.id] || 'unknown',
                }));
            });
        },
    };
}
// ---------------------------------------------------------------------------
// Add-on Entry Point
// ---------------------------------------------------------------------------
function default_1(context) {
    const { notifier, electron } = context;
    let httpServer = null;
    const localApi = createLocalApi();
    // Start the MCP HTTP server
    (() => __awaiter(this, void 0, void 0, function* () {
        try {
            mcpServerPort = yield (0, port_1.findAvailablePort)();
            httpServer = (0, mcp_server_1.createMcpHttpServer)({ registry: siteConfigRegistry, localApi });
            yield (0, mcp_server_1.startMcpHttpServer)(httpServer, mcpServerPort);
            yield (0, port_1.savePort)(mcpServerPort);
            // Register configs for all sites with Agent Tools enabled (regardless of running status).
            // This ensures the MCP endpoint is always reachable — tools that need the site
            // running (WP-CLI, DB) will return appropriate errors; file-based tools still work.
            try {
                const sites = LocalMain.SiteData.getSites();
                for (const site of Object.values(sites)) {
                    if (isAgentToolsEnabled(site)) {
                        try {
                            const siteConfig = yield buildSiteConfig(site);
                            siteConfigRegistry.register(siteConfig);
                            console.log(`[Agent Tools] Registered site: ${site.name}`);
                        }
                        catch (err) {
                            console.error(`[Agent Tools] Failed to register site ${site.name}:`, err);
                        }
                    }
                }
            }
            catch (err) {
                console.error('[Agent Tools] Failed to scan sites:', err);
            }
        }
        catch (err) {
            console.error('[Agent Tools] Failed to start MCP HTTP server:', err);
        }
    }))();
    electron.app.on('will-quit', () => {
        try {
            if (httpServer) {
                (0, mcp_server_1.stopMcpHttpServer)(httpServer);
            }
            (0, port_1.removePortFile)();
        }
        catch (_a) {
            // Best-effort cleanup
        }
    });
    // ── IPC Handlers ────────────────────────────────────────────────────
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
            return { enabled: false, configExists: false, sitePath: '', projectDir: '', agents: [] };
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
    // ── Hooks ───────────────────────────────────────────────────────────
    LocalMain.HooksMain.addAction('siteStarted', (site) => __awaiter(this, void 0, void 0, function* () {
        if (isAgentToolsEnabled(site)) {
            try {
                // Build and register SiteConfig
                const siteConfig = yield buildSiteConfig(site);
                siteConfigRegistry.register(siteConfig);
                // Regenerate MCP config (may have new port, updated paths)
                yield regenerateConfig(site);
                console.log(`[Agent Tools] Config regenerated for "${site.name}" on site start.`);
            }
            catch (err) {
                console.error('[Agent Tools] Failed to regenerate config on site start:', err);
            }
        }
    }));
    LocalMain.HooksMain.addAction('siteStopped', (site) => __awaiter(this, void 0, void 0, function* () {
        if (isAgentToolsEnabled(site)) {
            // Close active MCP sessions (they may be mid-operation with the DB),
            // but keep the site registered so the MCP endpoint stays reachable.
            (0, mcp_server_1.closeSessionsForSite)(site.id);
            console.log(`[Agent Tools] Closed sessions for stopped site: ${site.name}`);
        }
    }));
}
//# sourceMappingURL=main.js.map