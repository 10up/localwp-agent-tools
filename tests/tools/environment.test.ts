import { describe, it, expect, vi } from 'vitest';
import {
	parseCreateSiteArgs,
	handleTool,
	LocalApi,
	CreateSiteOptions,
	CreateSiteResult,
} from '../../src/tools/environment';
import type { SiteConfig } from '../../src/helpers/site-config';

const mockConfig = { siteId: 'current-site' } as SiteConfig;

function buildResult(overrides: Partial<CreateSiteResult> = {}): CreateSiteResult {
	return {
		id: 'abc123',
		name: 'My Site',
		domain: 'my-site.local',
		path: '/Users/dev/Local Sites/my-site',
		url: 'http://my-site.local',
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
		...overrides,
	};
}

function buildLocalApi(overrides: Partial<LocalApi> = {}): LocalApi {
	return {
		startSite: async () => ({ id: 'x', status: 'running' }),
		stopSite: async () => ({ id: 'x', status: 'halted' }),
		restartSite: async () => ({ id: 'x', status: 'running' }),
		getSiteStatus: async () => ({ id: 'x', status: 'running' }),
		listSites: async () => [],
		createSite: async () => buildResult(),
		listServiceVersions: async () => ({ php: [], database: [], webServer: [], note: 'n/a' }),
		...overrides,
	};
}

describe('parseCreateSiteArgs', () => {
	it('requires a name', () => {
		expect(parseCreateSiteArgs({})).toMatch(/"name" is required/);
		expect(parseCreateSiteArgs({ name: '   ' })).toMatch(/"name" is required/);
		expect(parseCreateSiteArgs({ name: 42 })).toMatch(/"name" is required/);
	});

	it('trims the name and returns options', () => {
		expect(parseCreateSiteArgs({ name: '  My Site  ' })).toEqual({ name: 'My Site' });
	});

	it('passes through optional string fields, trimmed', () => {
		const parsed = parseCreateSiteArgs({
			name: 'My Site',
			domain: ' my-site.test ',
			phpVersion: '8.1.23',
			database: 'mariadb-10.6.23',
		}) as CreateSiteOptions;

		expect(parsed.domain).toBe('my-site.test');
		expect(parsed.phpVersion).toBe('8.1.23');
		expect(parsed.database).toBe('mariadb-10.6.23');
	});

	it('rejects a non-string optional field', () => {
		expect(parseCreateSiteArgs({ name: 'My Site', phpVersion: 8.1 })).toMatch(/"phpVersion" must be a non-empty/);
	});

	it('rejects an empty optional field', () => {
		expect(parseCreateSiteArgs({ name: 'My Site', domain: '  ' })).toMatch(/"domain" must be a non-empty/);
	});

	it('rejects a non-boolean flag', () => {
		expect(parseCreateSiteArgs({ name: 'My Site', wait: 'yes' })).toMatch(/"wait" must be a boolean/);
	});

	it('inverts skipWordPressInstall into installWordPress', () => {
		const skipped = parseCreateSiteArgs({ name: 'My Site', skipWordPressInstall: true }) as CreateSiteOptions;
		expect(skipped.installWordPress).toBe(false);

		const notSkipped = parseCreateSiteArgs({ name: 'My Site', skipWordPressInstall: false }) as CreateSiteOptions;
		expect(notSkipped.installWordPress).toBe(true);
	});

	it('leaves installWordPress undefined when skipWordPressInstall is omitted', () => {
		const parsed = parseCreateSiteArgs({ name: 'My Site' }) as CreateSiteOptions;
		expect(parsed.installWordPress).toBeUndefined();
	});

	it('accepts the documented multisite modes', () => {
		for (const mode of ['none', 'subdirectory', 'subdomain']) {
			const parsed = parseCreateSiteArgs({ name: 'My Site', multisite: mode }) as CreateSiteOptions;
			expect(parsed.multisite).toBe(mode);
		}
	});

	it('rejects an unknown multisite mode', () => {
		expect(parseCreateSiteArgs({ name: 'My Site', multisite: 'network' })).toMatch(/"multisite" must be one of/);
	});

	it('accepts a list of known agents', () => {
		const parsed = parseCreateSiteArgs({ name: 'My Site', agents: ['claude', 'cursor'] }) as CreateSiteOptions;
		expect(parsed.agents).toEqual(['claude', 'cursor']);
	});

	it('rejects unknown agents', () => {
		expect(parseCreateSiteArgs({ name: 'My Site', agents: ['emacs'] })).toMatch(/unknown agent\(s\): emacs/);
	});

	it('rejects an empty agents array', () => {
		expect(parseCreateSiteArgs({ name: 'My Site', agents: [] })).toMatch(/non-empty array/);
	});
});

describe('create_site handler', () => {
	it('does not call createSite when the arguments are invalid', async () => {
		const createSite = vi.fn();
		const localApi = buildLocalApi({ createSite });

		const result = await handleTool('create_site', {}, mockConfig, localApi);

		expect(createSite).not.toHaveBeenCalled();
		expect(result.content[0].text).toMatch(/"name" is required/);
	});

	it('returns the created site and tells the caller to poll while pending', async () => {
		const localApi = buildLocalApi();
		const result = await handleTool('create_site', { name: 'My Site' }, mockConfig, localApi);
		const text = result.content[0].text;

		expect(text).toContain('"id": "abc123"');
		expect(text).toContain('site_status');
		expect(text).toContain('abc123');
	});

	it('omits the polling note when the site is already finished', async () => {
		const localApi = buildLocalApi({
			createSite: async () => buildResult({ status: 'running', pending: false }),
		});

		const result = await handleTool('create_site', { name: 'My Site', wait: true }, mockConfig, localApi);
		expect(result.content[0].text).not.toContain('site_status');
	});

	it('surfaces creation failures as an error message', async () => {
		const localApi = buildLocalApi({
			createSite: async () => {
				throw new Error('The domain "my-site.local" is already taken by another site.');
			},
		});

		const result = await handleTool('create_site', { name: 'My Site' }, mockConfig, localApi);
		expect(result.content[0].text).toMatch(/Failed to create site: The domain/);
	});
});

describe('list_service_versions handler', () => {
	it('returns the available versions as JSON', async () => {
		const localApi = buildLocalApi({
			listServiceVersions: async () => ({
				php: [{ value: '8.2.29', installed: true }],
				database: [{ value: 'mysql-8.4.0', installed: true }],
				webServer: [{ value: 'nginx-1.26.1', installed: false }],
				note: 'omit to use the default',
			}),
		});

		const result = await handleTool('list_service_versions', {}, mockConfig, localApi);
		const parsed = JSON.parse(result.content[0].text);

		expect(parsed.php).toEqual([{ value: '8.2.29', installed: true }]);
		expect(parsed.webServer[0].installed).toBe(false);
	});

	it('surfaces failures as an error message', async () => {
		const localApi = buildLocalApi({
			listServiceVersions: async () => {
				throw new Error('service registry unavailable');
			},
		});

		const result = await handleTool('list_service_versions', {}, mockConfig, localApi);
		expect(result.content[0].text).toMatch(/Failed to list service versions: service registry unavailable/);
	});
});
