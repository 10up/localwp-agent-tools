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
        gitignoreEntries: ['.mcp.json', 'CLAUDE.md'],
    },
    cursor: {
        label: 'Cursor',
        mcpConfigPath: path.join('.cursor', 'mcp.json'),
        mcpConfigTopLevelKey: 'mcpServers',
        contextFilePath: '.cursorrules',
        gitignoreEntries: ['.cursorrules'],
    },
    windsurf: {
        label: 'Windsurf',
        mcpConfigPath: path.join('.windsurf', 'mcp.json'),
        mcpConfigTopLevelKey: 'mcpServers',
        contextFilePath: '.windsurfrules',
        gitignoreEntries: ['.windsurfrules'],
    },
    vscode: {
        label: 'VS Code Copilot',
        mcpConfigPath: path.join('.vscode', 'mcp.json'),
        mcpConfigTopLevelKey: 'servers',
        contextFilePath: path.join('.github', 'copilot-instructions.md'),
        gitignoreEntries: [],
    },
};
// Marker comments used in .gitignore and context files so we can identify our content
const GITIGNORE_MARKER_START = '# >>> Agent Tools (auto-generated, do not edit)';
const GITIGNORE_MARKER_END = '# <<< Agent Tools';
const CONTEXT_MARKER_START = '<!-- >>> Agent Tools (auto-generated, do not edit) -->';
const CONTEXT_MARKER_END = '<!-- <<< Agent Tools -->';
// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------
const siteConfigRegistry = new site_config_1.SiteConfigRegistry();
let mcpServerPort = 0;
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getSitePath(site) {
    return (0, paths_1.resolveSitePath)(site.longPath || site.path);
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
    return `# WordPress Site: ${site.name}

This is a WordPress site managed by [Local](https://localwp.com/). It has a Local MCP server configured that provides tools for interacting with the site.

Use the \`get_site_info\` tool to get environment details (PHP/MySQL versions, paths, active plugins, theme, etc.).

## File Structure (relative to site root)
- WordPress root: app/public/
- Theme files: app/public/wp-content/themes/
- Plugin files: app/public/wp-content/plugins/
- Uploads: app/public/wp-content/uploads/
- Logs: logs/
- Local config: conf/

## Snapshots
For any snapshot or database import operations, use the dedicated snapshot MCP tools (NOT manual WP-CLI commands):
- \`snapshot_import\` - Import a SQL file (backup + import + optional URL search-replace). Call without args to list available SQL files.
- \`snapshot_create\` - Create a local snapshot (wp-scrubber sanitizes user data). Returns a snapshot ID.
- \`snapshot_pull\` - Pull a snapshot by ID into the local site (imports scrubbed DB, creates snapshots user).
- \`snapshot_push\` - Push a local snapshot to the remote repository by ID.
- \`snapshot_search\` - Search for snapshots in the remote repository.

Standard workflow: snapshot_import → snapshot_create → snapshot_pull (same ID) → snapshot_push.
The pull step is required after create to apply the scrubbed database and create the login user.

## Notes
- For database operations, prefer WP-CLI commands via the \`wp_cli\` tool (e.g. \`wp db query\`, \`wp db export\`, \`wp search-replace\`).
- This file was auto-generated by the Agent Tools add-on for Local.
`;
}
function writeContextFile(filePath, content, _agent) {
    return __awaiter(this, void 0, void 0, function* () {
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
function removeContextFile(filePath, _agent) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!(yield fs.pathExists(filePath)))
            return;
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
        const contextContent = generateProjectContext(site);
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
        }
        // 3. Clean up .gitignore
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
        }
        yield updateGitignore(oldPath, []);
        // Write configs to new location
        const contextContent = generateProjectContext(site);
        for (const agent of agents) {
            const agentConfig = AGENT_TARGETS[agent];
            const serverEntry = buildMcpServerEntry(agent, mcpServerPort, site.id);
            yield mergeMcpConfig(path.join(newPath, agentConfig.mcpConfigPath), serverEntry, agentConfig.mcpConfigTopLevelKey);
            yield writeContextFile(path.join(newPath, agentConfig.contextFilePath), contextContent, agent);
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
        }
        // Add configs for newly selected agents
        if (added.length > 0) {
            const contextContent = generateProjectContext(site);
            for (const agent of added) {
                const agentConfig = AGENT_TARGETS[agent];
                const serverEntry = buildMcpServerEntry(agent, mcpServerPort, site.id);
                yield mergeMcpConfig(path.join(projectPath, agentConfig.mcpConfigPath), serverEntry, agentConfig.mcpConfigTopLevelKey);
                yield writeContextFile(path.join(projectPath, agentConfig.contextFilePath), contextContent, agent);
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
        const contextContent = generateProjectContext(site);
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