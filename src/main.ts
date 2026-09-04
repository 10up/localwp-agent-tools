import * as path from 'path';
import * as fs from 'fs-extra';
import * as Local from '@getflywheel/local';
import * as LocalMain from '@getflywheel/local/main';
import {
	resolveSitePath,
	findPhpBinary,
	findMysqlBinary,
	findMysqlSocket,
	findPhpIniDir,
	findWpCli,
} from './helpers/paths';
import { SiteConfig, SiteConfigRegistry } from './helpers/site-config';
import { findAvailablePort, savePort, removePortFile, removePortFileSync } from './helpers/port';
import { createMcpHttpServer, startMcpHttpServer, stopMcpHttpServer, closeSessionsForSite } from './mcp-server';
import { LocalApi, CreateSiteOptions, CreateSiteResult, ServiceVersion, ServiceVersions } from './tools';
import {
	BUILT_IN_SITE_DEFAULTS,
	NewSiteDefaults,
	deriveDomain,
	deriveSitePath,
	formatSiteNicename,
	validateNewSite,
} from './helpers/new-site';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The key we use inside any mcpServers/servers object to identify our entry */
const MCP_SERVER_KEY = 'local-wp';

/**
 * Supported coding agent targets.
 * Each defines where MCP config and project context live.
 */
type AgentTarget = 'claude' | 'cursor' | 'windsurf' | 'vscode';

interface AgentTargetConfig {
	/** Label for UI display */
	label: string;
	/** Path to MCP config file, relative to project dir */
	mcpConfigPath: string;
	/** Top-level key in the MCP config JSON (mcpServers or servers) */
	mcpConfigTopLevelKey: string;
	/** Path to project context/instructions file, relative to project dir */
	contextFilePath: string;
	/** Extra entries to add to .gitignore */
	gitignoreEntries: string[];
}

