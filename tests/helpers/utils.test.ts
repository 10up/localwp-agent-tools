import { describe, it, expect, afterEach } from 'vitest';
import { buildWpCliEnv } from '../../src/helpers/utils';
import type { SiteConfig } from '../../src/helpers/site-config';

function makeSiteConfig(overrides: Partial<SiteConfig> = {}): SiteConfig {
	return {
		siteId: 'test-site-1',
		sitePath: '/home/user/Local Sites/test-site',
		wpPath: '/home/user/Local Sites/test-site/app/public',
		phpBin: '/usr/bin/php',
		phpIniDir: null,
		wpCliBin: '/usr/local/bin/wp',
		mysqlBin: '/usr/bin/mysql',
		dbName: 'local',
		dbUser: 'root',
		dbPassword: 'root',
		dbSocket: '/tmp/mysql.sock',
		dbPort: 3306,
		dbHost: 'localhost',
		siteDomain: 'test-site.local',
		siteUrl: 'http://test-site.local',
		logPath: '/home/user/Local Sites/test-site/logs',
		...overrides,
	};
}

describe('buildWpCliEnv', () => {
	const originalEnv = { ...process.env };

	afterEach(() => {
		process.env = { ...originalEnv };
	});

	it('sets PHPRC when phpIniDir is present', () => {
		const config = makeSiteConfig({ phpIniDir: '/some/path/conf/php' });
		const env = buildWpCliEnv(config);
		expect(env.PHPRC).toBe('/some/path/conf/php');
	});

	it('does not set PHPRC when phpIniDir is null', () => {
		const config = makeSiteConfig({ phpIniDir: null });
		delete process.env.PHPRC;
		const env = buildWpCliEnv(config);
		expect(env.PHPRC).toBeUndefined();
	});

	it('overrides inherited PHPRC from process.env', () => {
		process.env.PHPRC = '/old/path';
		const config = makeSiteConfig({ phpIniDir: '/new/path/conf/php' });
		const env = buildWpCliEnv(config);
		expect(env.PHPRC).toBe('/new/path/conf/php');
	});

	it('sets PHP to the configured php binary path', () => {
		const config = makeSiteConfig({ phpBin: '/custom/php' });
		const env = buildWpCliEnv(config);
		expect(env.PHP).toBe('/custom/php');
	});

	it('includes MySQL binary dir in PATH', () => {
		const config = makeSiteConfig({ mysqlBin: '/usr/local/mysql/bin/mysql' });
		const env = buildWpCliEnv(config);
		expect(env.PATH).toContain('/usr/local/mysql/bin');
	});

	it('sets database connection variables', () => {
		const config = makeSiteConfig();
		const env = buildWpCliEnv(config);
		expect(env.DB_NAME).toBe('local');
		expect(env.DB_USER).toBe('root');
		expect(env.DB_PASSWORD).toBe('root');
	});
});
