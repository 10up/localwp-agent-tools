import { describe, it, expect } from 'vitest';
import { allToolDefinitions, globalToolDefinitions, siteScopedToolNames, handleToolCall } from '../../src/tools/index';
import type { SiteConfig } from '../../src/helpers/site-config';
import type { LocalApi } from '../../src/tools/environment';

const mockConfig: SiteConfig = {
	siteId: 'test-site',
	sitePath: '/tmp/test-site',
	wpPath: '/tmp/test-site/app/public',
	phpBin: '/usr/bin/php',
	phpIniDir: '/tmp/test-site/conf/php',
	wpCliBin: '/usr/local/bin/wp',
	mysqlBin: '/usr/bin/mysql',
	dbName: 'local',
	dbUser: 'root',
	dbPassword: 'root',
	dbSocket: '/tmp/mysql.sock',
	dbPort: 3306,
	dbHost: 'localhost',
	siteDomain: 'test.local',
	siteUrl: 'http://test.local',
	logPath: '/tmp/test-site/logs',
};

const mockLocalApi: LocalApi = {
	startSite: async () => ({ id: 'test', status: 'running' }),
	stopSite: async () => ({ id: 'test', status: 'halted' }),
	restartSite: async () => ({ id: 'test', status: 'running' }),
	getSiteStatus: async () => ({ id: 'test', status: 'running' }),
	listSites: async () => [],
	createSite: async (opts) => ({
		id: 'new-site',
		name: opts.name,
		domain: 'new-site.local',
		path: '/tmp/new-site',
		url: 'http://new-site.local',
		status: 'adding',
		phpVersion: '8.2.29',
		database: 'mysql-8.4.0',
		webServer: 'nginx-1.26.1',
		multisite: 'none',
		wpAdminUsername: 'admin',
		wpAdminPassword: 'admin',
		wpAdminEmail: 'dev-email@wpengine.local',
		agentToolsEnabled: false,
		pending: true,
	}),
	listServiceVersions: async () => ({ php: [], database: [], webServer: [], note: '' }),
	enableAgentTools: async () => mockAgentToolsStatus,
	disableAgentTools: async () => ({ ...mockAgentToolsStatus, enabled: false, mcpUrl: null }),
	getAgentToolsStatus: async () => [mockAgentToolsStatus],
};

const mockAgentToolsStatus = {
	id: 'test-site',
	name: 'Test Site',
	domain: 'test.local',
	sitePath: '/tmp/test-site',
	projectDir: '',
	enabled: true,
	agents: ['claude' as const],
	registered: true,
	mcpUrl: 'http://localhost:24842/sites/test-site/mcp',
};

describe('allToolDefinitions', () => {
	it('contains expected tool names', () => {
		const names = allToolDefinitions.map((t) => t.name);
		expect(names).toContain('wp_cli');
		expect(names).toContain('read_wp_config');
		expect(names).toContain('edit_wp_config');
		expect(names).toContain('read_error_log');
		expect(names).toContain('get_site_info');
		expect(names).toContain('site_start');
		expect(names).toContain('list_sites');
		expect(names).toContain('create_site');
		expect(names).toContain('list_service_versions');
		expect(names).toContain('enable_agent_tools');
		expect(names).toContain('disable_agent_tools');
		expect(names).toContain('agent_tools_status');
	});

	it('each tool has name, description, and inputSchema', () => {
		for (const tool of allToolDefinitions) {
			expect(tool.name).toBeTruthy();
			expect(tool.description).toBeTruthy();
			expect(tool.inputSchema).toBeDefined();
			expect(tool.inputSchema.type).toBe('object');
		}
	});
});

describe('globalToolDefinitions', () => {
	it('is a strict subset of the full surface', () => {
		const all = new Set(allToolDefinitions.map((t) => t.name));
		for (const tool of globalToolDefinitions) {
			expect(all.has(tool.name)).toBe(true);
		}
		expect(globalToolDefinitions.length).toBeLessThan(allToolDefinitions.length);
	});

	it('carries the Local-wide tools', () => {
		const names = globalToolDefinitions.map((t) => t.name);
		expect(names).toContain('list_sites');
		expect(names).toContain('create_site');
		expect(names).toContain('list_service_versions');
		expect(names).toContain('site_start');
		expect(names).toContain('enable_agent_tools');
		expect(names).toContain('disable_agent_tools');
		expect(names).toContain('agent_tools_status');
	});

	it('excludes every tool that needs a bound site', () => {
		const names = globalToolDefinitions.map((t) => t.name);
		for (const scoped of siteScopedToolNames) {
			expect(names).not.toContain(scoped);
		}
		expect([...siteScopedToolNames]).toContain('wp_cli');
		expect([...siteScopedToolNames]).toContain('read_error_log');
		expect([...siteScopedToolNames]).toContain('get_site_info');
	});
});

describe('handleToolCall', () => {
	it('returns error for unknown tool name listing available tools', async () => {
		const result = await handleToolCall('nonexistent_tool', {}, mockConfig, mockLocalApi);
		expect(result.content[0].text).toContain('Unknown tool');
		expect(result.content[0].text).toContain('nonexistent_tool');
		expect(result.content[0].text).toContain('wp_cli');
	});

	it('lists only the global tools when there is no bound site', async () => {
		const result = await handleToolCall('nonexistent_tool', {}, null, mockLocalApi);
		expect(result.content[0].text).toContain('list_sites');
		expect(result.content[0].text).not.toContain('wp_cli');
	});

	it('refuses a site-scoped tool with no bound site', async () => {
		const result = await handleToolCall('wp_cli', { command: 'plugin list' }, null, mockLocalApi);
		expect(result.content[0].text).toContain('not available on the global endpoint');
		expect(result.content[0].text).toContain('/sites/{siteId}/mcp');
	});

	it('runs a Local-wide tool with no bound site', async () => {
		const result = await handleToolCall('agent_tools_status', {}, null, mockLocalApi);
		expect(result.content[0].text).toContain('test-site');
	});

	it('requires an explicit siteId for site_status with no bound site', async () => {
		const result = await handleToolCall('site_status', {}, null, mockLocalApi);
		expect(result.content[0].text).toContain('No siteId provided');
	});
});