const AGENT_TARGETS: Record<AgentTarget, AgentTargetConfig> = {
	claude: {
		label: 'Claude Code',
		mcpConfigPath: '.mcp.json',
		mcpConfigTopLevelKey: 'mcpServers',
		contextFilePath: 'CLAUDE.local.md',
		gitignoreEntries: ['.mcp.json', 'CLAUDE.local.md'],
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

interface AgentToolsStatus {
	enabled: boolean;
	configExists: boolean;
	sitePath: string;
	projectDir: string;
	agents: AgentTarget[];
}

// Marker comments used in .gitignore and context files so we can identify our content
const GITIGNORE_MARKER_START = '# >>> Agent Tools (auto-generated, do not edit)';
const GITIGNORE_MARKER_END = '# <<< Agent Tools';

const CONTEXT_MARKER_START = '<!-- >>> Agent Tools (auto-generated, do not edit) -->';
const CONTEXT_MARKER_END = '<!-- <<< Agent Tools -->';

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------

const siteConfigRegistry = new SiteConfigRegistry();
let mcpServerPort = 0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSitePath(site: Local.Site): string {
	return resolveSitePath(site.longPath || site.path);
}

function getProjectPath(sitePath: string, projectDir: string): string {
	if (!projectDir) return sitePath;
	return path.join(sitePath, projectDir);
}

function getStoredProjectDir(site: Local.Site): string {
	return site.customOptions?.agentToolsProjectDir || '';
}

function getStoredAgents(site: Local.Site): AgentTarget[] {
	const stored = site.customOptions?.agentToolsAgents;
	if (Array.isArray(stored) && stored.length > 0) return stored;
	// Migration: old sites that were enabled before multi-agent support default to claude
	if (site.customOptions?.agentToolsEnabled) return ['claude'];
	return [];
}

function isAgentToolsEnabled(site: Local.Site): boolean {
	return !!site.customOptions?.agentToolsEnabled;
}

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// SiteConfig Builder
// ---------------------------------------------------------------------------

async function buildSiteConfig(site: Local.Site): Promise<SiteConfig> {
	const sitePath = getSitePath(site);
	const siteId = site.id;

	const phpVersion = site.services?.php?.version || '';
	const mysqlService = site.services?.mysql || site.services?.mariadb;
	const mysqlVersion = mysqlService?.version || '';
	const mysqlServiceName = mysqlService?.name || 'mysql';

	const phpBin = await findPhpBinary(phpVersion);
	const mysqlBin = await findMysqlBinary(mysqlVersion, mysqlServiceName);
	const mysqlSocket = findMysqlSocket(siteId);
	const phpIniDir = findPhpIniDir(siteId);
	const wpCliBin = await findWpCli(phpVersion);
	const mysqlPort = mysqlService?.ports?.MYSQL?.[0];

	const domain = site.domain || '';
	const siteUrl = `https://${domain}`;

	let dbHost = '';
	if (mysqlPort) {
		dbHost = '127.0.0.1';
	} else if (process.platform === 'win32') {
		dbHost = '127.0.0.1';
	}

	return {
		siteId,
		sitePath,
		wpPath: path.join(sitePath, 'app', 'public'),
		phpBin: phpBin || 'php',
		phpIniDir,
		wpCliBin: wpCliBin || '',
		mysqlBin: mysqlBin || '',
		dbName: site.mysql?.database || 'local',
		dbUser: site.mysql?.user || 'root',
		dbPassword: site.mysql?.password || 'root',
		dbSocket: mysqlSocket || null,
		dbPort: mysqlPort ? Number(mysqlPort) : 3306,
		dbHost,
		siteDomain: domain,
		siteUrl,
		logPath: path.join(sitePath, 'logs'),
	};
}

// ---------------------------------------------------------------------------
// MCP Config — Per-Agent HTTP Format
// ---------------------------------------------------------------------------

/**
 * Builds the MCP server entry for a specific agent.
 * Each agent has different JSON shapes for HTTP MCP servers.
 */
function buildMcpServerEntry(agent: AgentTarget, port: number, siteId: string): Record<string, any> {
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
async function mergeMcpConfig(
	configPath: string,
	serverEntry: Record<string, any>,
	topLevelKey: string,
): Promise<void> {
	let existing: any = {};

	if (await fs.pathExists(configPath)) {
		try {
			existing = await fs.readJSON(configPath);
		} catch {
			// File exists but isn't valid JSON — back it up before overwriting
			const backupPath = configPath + '.backup';
			await fs.copy(configPath, backupPath);
			console.warn(`[Agent Tools] Backed up invalid JSON at ${configPath} to ${backupPath}`);
			existing = {};
		}
	}

	if (!existing[topLevelKey] || typeof existing[topLevelKey] !== 'object') {
		existing[topLevelKey] = {};
	}

	existing[topLevelKey][MCP_SERVER_KEY] = serverEntry;

	await fs.ensureDir(path.dirname(configPath));
	await fs.writeJSON(configPath, existing, { spaces: 2 });
}

/**
 * Removes our MCP server entry from a config file.
 * Handles both mcpServers and servers top-level keys.
 */
async function removeMcpConfigEntry(configPath: string, topLevelKey: string): Promise<void> {
	if (!(await fs.pathExists(configPath))) return;

	try {
		const existing = await fs.readJSON(configPath);
		if (existing?.[topLevelKey]?.[MCP_SERVER_KEY]) {
			delete existing[topLevelKey][MCP_SERVER_KEY];

			if (Object.keys(existing[topLevelKey]).length === 0) {
				const otherKeys = Object.keys(existing).filter((k) => k !== topLevelKey);
				if (otherKeys.length === 0) {
					await fs.remove(configPath);
					await removeEmptyParentDirs(configPath);
					return;
				}
			}

			await fs.writeJSON(configPath, existing, { spaces: 2 });
		}
	} catch {
		// Can't parse the file — leave it alone
	}
}

/**
 * Removes empty parent directories up to (but not including) the project root.
 * Only removes directories that we might have created.
 */
async function removeEmptyParentDirs(filePath: string): Promise<void> {
	const managedDirs = ['.cursor', '.windsurf', '.vscode', '.github'];
	const dir = path.dirname(filePath);
	const dirName = path.basename(dir);
	if (!managedDirs.includes(dirName)) return;

	try {
		const contents = await fs.readdir(dir);
		if (contents.length === 0) {
			await fs.remove(dir);
		}
	} catch {
		/* intentionally empty */
	}
}

// ---------------------------------------------------------------------------
// Project Context — Safe Merge with Markers
// ---------------------------------------------------------------------------

function generateProjectContext(site: Local.Site): string {
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

## Notes
- For database operations, prefer WP-CLI commands via the \`wp_cli\` tool (e.g. \`wp db query\`, \`wp db export\`, \`wp search-replace\`).
- This file was auto-generated by the Agent Tools add-on for Local.
`;
}

async function writeContextFile(filePath: string, content: string, _agent: AgentTarget): Promise<void> {
	const markedContent = `${CONTEXT_MARKER_START}\n${content}\n${CONTEXT_MARKER_END}`;

	await fs.ensureDir(path.dirname(filePath));

	if (await fs.pathExists(filePath)) {
		let existing = await fs.readFile(filePath, 'utf-8');

		const markerRegex = new RegExp(
			`${escapeRegex(CONTEXT_MARKER_START)}[\\s\\S]*?${escapeRegex(CONTEXT_MARKER_END)}`,
			'g',
		);

		if (markerRegex.test(existing)) {
			existing = existing.replace(markerRegex, markedContent);
			await fs.writeFile(filePath, existing, 'utf-8');
		} else {
			const separator = existing.endsWith('\n') ? '\n' : '\n\n';
			await fs.writeFile(filePath, existing + separator + markedContent + '\n', 'utf-8');
		}
	} else {
		await fs.writeFile(filePath, markedContent + '\n', 'utf-8');
	}
}

async function removeContextFile(filePath: string, _agent: AgentTarget): Promise<void> {
	if (!(await fs.pathExists(filePath))) return;

	let content = await fs.readFile(filePath, 'utf-8');

	const markerRegex = new RegExp(
		`\\n?${escapeRegex(CONTEXT_MARKER_START)}[\\s\\S]*?${escapeRegex(CONTEXT_MARKER_END)}\\n?`,
		'g',
	);

	content = content.replace(markerRegex, '');

	const trimmed = content.trim();
	if (!trimmed) {
		await fs.remove(filePath);
		await removeEmptyParentDirs(filePath);
	} else {
		await fs.writeFile(filePath, content, 'utf-8');
	}
}

// ---------------------------------------------------------------------------
// Gitignore — aggregate entries from all active agents
// ---------------------------------------------------------------------------

function buildGitignoreEntries(agents: AgentTarget[]): string[] {
	const entries = new Set<string>();

	for (const agent of agents) {
		const config = AGENT_TARGETS[agent];
		for (const entry of config.gitignoreEntries) {
			entries.add(entry);
		}
	}

	return Array.from(entries);
}

async function updateGitignore(dirPath: string, agents: AgentTarget[]): Promise<void> {
	const gitignorePath = path.join(dirPath, '.gitignore');

	let content = '';
	if (await fs.pathExists(gitignorePath)) {
		content = await fs.readFile(gitignorePath, 'utf-8');
	}

	// Remove existing marked block
	const markerRegex = new RegExp(
		`\\n?${escapeRegex(GITIGNORE_MARKER_START)}[\\s\\S]*?${escapeRegex(GITIGNORE_MARKER_END)}\\n?`,
		'g',
	);
	content = content.replace(markerRegex, '');

	if (agents.length > 0) {
		const entries = buildGitignoreEntries(agents);
		if (entries.length > 0) {
			const block = ['', GITIGNORE_MARKER_START, ...entries, GITIGNORE_MARKER_END, ''].join('\n');

			content = content.trimEnd() + '\n' + block;
		}
	}

	await fs.writeFile(gitignorePath, content, 'utf-8');
}

// ---------------------------------------------------------------------------
// Migration Helpers
// ---------------------------------------------------------------------------

/**
 * Removes any Agent Tools marker block from CLAUDE.md left by older versions
 * that wrote context there instead of CLAUDE.local.md.
 */
async function migrateClaude(projectPath: string): Promise<void> {
	const legacyPath = path.join(projectPath, 'CLAUDE.md');
	if (!(await fs.pathExists(legacyPath))) return;

	const content = await fs.readFile(legacyPath, 'utf-8');
	const markerRegex = new RegExp(
		`${escapeRegex(CONTEXT_MARKER_START)}[\\s\\S]*?${escapeRegex(CONTEXT_MARKER_END)}`,
	);
	if (!markerRegex.test(content)) return;

	await removeContextFile(legacyPath, 'claude');
}

// ---------------------------------------------------------------------------
// Core Functions
// ---------------------------------------------------------------------------

async function setupSite(site: Local.Site, notifier: any, projectDir: string, agents: AgentTarget[]): Promise<void> {
	const sitePath = getSitePath(site);
	const projectPath = getProjectPath(sitePath, projectDir);

	notifier.notify({
		title: 'Agent Tools',
		message: `Setting up Agent Tools for "${site.name}"...`,
		open: undefined,
	});

	// 1. Build SiteConfig and register it
	const siteConfig = await buildSiteConfig(site);
	siteConfigRegistry.register(siteConfig);

	// 2. Migrate legacy CLAUDE.md content to CLAUDE.local.md (no-op if already clean)
	if (agents.includes('claude')) {
		await migrateClaude(projectPath);
	}

	// 3. Generate project context
	const contextContent = generateProjectContext(site);

	// 4. For each selected agent, write configs
	for (const agent of agents) {
		const agentConfig = AGENT_TARGETS[agent];

		// Write MCP config (HTTP format, per-agent shape)
		const mcpConfigPath = path.join(projectPath, agentConfig.mcpConfigPath);
		const serverEntry = buildMcpServerEntry(agent, mcpServerPort, site.id);
		await mergeMcpConfig(mcpConfigPath, serverEntry, agentConfig.mcpConfigTopLevelKey);

		// Write project context
		const contextPath = path.join(projectPath, agentConfig.contextFilePath);
		await writeContextFile(contextPath, contextContent, agent);
	}

	// 4. Update .gitignore
	await updateGitignore(projectPath, agents);

	// 5. Store state
	LocalMain.SiteData.updateSite(site.id, {
		customOptions: {
			...site.customOptions,
			agentToolsEnabled: true,
			agentToolsProjectDir: projectDir,
			agentToolsAgents: agents,
		},
	});

	const agentLabels = agents.map((a) => AGENT_TARGETS[a].label).join(', ');
	notifier.notify({
		title: 'Agent Tools',
		message: `Agent Tools enabled for "${site.name}" (${agentLabels}).`,
		open: undefined,
	});
}

async function teardownSite(site: Local.Site, notifier: any): Promise<void> {
	const sitePath = getSitePath(site);
	const projectDir = getStoredProjectDir(site);
	const projectPath = getProjectPath(sitePath, projectDir);
	const agents = getStoredAgents(site);

	// 1. Unregister from config registry and close MCP sessions
	siteConfigRegistry.unregister(site.id);
	closeSessionsForSite(site.id);

	// 2. Remove legacy .agent-tools/ directory if present (from old stdio architecture)
	await fs.remove(path.join(sitePath, '.agent-tools'));

	// 3. For each agent, remove our config entries
	for (const agent of agents) {
		const agentConfig = AGENT_TARGETS[agent];

		await removeMcpConfigEntry(path.join(projectPath, agentConfig.mcpConfigPath), agentConfig.mcpConfigTopLevelKey);
		await removeContextFile(path.join(projectPath, agentConfig.contextFilePath), agent);
	}

	// 4. Clean up .gitignore
	await updateGitignore(projectPath, []);

	// 5. Unmark site
	const customOptions = { ...site.customOptions };
	delete customOptions.agentToolsEnabled;
	delete customOptions.agentToolsProjectDir;
	delete customOptions.agentToolsAgents;

	LocalMain.SiteData.updateSite(site.id, { customOptions });

	notifier.notify({
		title: 'Agent Tools',
		message: `Agent Tools disabled for "${site.name}".`,
		open: undefined,
	});
}

async function changeProjectDir(site: Local.Site, newProjectDir: string, notifier: any): Promise<void> {
	const sitePath = getSitePath(site);
	const oldProjectDir = getStoredProjectDir(site);
	const oldPath = getProjectPath(sitePath, oldProjectDir);
	const newPath = getProjectPath(sitePath, newProjectDir);
	const agents = getStoredAgents(site);

	if (oldPath === newPath) return;

	// Remove configs from old location
	for (const agent of agents) {
		const agentConfig = AGENT_TARGETS[agent];

		await removeMcpConfigEntry(path.join(oldPath, agentConfig.mcpConfigPath), agentConfig.mcpConfigTopLevelKey);
		await removeContextFile(path.join(oldPath, agentConfig.contextFilePath), agent);
	}
	await updateGitignore(oldPath, []);

	// Write configs to new location
	const contextContent = generateProjectContext(site);

	for (const agent of agents) {
		const agentConfig = AGENT_TARGETS[agent];

		const serverEntry = buildMcpServerEntry(agent, mcpServerPort, site.id);
		await mergeMcpConfig(
			path.join(newPath, agentConfig.mcpConfigPath),
			serverEntry,
			agentConfig.mcpConfigTopLevelKey,
		);
		await writeContextFile(path.join(newPath, agentConfig.contextFilePath), contextContent, agent);
	}

	await updateGitignore(newPath, agents);

	LocalMain.SiteData.updateSite(site.id, {
		customOptions: {
			...site.customOptions,
			agentToolsProjectDir: newProjectDir,
		},
	});

	notifier.notify({
		title: 'Agent Tools',
		message: `Project directory changed to "${newProjectDir || 'site root'}" for "${site.name}".`,
		open: undefined,
	});
}

async function updateAgents(site: Local.Site, newAgents: AgentTarget[], notifier: any): Promise<void> {
	if (!isAgentToolsEnabled(site)) return;

	const sitePath = getSitePath(site);
	const projectDir = getStoredProjectDir(site);
	const projectPath = getProjectPath(sitePath, projectDir);
	const oldAgents = getStoredAgents(site);

	const added = newAgents.filter((a) => !oldAgents.includes(a));
	const removed = oldAgents.filter((a) => !newAgents.includes(a));

	// Remove configs for deselected agents
	for (const agent of removed) {
		const agentConfig = AGENT_TARGETS[agent];

		await removeMcpConfigEntry(path.join(projectPath, agentConfig.mcpConfigPath), agentConfig.mcpConfigTopLevelKey);
		await removeContextFile(path.join(projectPath, agentConfig.contextFilePath), agent);
	}

	// Add configs for newly selected agents
	if (added.length > 0) {
		const contextContent = generateProjectContext(site);

		for (const agent of added) {
			const agentConfig = AGENT_TARGETS[agent];

			const serverEntry = buildMcpServerEntry(agent, mcpServerPort, site.id);
			await mergeMcpConfig(
				path.join(projectPath, agentConfig.mcpConfigPath),
				serverEntry,
				agentConfig.mcpConfigTopLevelKey,
			);
			await writeContextFile(path.join(projectPath, agentConfig.contextFilePath), contextContent, agent);
		}
	}

	// Update .gitignore with new agent set
	await updateGitignore(projectPath, newAgents);

	LocalMain.SiteData.updateSite(site.id, {
		customOptions: {
			...site.customOptions,
			agentToolsAgents: newAgents,
		},
	});

	const agentLabels = newAgents.map((a) => AGENT_TARGETS[a].label).join(', ');
	notifier.notify({
		title: 'Agent Tools',
		message: `Updated agents for "${site.name}" (${agentLabels}).`,
		open: undefined,
	});
}

async function regenerateConfig(site: Local.Site): Promise<void> {
	if (!isAgentToolsEnabled(site)) return;

	const sitePath = getSitePath(site);
	const projectDir = getStoredProjectDir(site);
	const projectPath = getProjectPath(sitePath, projectDir);
	const agents = getStoredAgents(site);

	// Rebuild SiteConfig and re-register
	const siteConfig = await buildSiteConfig(site);
	siteConfigRegistry.register(siteConfig);

	// Migrate legacy CLAUDE.md content on regenerate (no-op if already clean)
	if (agents.includes('claude')) {
		await migrateClaude(projectPath);
	}

	const contextContent = generateProjectContext(site);

	for (const agent of agents) {
		const agentConfig = AGENT_TARGETS[agent];

		const serverEntry = buildMcpServerEntry(agent, mcpServerPort, site.id);
		await mergeMcpConfig(
			path.join(projectPath, agentConfig.mcpConfigPath),
			serverEntry,
			agentConfig.mcpConfigTopLevelKey,
		);
		await writeContextFile(path.join(projectPath, agentConfig.contextFilePath), contextContent, agent);
	}
}

async function getStatus(site: Local.Site): Promise<AgentToolsStatus> {
	const sitePath = getSitePath(site);
	const enabled = isAgentToolsEnabled(site);
	const projectDir = getStoredProjectDir(site);
	const agents = getStoredAgents(site);

	// Check if any MCP config exists
	const projectPath = getProjectPath(sitePath, projectDir);
	let configExists = false;
	for (const agent of agents) {
		const agentConfig = AGENT_TARGETS[agent];
		if (await fs.pathExists(path.join(projectPath, agentConfig.mcpConfigPath))) {
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
}

// ---------------------------------------------------------------------------
// LocalApi Implementation — wraps Local's SiteProcessManager
// ---------------------------------------------------------------------------

/**
 * Roles we surface through list_service_versions, and which create_site option
 * each maps to.
 */
const SERVICE_ROLE_FIELDS = [
	{ role: Local.SiteServiceRole.PHP, key: 'php' as const },
	{ role: Local.SiteServiceRole.DATABASE, key: 'database' as const },
	{ role: Local.SiteServiceRole.HTTP, key: 'webServer' as const },
];

/** Local's `new-site-defaults` setting, merged over Local's built-in defaults. */
function getNewSiteDefaults(): NewSiteDefaults {
	let stored: Partial<NewSiteDefaults> = {};
	try {
		stored = LocalMain.UserData.get('settings-new-site-defaults', {}) || {};
	} catch (err) {
		console.warn('[Agent Tools] Could not read new site defaults, using built-ins:', err);
	}
	return { ...BUILT_IN_SITE_DEFAULTS, ...stored };
}

/** True when `dir` already holds a Local site's `app` or `conf` folder. */
async function hasExistingLocalData(dir: string): Promise<boolean> {
	const [hasApp, hasConf] = await Promise.all([
		fs.pathExists(path.join(dir, 'app')),
		fs.pathExists(path.join(dir, 'conf')),
	]);
	return hasApp || hasConf;
}

/**
 * Local's AddSiteService only resolves once the site is fully provisioned and
 * WordPress is installed, but it registers the site with SiteData synchronously
 * before any of that. Poll briefly so create_site can return the new site's ID
 * without waiting minutes for provisioning to finish.
 */
async function waitForSiteByDomain(domain: string, timeoutMs = 5_000): Promise<Local.Site | null> {
	const deadline = Date.now() + timeoutMs;
	do {
		const site = LocalMain.SiteData.getSiteByProperty('domain', domain);
		if (site) return site;
		await new Promise((resolve) => setTimeout(resolve, 50));
	} while (Date.now() < deadline);
	return null;
}

/**
 * Provisioning failures surface as a dialog inside Local and then reject the
 * promise create_site is no longer awaiting. Remember them so an agent polling
 * site_status finds out why the site never came up.
 */
const siteCreationFailures = new Map<string, string>();

interface LocalApiOptions {
	/** Enables Agent Tools on a freshly created site. Wired to setupSite() by the add-on entry point. */
	enableAgentTools(site: Local.Site, agents: AgentTarget[]): Promise<void>;
}

function createLocalApi(options: LocalApiOptions): LocalApi {
	return {
		async startSite(siteId: string) {
			const serviceContainer = LocalMain.getServiceContainer();
			const siteProcessManager = serviceContainer.cradle.siteProcessManager;
			const site = LocalMain.SiteData.getSite(siteId);
			if (!site) throw new Error(`Site not found: ${siteId}`);

			const currentStatus = siteProcessManager.getSiteStatus(site);
			if (currentStatus === 'running') {
				return { id: site.id, status: 'running', message: 'Site is already running' };
			}
			await siteProcessManager.start(site);
			return {
				id: site.id,
				name: site.name,
				status: siteProcessManager.getSiteStatus(site),
			};
		},

		async stopSite(siteId: string) {
			const serviceContainer = LocalMain.getServiceContainer();
			const siteProcessManager = serviceContainer.cradle.siteProcessManager;
			const site = LocalMain.SiteData.getSite(siteId);
			if (!site) throw new Error(`Site not found: ${siteId}`);

			const currentStatus = siteProcessManager.getSiteStatus(site);
			if (currentStatus === 'halted') {
				return { id: site.id, status: 'halted', message: 'Site is already stopped' };
			}
			await siteProcessManager.stop(site);
			return {
				id: site.id,
				name: site.name,
				status: siteProcessManager.getSiteStatus(site),
			};
		},

		async restartSite(siteId: string) {
			const serviceContainer = LocalMain.getServiceContainer();
			const siteProcessManager = serviceContainer.cradle.siteProcessManager;
			const site = LocalMain.SiteData.getSite(siteId);
			if (!site) throw new Error(`Site not found: ${siteId}`);

			await siteProcessManager.restart(site);
			return {
				id: site.id,
				name: site.name,
				status: siteProcessManager.getSiteStatus(site),
			};
		},

		async getSiteStatus(siteId: string) {
			const serviceContainer = LocalMain.getServiceContainer();
			const siteProcessManager = serviceContainer.cradle.siteProcessManager;
			const site = LocalMain.SiteData.getSite(siteId);
			if (!site) throw new Error(`Site not found: ${siteId}`);

			const creationError = siteCreationFailures.get(siteId);

			return {
				id: site.id,
				name: site.name,
				domain: site.domain,
				status: siteProcessManager.getSiteStatus(site),
				...(creationError ? { creationError } : {}),
			};
		},

		async listSites() {
			const serviceContainer = LocalMain.getServiceContainer();
			const siteProcessManager = serviceContainer.cradle.siteProcessManager;
			const sites = LocalMain.SiteData.getSites();
			const statuses = siteProcessManager.getSiteStatuses();

			return Object.values(sites).map((site: Local.Site) => ({
				id: site.id,
				name: site.name,
				domain: site.domain || '',
				path: getSitePath(site),
				status: statuses[site.id] || 'unknown',
			}));
		},

		async listServiceVersions(): Promise<ServiceVersions> {
			const serviceContainer = LocalMain.getServiceContainer();
			const lightningServices = serviceContainer.cradle.lightningServices;

			const collect = async (role: Local.SiteServiceRole, prefixed: boolean): Promise<ServiceVersion[]> => {
				const services = await lightningServices.getServices(role);
				const versions: ServiceVersion[] = [];

				for (const [serviceName, byVersion] of Object.entries(services || {})) {
					for (const [binVersion, service] of Object.entries(byVersion || {})) {
						versions.push({
							// PHP is passed as a bare version; databases and web servers as `<name>-<version>`.
							value: prefixed ? `${serviceName}-${binVersion}` : binVersion,
							installed: (service as { registered?: boolean })?.registered === true,
						});
					}
				}

				return versions.sort((a, b) => a.value.localeCompare(b.value, undefined, { numeric: true }));
			};

			const [php, database, webServer] = await Promise.all(
				SERVICE_ROLE_FIELDS.map(({ role, key }) => collect(role, key !== 'php')),
			);

			return {
				php,
				database,
				webServer,
				note:
					'Local does not expose its preferred versions to add-ons. Omit phpVersion, database or ' +
					'webServer in create_site to let Local pick its own default for that service — the ' +
					'create_site result reports which versions the new site actually got.',
			};
		},

		async createSite(opts: CreateSiteOptions): Promise<CreateSiteResult> {
			const serviceContainer = LocalMain.getServiceContainer();
			const addSiteService = serviceContainer.cradle.addSite;

			const siteDefaults = getNewSiteDefaults();
			const nicename = formatSiteNicename(opts.name);

			const domain = opts.domain ?? deriveDomain(nicename, siteDefaults.tld);
			const sitesPath = path.resolve(resolveSitePath(siteDefaults.sitesPath));
			const sitePath = path.resolve(resolveSitePath(opts.path ?? deriveSitePath(sitesPath, nicename)));

			const existingSites = Object.values(LocalMain.SiteData.getSites()).map((site: Local.Site) => ({
				domain: site.domain || '',
				path: getSitePath(site),
			}));

			const validationError = validateNewSite(
				{ name: opts.name, domain, sitePath },
				{
					existingSites,
					defaultSitesPath: sitesPath,
					pathHasLocalData: await hasExistingLocalData(sitePath),
					platform: process.platform,
				},
			);
			if (validationError) {
				throw new Error(validationError);
			}

			const multisite = opts.multisite ?? 'none';
			const multiSite =
				multisite === 'subdirectory'
					? Local.MultiSite.Subdir
					: multisite === 'subdomain'
						? Local.MultiSite.Subdomain
						: Local.MultiSite.No;

			const wpCredentials = {
				adminUsername: opts.wpAdminUsername ?? 'admin',
				adminPassword: opts.wpAdminPassword ?? 'admin',
				adminEmail: opts.wpAdminEmail ?? siteDefaults.adminEmail,
			};

			const newSiteInfo: Local.NewSiteInfo = {
				siteName: opts.name,
				sitePath,
				siteDomain: domain,
				multiSite,
				phpVersion: opts.phpVersion,
				database: opts.database,
				webServer: opts.webServer,
				xdebugEnabled: opts.xdebugEnabled ?? false,
			};

			console.log(`[Agent Tools] Creating site "${opts.name}" at ${sitePath} (${domain})`);

			const creation = addSiteService
				.addSite({
					newSiteInfo,
					wpCredentials,
					goToSite: false,
					installWP: opts.installWordPress ?? true,
					siteLanguage: opts.siteLanguage ?? siteDefaults.siteLanguage,
				})
				.then(async (site) => {
					if (opts.enableAgentTools) {
						const agents = (opts.agents ?? ['claude']) as AgentTarget[];
						await options.enableAgentTools(site, agents);
					}
					return site;
				});

			// The caller usually isn't awaiting this, so record failures where a
			// subsequent site_status call can find them.
			creation.catch((err: unknown) => {
				const message = err instanceof Error ? err.message : String(err);
				console.error(`[Agent Tools] Site creation failed for "${opts.name}": ${message}`);
				const failed = LocalMain.SiteData.getSiteByProperty('domain', domain);
				if (failed) {
					siteCreationFailures.set(failed.id, message);
				}
			});

			const describe = (site: Local.Site, pending: boolean): CreateSiteResult => {
				const services = site.services || {};
				const dbService = services.mysql || services.mariadb;
				const httpService = services.nginx || services.apache;

				return {
					id: site.id,
					name: site.name,
					domain: site.domain || domain,
					path: getSitePath(site),
					// In localhost router mode site.url embeds the HTTP port, which is
					// still unallocated while the site is provisioning.
					url: site.url && !site.url.includes('undefined') ? site.url : `http://${site.domain || domain}`,
					status: serviceContainer.cradle.siteProcessManager.getSiteStatus(site),
					phpVersion: services.php?.version || opts.phpVersion || '',
					database: dbService ? `${dbService.name}-${dbService.version}` : opts.database || '',
					webServer: httpService ? `${httpService.name}-${httpService.version}` : opts.webServer || '',
					multisite,
					wpAdminUsername: wpCredentials.adminUsername,
					wpAdminPassword: wpCredentials.adminPassword,
					wpAdminEmail: wpCredentials.adminEmail,
					agentToolsEnabled: !pending && !!opts.enableAgentTools,
					pending,
				};
			};

			if (opts.wait) {
				return describe(await creation, false);
			}

			const site = await waitForSiteByDomain(domain);
			if (!site) {
				// Creation blew up before Local even registered the site — surface that error.
				await creation;
				throw new Error(`Site "${opts.name}" was not registered with Local. Check Local's logs for details.`);
			}

			return describe(site, true);
		},
	};
}

// ---------------------------------------------------------------------------
// Add-on Entry Point
// ---------------------------------------------------------------------------

export default function (context: LocalMain.AddonMainContext): void {
	const { notifier, electron } = context;

	let httpServer: ReturnType<typeof createMcpHttpServer> | null = null;
	const localApi = createLocalApi({
		enableAgentTools: (site, agents) => setupSite(site, notifier, '', agents),
	});

	// Start the MCP HTTP server
	(async () => {
		try {
			mcpServerPort = await findAvailablePort();
			httpServer = createMcpHttpServer({ registry: siteConfigRegistry, localApi });

			try {
				await startMcpHttpServer(httpServer, mcpServerPort);
			} catch (listenErr: unknown) {
				// TOCTOU race: port was free during probe but taken before listen.
				// Retry once with the next port.
				const code = listenErr instanceof Error ? (listenErr as NodeJS.ErrnoException).code : '';
				if (code === 'EADDRINUSE') {
					console.warn(`[Agent Tools] Port ${mcpServerPort} was taken, retrying with ${mcpServerPort + 1}`);
					mcpServerPort += 1;
					httpServer = createMcpHttpServer({ registry: siteConfigRegistry, localApi });
					await startMcpHttpServer(httpServer, mcpServerPort);
				} else {
					throw listenErr;
				}
			}

			await savePort(mcpServerPort);

			// Register configs for all sites with Agent Tools enabled (regardless of running status).
			// This ensures the MCP endpoint is always reachable — tools that need the site
			// running (WP-CLI, DB) will return appropriate errors; file-based tools still work.
			try {
				const sites = LocalMain.SiteData.getSites();

				for (const site of Object.values(sites) as Local.Site[]) {
					if (isAgentToolsEnabled(site)) {
						try {
							const siteConfig = await buildSiteConfig(site);
							siteConfigRegistry.register(siteConfig);
							console.log(`[Agent Tools] Registered site: ${site.name}`);
						} catch (err) {
							console.error(`[Agent Tools] Failed to register site ${site.name}:`, err);
						}
					}
				}
			} catch (err) {
				console.error('[Agent Tools] Failed to scan sites:', err);
			}
		} catch (err) {
			console.error('[Agent Tools] Failed to start MCP HTTP server:', err);
		}
	})();

	electron.app.on('will-quit', () => {
		try {
			if (httpServer) {
				// Best-effort — process is exiting, no time to await
				stopMcpHttpServer(httpServer);
			}
			removePortFileSync();
		} catch {
			// Best-effort cleanup
		}
	});

	// ── IPC Handlers ────────────────────────────────────────────────────

	electron.ipcMain.handle(
		'agent-tools:enable-site',
		async (_event: any, siteId: string, projectDir: string, agents: AgentTarget[]) => {
			try {
				const site = LocalMain.SiteData.getSite(siteId);
				await setupSite(site, notifier, projectDir || '', agents);
				return { success: true };
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.error('[Agent Tools] Enable failed:', message);
				notifier.notify({
					title: 'Agent Tools — Error',
					message: `Failed to enable Agent Tools: ${message}`,
					open: undefined,
				});
				return { success: false, error: message };
			}
		},
	);

	electron.ipcMain.handle('agent-tools:disable-site', async (_event: any, siteId: string) => {
		try {
			const site = LocalMain.SiteData.getSite(siteId);
			await teardownSite(site, notifier);
			return { success: true };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error('[Agent Tools] Disable failed:', message);
			return { success: false, error: message };
		}
	});

	electron.ipcMain.handle('agent-tools:regenerate-config', async (_event: any, siteId: string) => {
		try {
			const site = LocalMain.SiteData.getSite(siteId);
			await regenerateConfig(site);
			notifier.notify({
				title: 'Agent Tools',
				message: `Configuration regenerated for "${site.name}".`,
				open: undefined,
			});
			return { success: true };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error('[Agent Tools] Regenerate failed:', message);
			return { success: false, error: message };
		}
	});

	electron.ipcMain.handle('agent-tools:get-status', async (_event: any, siteId: string) => {
		try {
			const site = LocalMain.SiteData.getSite(siteId);
			return await getStatus(site);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error('[Agent Tools] Get status failed:', message);
			return { enabled: false, configExists: false, sitePath: '', projectDir: '', agents: [] };
		}
	});

	electron.ipcMain.handle('agent-tools:update-agents', async (_event: any, siteId: string, agents: AgentTarget[]) => {
		try {
			const site = LocalMain.SiteData.getSite(siteId);
			await updateAgents(site, agents, notifier);
			return { success: true };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error('[Agent Tools] Update agents failed:', message);
			return { success: false, error: message };
		}
	});

	electron.ipcMain.handle(
		'agent-tools:change-project-dir',
		async (_event: any, siteId: string, newProjectDir: string) => {
			try {
				const site = LocalMain.SiteData.getSite(siteId);
				await changeProjectDir(site, newProjectDir || '', notifier);
				return { success: true };
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.error('[Agent Tools] Change project dir failed:', message);
				return { success: false, error: message };
			}
		},
	);

	// ── Hooks ───────────────────────────────────────────────────────────

	LocalMain.HooksMain.addAction('siteStarted', async (site: Local.Site) => {
		if (isAgentToolsEnabled(site)) {
			try {
				// Build and register SiteConfig
				const siteConfig = await buildSiteConfig(site);
				siteConfigRegistry.register(siteConfig);

				// Regenerate MCP config (may have new port, updated paths)
				await regenerateConfig(site);
				console.log(`[Agent Tools] Config regenerated for "${site.name}" on site start.`);
			} catch (err) {
				console.error('[Agent Tools] Failed to regenerate config on site start:', err);
			}
		}
	});

	LocalMain.HooksMain.addAction('siteStopped', async (site: Local.Site) => {
		if (isAgentToolsEnabled(site)) {
			// Close active MCP sessions (they may be mid-operation with the DB),
			// but keep the site registered so the MCP endpoint stays reachable.
			closeSessionsForSite(site.id);
			console.log(`[Agent Tools] Closed sessions for stopped site: ${site.name}`);
		}
	});
}
