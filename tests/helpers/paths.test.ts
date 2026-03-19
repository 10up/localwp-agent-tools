import { describe, it, expect, vi, afterEach } from 'vitest';
import * as os from 'os';
import { resolveSitePath, findMysqlSocket, getLocalDataPath } from '../../src/helpers/paths';

describe('resolveSitePath', () => {
	it('expands tilde to home directory', () => {
		const home = os.homedir();
		expect(resolveSitePath('~/Local Sites/my-site')).toBe(`${home}/Local Sites/my-site`);
	});

	it('returns absolute path unchanged', () => {
		expect(resolveSitePath('/absolute/path/to/site')).toBe('/absolute/path/to/site');
	});

	it('handles tilde with no trailing path', () => {
		const home = os.homedir();
		expect(resolveSitePath('~')).toBe(home);
	});
});

describe('getLocalDataPath', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('returns a string path', () => {
		const result = getLocalDataPath();
		expect(typeof result).toBe('string');
		expect(result.length).toBeGreaterThan(0);
	});

	it('includes Local in the path', () => {
		const result = getLocalDataPath();
		expect(result).toContain('Local');
	});
});

describe('findMysqlSocket', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('returns a path containing the siteId on non-win32', () => {
		// Only test on non-windows (CI runs on ubuntu)
		if (process.platform === 'win32') return;
		const result = findMysqlSocket('test-site-123');
		expect(result).not.toBeNull();
		expect(result).toContain('test-site-123');
		expect(result).toContain('mysqld.sock');
	});

	it('returns path containing mysql directory', () => {
		if (process.platform === 'win32') return;
		const result = findMysqlSocket('my-site');
		expect(result).toContain('mysql');
	});
});
