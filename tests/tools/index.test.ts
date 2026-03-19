import { describe, it, expect } from 'vitest';
import { allToolDefinitions, handleToolCall } from '../../src/tools/index';
import type { SiteConfig } from '../../src/helpers/site-config';
import type { LocalApi } from '../../src/tools/environment';

const mockConfig: SiteConfig = {
	siteId: 'test-site',
	sitePath: '/tmp/test-site',
	wpPath: '/tmp/test-site/app/public',
	phpBin: '/usr/bin/php',
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

describe('handleToolCall', () => {
	it('returns error for unknown tool name listing available tools', async () => {
		const result = await handleToolCall('nonexistent_tool', {}, mockConfig, mockLocalApi);
		expect(result.content[0].text).toContain('Unknown tool');
		expect(result.content[0].text).toContain('nonexistent_tool');
		expect(result.content[0].text).toContain('wp_cli');
	});
});
