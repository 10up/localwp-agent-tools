import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs-extra';
import * as net from 'net';
import * as Local from '@getflywheel/local';
import * as LocalMain from '@getflywheel/local/main';
import { execFile } from 'child_process';
import {
	resolveSitePath,
	findPhpBinary,
	findMysqlBinary,
	findMysqlSocket,
	findWpCli,
} from './helpers/paths';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface McpServerEntry {
	command: string;
	args: string[];
	env: Record<string, string>;
}

/** The key we use inside any mcpServers object to identify our entry */
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
	/** Path to project context/instructions file, relative to project dir */
	contextFilePath: string;
	/** Whether this agent supports skills */
	supportsSkills: boolean;
	/** Extra entries to add to .gitignore */
	gitignoreEntries: string[];
}

const AGENT_TARGETS: Record<AgentTarget, AgentTargetConfig> = {
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

interface AgentToolsStatus {
	enabled: boolean;
	configExists: boolean;
	mcpServerInstalled: boolean;
	sitePath: string;
	projectDir: string;
	agents: AgentTarget[];
}

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

const BRIDGE_SOCKET_DIR = process.platform === 'win32'
	? ''
	: path.join(os.homedir(), '.local-agent-tools');

const BRIDGE_SOCKET_PATH = process.platform === 'win32'
	? '\\\\.\\pipe\\local-agent-tools-bridge'
	: path.join(BRIDGE_SOCKET_DIR, 'bridge.sock');

interface BridgeRequest {
	action: 'start' | 'stop' | 'restart' | 'status' | 'list';
	siteId?: string;
}

interface BridgeResponse {
	success: boolean;
	data?: any;
	error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSitePath(site: Local.Site): string {
	const rawPath = (site as any).longPath || site.path;
	return resolveSitePath(rawPath);
}

function getProjectPath(sitePath: string, projectDir: string): string {
	if (!projectDir) return sitePath;
	return path.join(sitePath, projectDir);
}

function getStoredProjectDir(site: Local.Site): string {
	return (site as any).customOptions?.agentToolsProjectDir || '';
}

function getStoredAgents(site: Local.Site): AgentTarget[] {
	const stored = (site as any).customOptions?.agentToolsAgents;
	if (Array.isArray(stored) && stored.length > 0) return stored;
	// Migration: old sites that were enabled before multi-agent support default to claude
	if ((site as any).customOptions?.agentToolsEnabled) return ['claude'];
	return [];
}

function getBundledPath(): string {
	return path.join(__dirname, '..', 'bundled');
}

function execCommand(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(command, args, {
			cwd: options.cwd,
			env: { ...process.env, ...options.env },
			maxBuffer: 10 * 1024 * 1024,
		}, (error, stdout, stderr) => {
			if (error) {
				reject(new Error(`Command failed: ${command} ${args.join(' ')}\n${stderr || error.message}`));
			} else {
				resolve(stdout);
			}
		});
	});
}

function isAgentToolsEnabled(site: Local.Site): boolean {
	return !!(site as any).customOptions?.agentToolsEnabled;
}

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// MCP Config — Safe Merge
// ---------------------------------------------------------------------------

/**
 * Builds our MCP server entry (the value, not the whole config file).
 */
async function buildMcpServerEntry(site: Local.Site): Promise<McpServerEntry> {
	const sitePath = getSitePath(site);
	const siteId = site.id;

	const phpVersion = site.services?.php?.version || '';
	const mysqlService = site.services?.mysql || (site.services as any)?.mariadb;
	const mysqlVersion = mysqlService?.version || '';
	const mysqlServiceName = mysqlService?.name || 'mysql';

	const phpBin = await findPhpBinary(phpVersion);
	const mysqlBin = await findMysqlBinary(mysqlVersion, mysqlServiceName);
	const mysqlSocket = findMysqlSocket(siteId);
	const wpCliBin = await findWpCli(phpVersion);
	const mysqlPort = mysqlService?.ports?.MYSQL?.[0];

	const domain = site.domain || '';
	const siteUrl = `https://${domain}`;

	const env: Record<string, string> = {
		SITE_PATH: sitePath,
		SITE_ID: siteId,
		WP_PATH: path.join(sitePath, 'app', 'public'),
		DB_NAME: site.mysql?.database || 'local',
		DB_USER: site.mysql?.user || 'root',
		DB_PASSWORD: site.mysql?.password || 'root',
		SITE_DOMAIN: domain,
		SITE_URL: siteUrl,
		LOG_PATH: path.join(sitePath, 'logs'),
		BRIDGE_SOCKET: BRIDGE_SOCKET_PATH,
	};

	if (mysqlSocket) env.DB_SOCKET = mysqlSocket;
	if (mysqlPort) {
		env.DB_PORT = String(mysqlPort);
		env.DB_HOST = '127.0.0.1';
	} else if (process.platform === 'win32') {
		env.DB_HOST = '127.0.0.1';
	}
	if (phpBin) env.PHP_BIN = phpBin;
	if (mysqlBin) env.MYSQL_BIN = mysqlBin;
	if (wpCliBin) env.WP_CLI_BIN = wpCliBin;

	return {
		command: process.execPath,
		args: [path.join(sitePath, '.agent-tools', 'mcp-server', 'build', 'index.js')],
		env: {
			ELECTRON_RUN_AS_NODE: '1',
			...env,
		},
	};
}

