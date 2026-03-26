import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { handleTool } from '../../src/tools/config';
import type { SiteConfig } from '../../src/helpers/site-config';

const WP_CONFIG_TEMPLATE = `<?php
define( 'DB_NAME', 'local' );
define( 'DB_USER', 'root' );
define( 'DB_PASSWORD', 'root' );
define( 'DB_HOST', 'localhost' );
define( 'DB_CHARSET', 'utf8' );
define( 'DB_COLLATE', '' );

define( 'WP_DEBUG', false );

$table_prefix = 'wp_';

/* That's all, stop editing! Happy publishing. */

require_once ABSPATH . 'wp-settings.php';
`;

function makeTempSiteConfig(tmpDir: string): SiteConfig {
	return {
		siteId: 'integration-test',
		sitePath: tmpDir,
		wpPath: tmpDir,
		phpBin: '/usr/bin/php',
		phpIniDir: path.join(tmpDir, 'conf', 'php'),
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
		logPath: path.join(tmpDir, 'logs'),
	};
}

describe('config integration tests (real file I/O)', () => {
	let tmpDir: string;
	let config: SiteConfig;

	beforeEach(() => {
		tmpDir = mkdtempSync(path.join(os.tmpdir(), 'agent-tools-test-'));
		config = makeTempSiteConfig(tmpDir);
		writeFileSync(path.join(tmpDir, 'wp-config.php'), WP_CONFIG_TEMPLATE, 'utf-8');
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it('reads and parses wp-config.php constants', async () => {
		const result = await handleTool('read_wp_config', {}, config);
		const parsed = JSON.parse(result.content[0].text);
		expect(parsed.constants.DB_NAME).toBe('local');
		expect(parsed.constants.DB_USER).toBe('root');
		expect(parsed.constants.WP_DEBUG).toBe('false');
		expect(parsed.tablePrefix).toBe('wp_');
	});

	it('reads raw wp-config.php content', async () => {
		const result = await handleTool('read_wp_config', { raw: true }, config);
		expect(result.content[0].text).toContain("define( 'DB_NAME', 'local' );");
		expect(result.content[0].text).toContain('<?php');
	});

	it('modifies an existing constant', async () => {
		const result = await handleTool('edit_wp_config', { name: 'WP_DEBUG', value: 'true' }, config);
		expect(result.content[0].text).toContain('Updated');

		const content = readFileSync(path.join(tmpDir, 'wp-config.php'), 'utf-8');
		expect(content).toContain("define( 'WP_DEBUG', true );");
		expect(content).not.toContain("define( 'WP_DEBUG', false );");
	});

	it('adds a new constant before the marker', async () => {
		const result = await handleTool('edit_wp_config', { name: 'WP_MEMORY_LIMIT', value: "'256M'" }, config);
		expect(result.content[0].text).toContain('Updated');

		const content = readFileSync(path.join(tmpDir, 'wp-config.php'), 'utf-8');
		expect(content).toContain("define( 'WP_MEMORY_LIMIT', '256M' );");

		const lines = content.split('\n');
		const memoryIndex = lines.findIndex((l) => l.includes('WP_MEMORY_LIMIT'));
		const markerIndex = lines.findIndex((l) => l.includes("That's all"));
		expect(memoryIndex).toBeLessThan(markerIndex);
	});

	it('creates a backup file', async () => {
		await handleTool('edit_wp_config', { name: 'WP_DEBUG', value: 'true' }, config);
		expect(existsSync(path.join(tmpDir, 'wp-config.php.bak'))).toBe(true);

		const backup = readFileSync(path.join(tmpDir, 'wp-config.php.bak'), 'utf-8');
		expect(backup).toContain("define( 'WP_DEBUG', false );");
	});

	it('validates constant names', async () => {
		const result = await handleTool('edit_wp_config', { name: 'invalid-name!', value: 'true' }, config);
		expect(result.content[0].text).toContain('Invalid constant name');
	});

	it('validates constant values', async () => {
		const result = await handleTool('edit_wp_config', { name: 'WP_DEBUG', value: 'rm -rf /' }, config);
		expect(result.content[0].text).toContain('Invalid constant value');
	});
});
