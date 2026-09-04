import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parseDefineConstants, isSecretConstant, handleTool } from '../../src/tools/config';
import type { SiteConfig } from '../../src/helpers/site-config';

describe('parseDefineConstants', () => {
	it('parses a standard single-quoted define', () => {
		const result = parseDefineConstants("define( 'DB_NAME', 'wordpress' );");
		expect(result).toEqual({ DB_NAME: 'wordpress' });
	});

	it('parses boolean true', () => {
		const result = parseDefineConstants("define( 'WP_DEBUG', true );");
		expect(result).toEqual({ WP_DEBUG: 'true' });
	});

	it('parses boolean false', () => {
		const result = parseDefineConstants("define( 'WP_DEBUG', false );");
		expect(result).toEqual({ WP_DEBUG: 'false' });
	});

	it('parses numeric value', () => {
		const result = parseDefineConstants("define( 'WP_MEMORY_LIMIT', 256 );");
		expect(result).toEqual({ WP_MEMORY_LIMIT: '256' });
	});

	it('parses double-quoted value', () => {
		const result = parseDefineConstants('define( "DB_HOST", "localhost" );');
		expect(result).toEqual({ DB_HOST: 'localhost' });
	});

	it('parses multiple defines', () => {
		const content = [
			"define( 'DB_NAME', 'local' );",
			"define( 'DB_USER', 'root' );",
			"define( 'DB_PASSWORD', 'root' );",
		].join('\n');
		const result = parseDefineConstants(content);
		expect(result).toEqual({
			DB_NAME: 'local',
			DB_USER: 'root',
			DB_PASSWORD: 'root',
		});
	});

	it('returns empty object for empty input', () => {
		expect(parseDefineConstants('')).toEqual({});
	});

	it('handles whitespace variations', () => {
		const result = parseDefineConstants("define('DB_NAME'  ,  'wordpress'  );");
		expect(result).toEqual({ DB_NAME: 'wordpress' });
	});
});

describe('isSecretConstant', () => {
	it('flags DB_PASSWORD', () => {
		expect(isSecretConstant('DB_PASSWORD')).toBe(true);
	});

	it('flags constants ending in _KEY', () => {
		expect(isSecretConstant('AUTH_KEY')).toBe(true);
		expect(isSecretConstant('SECURE_AUTH_KEY')).toBe(true);
		expect(isSecretConstant('LOGGED_IN_KEY')).toBe(true);
		expect(isSecretConstant('NONCE_KEY')).toBe(true);
	});

	it('flags constants ending in _SALT', () => {
		expect(isSecretConstant('AUTH_SALT')).toBe(true);
		expect(isSecretConstant('SECURE_AUTH_SALT')).toBe(true);
		expect(isSecretConstant('NONCE_SALT')).toBe(true);
	});

	it('flags constants starting with NONCE_', () => {
		expect(isSecretConstant('NONCE_KEY')).toBe(true);
		expect(isSecretConstant('NONCE_SALT')).toBe(true);
	});

	it('does not flag ordinary constants', () => {
		expect(isSecretConstant('DB_NAME')).toBe(false);
		expect(isSecretConstant('DB_USER')).toBe(false);
		expect(isSecretConstant('DB_HOST')).toBe(false);
		expect(isSecretConstant('WP_DEBUG')).toBe(false);
		expect(isSecretConstant('WP_MEMORY_LIMIT')).toBe(false);
	});
});

describe('read_wp_config secret redaction', () => {
	const SECRET_CONFIG_TEMPLATE = `<?php
define( 'DB_NAME', 'local' );
define( 'DB_USER', 'root' );
define( 'DB_PASSWORD', 'super-secret-pw' );
define( 'DB_HOST', 'localhost' );
define( 'AUTH_KEY', 'auth-key-secret' );
define( 'SECURE_AUTH_SALT', 'secure-auth-salt-secret' );
define( 'NONCE_KEY', 'nonce-key-secret' );
define( 'NONCE_SALT', 'nonce-salt-secret' );

define( 'WP_DEBUG', false );

$table_prefix = 'wp_';

/* That's all, stop editing! Happy publishing. */

require_once ABSPATH . 'wp-settings.php';
`;

	function makeTempSiteConfig(tmpDir: string): SiteConfig {
		return {
			siteId: 'redaction-test',
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

	let tmpDir: string;
	let config: SiteConfig;

	beforeEach(() => {
		tmpDir = mkdtempSync(path.join(os.tmpdir(), 'agent-tools-config-redaction-test-'));
		config = makeTempSiteConfig(tmpDir);
		writeFileSync(path.join(tmpDir, 'wp-config.php'), SECRET_CONFIG_TEMPLATE, 'utf-8');
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it('redacts secrets by default in parsed output and leaves other constants intact', async () => {
		const result = await handleTool('read_wp_config', {}, config);
		const parsed = JSON.parse(result.content[0].text);

		expect(parsed.constants.DB_PASSWORD).toBe('[redacted]');
		expect(parsed.constants.AUTH_KEY).toBe('[redacted]');
		expect(parsed.constants.SECURE_AUTH_SALT).toBe('[redacted]');
		expect(parsed.constants.NONCE_KEY).toBe('[redacted]');
		expect(parsed.constants.NONCE_SALT).toBe('[redacted]');

		expect(parsed.constants.DB_NAME).toBe('local');
		expect(parsed.constants.DB_USER).toBe('root');
		expect(parsed.constants.WP_DEBUG).toBe('false');
		expect(parsed.constants.DB_HOST).toBe('localhost');
	});

	it('returns real values in parsed output when includeSecrets is true', async () => {
		const result = await handleTool('read_wp_config', { includeSecrets: true }, config);
		const parsed = JSON.parse(result.content[0].text);

		expect(parsed.constants.DB_PASSWORD).toBe('super-secret-pw');
		expect(parsed.constants.AUTH_KEY).toBe('auth-key-secret');
		expect(parsed.constants.SECURE_AUTH_SALT).toBe('secure-auth-salt-secret');
		expect(parsed.constants.NONCE_KEY).toBe('nonce-key-secret');
		expect(parsed.constants.NONCE_SALT).toBe('nonce-salt-secret');
	});

	it('has no real secret values in raw output by default, but keeps other content intact', async () => {
		const result = await handleTool('read_wp_config', { raw: true }, config);
		const text = result.content[0].text;

		expect(text).not.toContain('super-secret-pw');
		expect(text).not.toContain('auth-key-secret');
		expect(text).not.toContain('secure-auth-salt-secret');
		expect(text).not.toContain('nonce-key-secret');
		expect(text).not.toContain('nonce-salt-secret');

		expect(text).toContain("define( 'DB_NAME', 'local' );");
		expect(text).toContain("define( 'DB_PASSWORD', '[redacted]' );");
	});

	it('returns real values in raw output when includeSecrets is true', async () => {
		const result = await handleTool('read_wp_config', { raw: true, includeSecrets: true }, config);
		const text = result.content[0].text;

		expect(text).toContain("define( 'DB_PASSWORD', 'super-secret-pw' );");
	});
});
