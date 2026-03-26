import { describe, it, expect, beforeEach } from 'vitest';
import { SiteConfigRegistry, SiteConfig } from '../../src/helpers/site-config';

function makeSiteConfig(overrides: Partial<SiteConfig> = {}): SiteConfig {
	return {
		siteId: 'test-site-1',
		sitePath: '/home/user/Local Sites/test-site',
		wpPath: '/home/user/Local Sites/test-site/app/public',
		phpBin: '/usr/bin/php',
		phpIniDir: '/home/user/Library/Application Support/Local/run/test-site-1/conf/php',
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
		logPath: '/home/user/Local Sites/test-site/app/logs',
		...overrides,
	};
}

describe('SiteConfigRegistry', () => {
	let registry: SiteConfigRegistry;

	beforeEach(() => {
		registry = new SiteConfigRegistry();
	});

	it('registers and retrieves a config', () => {
		const config = makeSiteConfig();
		registry.register(config);
		expect(registry.get('test-site-1')).toBe(config);
	});

	it('returns undefined for unknown site', () => {
		expect(registry.get('nonexistent')).toBeUndefined();
	});

	it('has() returns true for registered site', () => {
		registry.register(makeSiteConfig());
		expect(registry.has('test-site-1')).toBe(true);
	});

	it('has() returns false for unregistered site', () => {
		expect(registry.has('nonexistent')).toBe(false);
	});

	it('unregisters a site', () => {
		registry.register(makeSiteConfig());
		registry.unregister('test-site-1');
		expect(registry.has('test-site-1')).toBe(false);
		expect(registry.get('test-site-1')).toBeUndefined();
	});

	it('getAll returns all registered configs', () => {
		const config1 = makeSiteConfig({ siteId: 'site-1' });
		const config2 = makeSiteConfig({ siteId: 'site-2' });
		registry.register(config1);
		registry.register(config2);
		expect(registry.getAll()).toHaveLength(2);
		expect(registry.getAll()).toContain(config1);
		expect(registry.getAll()).toContain(config2);
	});

	it('getAllIds returns all registered site IDs', () => {
		registry.register(makeSiteConfig({ siteId: 'site-a' }));
		registry.register(makeSiteConfig({ siteId: 'site-b' }));
		const ids = registry.getAllIds();
		expect(ids).toContain('site-a');
		expect(ids).toContain('site-b');
	});

	it('overwrites config on re-register with same siteId', () => {
		const original = makeSiteConfig({ dbName: 'original' });
		const updated = makeSiteConfig({ dbName: 'updated' });
		registry.register(original);
		registry.register(updated);
		expect(registry.get('test-site-1')?.dbName).toBe('updated');
		expect(registry.getAll()).toHaveLength(1);
	});

	it('empty registry returns empty arrays', () => {
		expect(registry.getAll()).toEqual([]);
		expect(registry.getAllIds()).toEqual([]);
	});
});
