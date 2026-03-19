import { describe, it, expect } from 'vitest';
import { splitArgs } from '../../src/tools/wpcli';

describe('splitArgs', () => {
	it('splits simple space-separated args', () => {
		expect(splitArgs('post list --format=json')).toEqual(['post', 'list', '--format=json']);
	});

	it('handles single-quoted strings', () => {
		expect(splitArgs("option update blogname 'My Site'")).toEqual(['option', 'update', 'blogname', 'My Site']);
	});

	it('handles double-quoted strings', () => {
		expect(splitArgs('option update blogname "My Site"')).toEqual(['option', 'update', 'blogname', 'My Site']);
	});

	it('handles multiple consecutive spaces', () => {
		expect(splitArgs('post   list   --format=json')).toEqual(['post', 'list', '--format=json']);
	});

	it('returns empty array for empty string', () => {
		expect(splitArgs('')).toEqual([]);
	});

	it('handles mixed quotes', () => {
		expect(splitArgs(`option update desc "it's a test"`)).toEqual(['option', 'update', 'desc', "it's a test"]);
	});

	it('handles leading and trailing spaces', () => {
		expect(splitArgs('  post list  ')).toEqual(['post', 'list']);
	});

	it('handles empty quoted string', () => {
		expect(splitArgs('option update key ""')).toEqual(['option', 'update', 'key']);
	});

	it('handles single arg', () => {
		expect(splitArgs('version')).toEqual(['version']);
	});

	it('preserves content inside quotes with spaces', () => {
		expect(splitArgs('search-replace "old value" "new value" --dry-run')).toEqual([
			'search-replace',
			'old value',
			'new value',
			'--dry-run',
		]);
	});
});
