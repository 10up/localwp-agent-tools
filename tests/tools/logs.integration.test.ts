import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { handleTool } from '../../src/tools/logs';
import type { SiteConfig } from '../../src/helpers/site-config';

function makeTempSiteConfig(tmpDir: string): SiteConfig {
	const logPath = path.join(tmpDir, 'logs');
	mkdirSync(path.join(logPath, 'php'), { recursive: true });
	mkdirSync(path.join(logPath, 'nginx'), { recursive: true });
	mkdirSync(path.join(tmpDir, 'app', 'public', 'wp-content'), { recursive: true });

	return {
		siteId: 'integration-test',
		sitePath: tmpDir,
		wpPath: path.join(tmpDir, 'app', 'public'),
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
		logPath,
	};
}

describe('logs integration tests (real file I/O)', () => {
	let tmpDir: string;
	let config: SiteConfig;

	beforeEach(() => {
		tmpDir = mkdtempSync(path.join(os.tmpdir(), 'agent-tools-logs-test-'));
		config = makeTempSiteConfig(tmpDir);
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it('reads PHP error log and returns structured entries', async () => {
		const logContent = [
			'[01-Jan-2025 12:00:00 UTC] PHP Warning: Undefined variable $test in /var/www/test.php on line 10',
			'[01-Jan-2025 12:01:00 UTC] PHP Fatal error: Call to undefined function foo() in /var/www/test.php on line 42',
		].join('\n');

		writeFileSync(path.join(config.logPath, 'php', 'error.log'), logContent, 'utf-8');

		const result = await handleTool('read_error_log', { lines: 50 }, config);
		const parsed = JSON.parse(result.content[0].text);
		expect(parsed.totalLines).toBe(2);
		expect(parsed.entries).toHaveLength(2);
		expect(parsed.entries[0].level).toBe('Warning');
		expect(parsed.entries[1].level).toBe('Fatal error');
	});

	it('filters error log by keyword', async () => {
		const logContent = [
			'[01-Jan-2025 12:00:00 UTC] PHP Warning: Something happened in /test.php on line 1',
			'[01-Jan-2025 12:01:00 UTC] PHP Fatal error: Memory exhausted in /test.php on line 2',
			'[01-Jan-2025 12:02:00 UTC] PHP Warning: Another warning in /test.php on line 3',
		].join('\n');

		writeFileSync(path.join(config.logPath, 'php', 'error.log'), logContent, 'utf-8');

		const result = await handleTool('read_error_log', { lines: 50, filter: 'Fatal' }, config);
		const parsed = JSON.parse(result.content[0].text);
		expect(parsed.showing).toBe(1);
		expect(parsed.entries[0].level).toBe('Fatal error');
	});

	it('reads nginx access log', async () => {
		const logContent = [
			'127.0.0.1 - - [01/Jan/2025:12:00:00 +0000] "GET / HTTP/1.1" 200 1234',
			'127.0.0.1 - - [01/Jan/2025:12:00:01 +0000] "GET /wp-admin/ HTTP/1.1" 302 0',
		].join('\n');

		writeFileSync(path.join(config.logPath, 'nginx', 'access.log'), logContent, 'utf-8');

		const result = await handleTool('read_access_log', { lines: 50 }, config);
		const parsed = JSON.parse(result.content[0].text);
		expect(parsed.totalLines).toBe(2);
		expect(parsed.lines).toHaveLength(2);
	});

	it('returns error message when log file does not exist', async () => {
		const result = await handleTool('read_error_log', {}, config);
		expect(result.content[0].text).toContain('not found');
	});

	it('handles large log files without OOM', async () => {
		// Write a 1MB log file (many repeated lines)
		const singleLine = '[01-Jan-2025 12:00:00 UTC] PHP Warning: Test warning in /test.php on line 1\n';
		const lineCount = Math.ceil((1024 * 1024) / singleLine.length);
		const bigLog = singleLine.repeat(lineCount);

		writeFileSync(path.join(config.logPath, 'php', 'error.log'), bigLog, 'utf-8');

		const result = await handleTool('read_error_log', { lines: 10 }, config);
		const parsed = JSON.parse(result.content[0].text);
		expect(parsed.showing).toBe(10);
		expect(parsed.totalLines).toBeGreaterThan(100);
	});
});