/**
 * Safely merges our MCP server entry into an existing MCP config file.
 * Creates the file (and parent directories) if it doesn't exist.
 * Preserves all other entries in the file.
 */
async function mergeMcpConfig(configPath: string, serverEntry: McpServerEntry): Promise<void> {
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

	if (!existing.mcpServers || typeof existing.mcpServers !== 'object') {
		existing.mcpServers = {};
	}

	existing.mcpServers[MCP_SERVER_KEY] = serverEntry;

	await fs.ensureDir(path.dirname(configPath));
	await fs.writeJSON(configPath, existing, { spaces: 2 });
}

/**
 * Removes our MCP server entry from a config file.
 * If the file becomes empty (no other servers), deletes it.
 * If the file has other servers, leaves them intact.
 */
async function removeMcpConfigEntry(configPath: string): Promise<void> {
	if (!await fs.pathExists(configPath)) return;

	try {
		const existing = await fs.readJSON(configPath);
		if (existing?.mcpServers?.[MCP_SERVER_KEY]) {
			delete existing.mcpServers[MCP_SERVER_KEY];

			if (Object.keys(existing.mcpServers).length === 0) {
				// Check if there's anything else in the file besides mcpServers
				const otherKeys = Object.keys(existing).filter(k => k !== 'mcpServers');
				if (otherKeys.length === 0) {
					await fs.remove(configPath);
					// Clean up empty parent dirs (e.g. .cursor/, .windsurf/, .vscode/)
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
 * Only removes directories that we might have created (.cursor, .windsurf, .vscode, .github).
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
	} catch {}
}

// ---------------------------------------------------------------------------
// Project Context — Safe Merge with Markers
// ---------------------------------------------------------------------------

/**
 * Generates the project context content (the WordPress site info).
 */
async function generateProjectContext(site: Local.Site): Promise<string> {
	const sitePath = getSitePath(site);
	const phpVersion = site.services?.php?.version || 'unknown';
	const mysqlService = site.services?.mysql || (site.services as any)?.mariadb;
	const mysqlVersion = mysqlService?.version || 'unknown';
	const webServer = site.services?.nginx ? 'nginx' : (site.services as any)?.apache ? 'Apache' : 'unknown';
	const multiSite = (site as any).multiSite;
	const multisiteType = multiSite === 'ms-subdomain' ? 'Yes (subdomain)' : multiSite === 'ms-subdirectory' ? 'Yes (subdirectory)' : 'No';

	let pluginsSection = '';
	let themeSection = '';
	let wpVersion = '';

	const wpCliBin = await findWpCli(phpVersion);
	const phpBin = await findPhpBinary(phpVersion);

	if (wpCliBin && phpBin) {
		const wpPath = path.join(sitePath, 'app', 'public');
		const wpCliEnv: NodeJS.ProcessEnv = { ...process.env, PHP: phpBin };
		const mysqlSocket = findMysqlSocket(site.id);

		try {
			const isWpCliPhar = wpCliBin.endsWith('.phar');
			const wpCmd = isWpCliPhar ? phpBin : wpCliBin;
			const wpBaseArgs = isWpCliPhar
				? [wpCliBin, '--path=' + wpPath]
				: ['--path=' + wpPath];

			if (mysqlSocket) wpCliEnv.DB_SOCKET = mysqlSocket;

			try {
				const versionOutput = await execCommand(wpCmd, [...wpBaseArgs, 'core', 'version'], { cwd: wpPath, env: wpCliEnv });
				wpVersion = versionOutput.trim();
			} catch { /* site may not be running */ }

			try {
				const pluginOutput = await execCommand(wpCmd, [...wpBaseArgs, 'plugin', 'list', '--status=active', '--format=csv', '--fields=name,version'], { cwd: wpPath, env: wpCliEnv });
				const lines = pluginOutput.trim().split('\n').slice(1);
				if (lines.length > 0 && lines[0]) {
					pluginsSection = '\n## Active Plugins\n' + lines.map(line => {
						const [name, version] = line.split(',');
						return `- ${name} ${version || ''}`.trim();
					}).join('\n') + '\n';
				}
			} catch { /* site may not be running */ }

			try {
				const themeOutput = await execCommand(wpCmd, [...wpBaseArgs, 'theme', 'list', '--status=active', '--format=csv', '--fields=name,version'], { cwd: wpPath, env: wpCliEnv });
				const lines = themeOutput.trim().split('\n').slice(1);
				if (lines.length > 0 && lines[0]) {
					themeSection = '\n## Active Theme\n' + lines.map(line => {
						const [name, version] = line.split(',');
						return `- ${name} ${version || ''}`.trim();
					}).join('\n') + '\n';
				}
			} catch { /* site may not be running */ }
		} catch {
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
}

/**
 * Writes project context to a file. For CLAUDE.md (which we fully own),
 * we write the whole file. For shared context files (.cursorrules, etc.),
 * we use markers to manage only our section.
 */
async function writeContextFile(filePath: string, content: string, agent: AgentTarget): Promise<void> {
	if (agent === 'claude') {
		// CLAUDE.md — we own this file entirely
		await fs.ensureDir(path.dirname(filePath));
		await fs.writeFile(filePath, content, 'utf-8');
		return;
	}

	// For other agents, use marked sections to avoid overwriting user content
	const markedContent = `${CONTEXT_MARKER_START}\n${content}\n${CONTEXT_MARKER_END}`;

	await fs.ensureDir(path.dirname(filePath));

	if (await fs.pathExists(filePath)) {
		let existing = await fs.readFile(filePath, 'utf-8');

		// Check if we already have a marked section — update it
		const markerRegex = new RegExp(
			`${escapeRegex(CONTEXT_MARKER_START)}[\\s\\S]*?${escapeRegex(CONTEXT_MARKER_END)}`,
			'g'
		);

		if (markerRegex.test(existing)) {
			existing = existing.replace(markerRegex, markedContent);
			await fs.writeFile(filePath, existing, 'utf-8');
		} else {
			// Append our section
			const separator = existing.endsWith('\n') ? '\n' : '\n\n';
			await fs.writeFile(filePath, existing + separator + markedContent + '\n', 'utf-8');
		}
	} else {
		await fs.writeFile(filePath, markedContent + '\n', 'utf-8');
	}
}

/**
 * Removes our marked section from a context file.
 * For CLAUDE.md, removes the whole file (we own it).
 * For other files, removes only our marked section.
 * If the file becomes empty after removal, deletes it.
 */
async function removeContextFile(filePath: string, agent: AgentTarget): Promise<void> {
	if (!await fs.pathExists(filePath)) return;

	if (agent === 'claude') {
		await fs.remove(filePath);
		return;
	}

	let content = await fs.readFile(filePath, 'utf-8');

	const markerRegex = new RegExp(
		`\\n?${escapeRegex(CONTEXT_MARKER_START)}[\\s\\S]*?${escapeRegex(CONTEXT_MARKER_END)}\\n?`,
		'g'
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

async function updateGitignore(dirPath: string, agents: AgentTarget[]): Promise<void> {
	const gitignorePath = path.join(dirPath, '.gitignore');

	let content = '';
	if (await fs.pathExists(gitignorePath)) {
		content = await fs.readFile(gitignorePath, 'utf-8');
	}

	// Remove existing marked block
	const markerRegex = new RegExp(
		`\\n?${escapeRegex(GITIGNORE_MARKER_START)}[\\s\\S]*?${escapeRegex(GITIGNORE_MARKER_END)}\\n?`,
		'g'
	);
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

	await fs.writeFile(gitignorePath, content, 'utf-8');
}

// ---------------------------------------------------------------------------
// Core Functions
// ---------------------------------------------------------------------------

/**
 * Sets up Agent Tools for a site with the specified agent targets.
 */
async function setupSite(site: Local.Site, notifier: any, projectDir: string, agents: AgentTarget[]): Promise<void> {
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

	await fs.remove(mcpServerDest);
	await fs.ensureDir(mcpServerDest);

	await fs.copy(mcpServerSrc, mcpServerDest);

	// 2. Build the MCP server entry once (same for all agents)
	const serverEntry = await buildMcpServerEntry(site);

	// 3. Generate project context once (same content for all agents)
	const contextContent = await generateProjectContext(site);

	// 4. For each selected agent, write configs
	for (const agent of agents) {
		const config = AGENT_TARGETS[agent];

		// Write MCP config (merge into existing)
		const mcpConfigPath = path.join(projectPath, config.mcpConfigPath);
		await mergeMcpConfig(mcpConfigPath, serverEntry);

		// Write project context
		const contextPath = path.join(projectPath, config.contextFilePath);
		await writeContextFile(contextPath, contextContent, agent);

		// Copy skills if supported
		if (config.supportsSkills) {
			const skillsSrc = path.join(getBundledPath(), 'skills');
			const skillsDest = path.join(projectPath, '.claude', 'skills');
			await fs.ensureDir(skillsDest);

			for (const skillName of MANAGED_SKILLS) {
				const skillSrcDir = path.join(skillsSrc, skillName);
				const skillDestDir = path.join(skillsDest, skillName);
				if (await fs.pathExists(skillSrcDir)) {
					await fs.copy(skillSrcDir, skillDestDir, { overwrite: true });
				}
			}
		}
	}

	// 5. Update .gitignore
	await updateGitignore(projectPath, agents);

	// 6. Store state
	LocalMain.SiteData.updateSite(site.id, {
		customOptions: {
			...(site as any).customOptions,
			agentToolsEnabled: true,
			agentToolsProjectDir: projectDir,
			agentToolsAgents: agents,
		},
	} as any);

	const agentLabels = agents.map(a => AGENT_TARGETS[a].label).join(', ');
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

	// 1. Remove .agent-tools/ directory from site root
	await fs.remove(path.join(sitePath, '.agent-tools'));

	// 2. For each agent, remove our config entries
	for (const agent of agents) {
		const config = AGENT_TARGETS[agent];

		// Remove MCP config entry (not the whole file)
		await removeMcpConfigEntry(path.join(projectPath, config.mcpConfigPath));

		// Remove context file / our section
		await removeContextFile(path.join(projectPath, config.contextFilePath), agent);

		// Remove managed skills if applicable
		if (config.supportsSkills) {
			for (const skillName of MANAGED_SKILLS) {
				await fs.remove(path.join(projectPath, '.claude', 'skills', skillName));
			}

			// Clean up empty directories (only if we emptied them)
			const skillsDir = path.join(projectPath, '.claude', 'skills');
			try {
				const remaining = await fs.readdir(skillsDir);
				if (remaining.length === 0) await fs.remove(skillsDir);
			} catch { /* directory may not exist */ }

			const claudeDir = path.join(projectPath, '.claude');
			try {
				const remaining = await fs.readdir(claudeDir);
				if (remaining.length === 0) await fs.remove(claudeDir);
			} catch { /* directory may not exist */ }
		}
	}

	// 3. Clean up .gitignore
	await updateGitignore(projectPath, []);

	// 4. Unmark site
	const customOptions = { ...(site as any).customOptions };
	delete customOptions.agentToolsEnabled;
	delete customOptions.agentToolsProjectDir;
	delete customOptions.agentToolsAgents;

	LocalMain.SiteData.updateSite(site.id, { customOptions } as any);

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
		const config = AGENT_TARGETS[agent];

		await removeMcpConfigEntry(path.join(oldPath, config.mcpConfigPath));
		await removeContextFile(path.join(oldPath, config.contextFilePath), agent);

		if (config.supportsSkills) {
			for (const skillName of MANAGED_SKILLS) {
				await fs.remove(path.join(oldPath, '.claude', 'skills', skillName));
			}
			const oldSkillsDir = path.join(oldPath, '.claude', 'skills');
			try {
				const remaining = await fs.readdir(oldSkillsDir);
				if (remaining.length === 0) await fs.remove(oldSkillsDir);
			} catch {}
			const oldClaudeDir = path.join(oldPath, '.claude');
			try {
				const remaining = await fs.readdir(oldClaudeDir);
				if (remaining.length === 0) await fs.remove(oldClaudeDir);
			} catch {}
		}
	}
	await updateGitignore(oldPath, []);

	// Write configs to new location
	const serverEntry = await buildMcpServerEntry(site);
	const contextContent = await generateProjectContext(site);

	for (const agent of agents) {
		const config = AGENT_TARGETS[agent];

		await mergeMcpConfig(path.join(newPath, config.mcpConfigPath), serverEntry);
		await writeContextFile(path.join(newPath, config.contextFilePath), contextContent, agent);

		if (config.supportsSkills) {
			const skillsSrc = path.join(getBundledPath(), 'skills');
			const skillsDest = path.join(newPath, '.claude', 'skills');
			await fs.ensureDir(skillsDest);
			for (const skillName of MANAGED_SKILLS) {
				const skillSrcDir = path.join(skillsSrc, skillName);
				const skillDestDir = path.join(skillsDest, skillName);
				if (await fs.pathExists(skillSrcDir)) {
					await fs.copy(skillSrcDir, skillDestDir, { overwrite: true });
				}
			}
		}
	}

	await updateGitignore(newPath, agents);

	// Update stored preference
	LocalMain.SiteData.updateSite(site.id, {
		customOptions: {
			...(site as any).customOptions,
			agentToolsProjectDir: newProjectDir,
		},
	} as any);

	notifier.notify({
		title: 'Agent Tools',
		message: `Project directory changed to "${newProjectDir || 'site root'}" for "${site.name}".`,
		open: undefined,
	});
}

/**
 * Updates which agents are configured for an already-enabled site.
 * Adds configs for newly selected agents, removes configs for deselected ones.
 */
async function updateAgents(site: Local.Site, newAgents: AgentTarget[], notifier: any): Promise<void> {
	if (!isAgentToolsEnabled(site)) return;

	const sitePath = getSitePath(site);
	const projectDir = getStoredProjectDir(site);
	const projectPath = getProjectPath(sitePath, projectDir);
	const oldAgents = getStoredAgents(site);

	const added = newAgents.filter(a => !oldAgents.includes(a));
	const removed = oldAgents.filter(a => !newAgents.includes(a));

	// Remove configs for deselected agents
	for (const agent of removed) {
		const config = AGENT_TARGETS[agent];

		await removeMcpConfigEntry(path.join(projectPath, config.mcpConfigPath));
		await removeContextFile(path.join(projectPath, config.contextFilePath), agent);

		if (config.supportsSkills) {
			for (const skillName of MANAGED_SKILLS) {
				await fs.remove(path.join(projectPath, '.claude', 'skills', skillName));
			}
			const skillsDir = path.join(projectPath, '.claude', 'skills');
			try {
				const remaining = await fs.readdir(skillsDir);
				if (remaining.length === 0) await fs.remove(skillsDir);
			} catch {}
			const claudeDir = path.join(projectPath, '.claude');
			try {
				const remaining = await fs.readdir(claudeDir);
				if (remaining.length === 0) await fs.remove(claudeDir);
			} catch {}
		}
	}

	// Add configs for newly selected agents
	if (added.length > 0) {
		const serverEntry = await buildMcpServerEntry(site);
		const contextContent = await generateProjectContext(site);

		for (const agent of added) {
			const config = AGENT_TARGETS[agent];

			await mergeMcpConfig(path.join(projectPath, config.mcpConfigPath), serverEntry);
			await writeContextFile(path.join(projectPath, config.contextFilePath), contextContent, agent);

			if (config.supportsSkills) {
				const skillsSrc = path.join(getBundledPath(), 'skills');
				const skillsDest = path.join(projectPath, '.claude', 'skills');
				await fs.ensureDir(skillsDest);
				for (const skillName of MANAGED_SKILLS) {
					const skillSrcDir = path.join(skillsSrc, skillName);
					const skillDestDir = path.join(skillsDest, skillName);
					if (await fs.pathExists(skillSrcDir)) {
						await fs.copy(skillSrcDir, skillDestDir, { overwrite: true });
					}
				}
			}
		}
	}

	// Update .gitignore with new agent set
	await updateGitignore(projectPath, newAgents);

	// Store updated agents
	LocalMain.SiteData.updateSite(site.id, {
		customOptions: {
			...(site as any).customOptions,
			agentToolsAgents: newAgents,
		},
	} as any);

	const agentLabels = newAgents.map(a => AGENT_TARGETS[a].label).join(', ');
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

	const serverEntry = await buildMcpServerEntry(site);
	const contextContent = await generateProjectContext(site);

	for (const agent of agents) {
		const config = AGENT_TARGETS[agent];

		await mergeMcpConfig(path.join(projectPath, config.mcpConfigPath), serverEntry);
		await writeContextFile(path.join(projectPath, config.contextFilePath), contextContent, agent);
	}
}

async function getStatus(site: Local.Site): Promise<AgentToolsStatus> {
	const sitePath = getSitePath(site);
	const enabled = isAgentToolsEnabled(site);
	const projectDir = getStoredProjectDir(site);
	const agents = getStoredAgents(site);
	const mcpServerInstalled = await fs.pathExists(path.join(sitePath, '.agent-tools', 'mcp-server', 'node_modules'));

	// Check if any MCP config exists
	const projectPath = getProjectPath(sitePath, projectDir);
	let configExists = false;
	for (const agent of agents) {
		const config = AGENT_TARGETS[agent];
		if (await fs.pathExists(path.join(projectPath, config.mcpConfigPath))) {
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
}

// ---------------------------------------------------------------------------
// Bridge Server
// ---------------------------------------------------------------------------

async function handleBridgeRequest(request: BridgeRequest): Promise<BridgeResponse> {
	try {
		const serviceContainer = LocalMain.getServiceContainer();
		const siteProcessManager = serviceContainer.cradle.siteProcessManager;

		switch (request.action) {
			case 'list': {
				const sites = LocalMain.SiteData.getSites();
				const statuses = siteProcessManager.getSiteStatuses();
				const siteList = Object.values(sites).map((site: Local.Site) => ({
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
				await siteProcessManager.start(site);
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
				await siteProcessManager.stop(site);
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
				await siteProcessManager.restart(site);
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
				return { success: false, error: `Unknown action: ${(request as any).action}` };
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('[Agent Tools] Bridge request error:', message);
		return { success: false, error: message };
	}
}

function startBridgeServer(): net.Server {
	if (process.platform !== 'win32') {
		// Ensure the socket directory exists with owner-only permissions
		fs.ensureDirSync(BRIDGE_SOCKET_DIR, { mode: 0o700 });
		try {
			fs.removeSync(BRIDGE_SOCKET_PATH);
		} catch {
			// Ignore — file may not exist
		}
	}

	const server = net.createServer((socket: net.Socket) => {
		let buffer = '';

		socket.on('data', (chunk: Buffer) => {
			buffer += chunk.toString();

			let newlineIdx: number;
			while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
				const raw = buffer.slice(0, newlineIdx).trim();
				buffer = buffer.slice(newlineIdx + 1);

				if (!raw) continue;

				let request: BridgeRequest;
				try {
					request = JSON.parse(raw);
				} catch {
					const errResp: BridgeResponse = { success: false, error: 'Invalid JSON' };
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
							const errResp: BridgeResponse = {
								success: false,
								error: err instanceof Error ? err.message : String(err),
							};
							socket.write(JSON.stringify(errResp) + '\n');
						}
					});
			}
		});

		socket.on('error', (err: Error) => {
			console.error('[Agent Tools] Bridge socket connection error:', err.message);
		});
	});

	server.on('error', (err: Error) => {
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

export default function (context: LocalMain.AddonMainContext): void {
	const { notifier, electron } = context;

	const bridgeServer = startBridgeServer();

	electron.app.on('will-quit', () => {
		try {
			bridgeServer.close();
			if (process.platform !== 'win32') {
				fs.removeSync(BRIDGE_SOCKET_PATH);
			}
		} catch {
			// Best-effort cleanup
		}
	});

	electron.ipcMain.handle('agent-tools:enable-site', async (_event: any, siteId: string, projectDir: string, agents: AgentTarget[]) => {
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
	});

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
			return { enabled: false, configExists: false, mcpServerInstalled: false, sitePath: '', projectDir: '', agents: [] };
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

	electron.ipcMain.handle('agent-tools:change-project-dir', async (_event: any, siteId: string, newProjectDir: string) => {
		try {
			const site = LocalMain.SiteData.getSite(siteId);
			await changeProjectDir(site, newProjectDir || '', notifier);
			return { success: true };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error('[Agent Tools] Change project dir failed:', message);
			return { success: false, error: message };
		}
	});

	LocalMain.HooksMain.addAction('siteStarted', async (site: Local.Site) => {
		if (isAgentToolsEnabled(site)) {
			try {
				await regenerateConfig(site);
				console.log(`[Agent Tools] Config regenerated for "${site.name}" on site start.`);
			} catch (err) {
				console.error('[Agent Tools] Failed to regenerate config on site start:', err);
			}
		}
	});
}
