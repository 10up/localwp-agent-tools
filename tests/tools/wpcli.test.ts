import { describe, it, expect } from 'vitest';
import { splitArgs, isBlockedCommand } from '../../src/tools/wpcli';

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

describe('isBlockedCommand: leading-flag bypass', () => {
	it('blocks a blocked command preceded by a leading flag', () => {
		expect(isBlockedCommand(splitArgs("--skip-plugins eval 'x'"))).toBe('eval');
	});

	it('blocks a blocked command preceded by multiple leading flags', () => {
		expect(isBlockedCommand(splitArgs('--skip-themes --skip-plugins db drop'))).toBe('db drop');
	});

	it('blocks eval-file preceded by --path=', () => {
		expect(isBlockedCommand(splitArgs('--path=/x eval-file a.php'))).toBe('eval-file');
	});

	it('allows a safe command followed by a flag', () => {
		expect(isBlockedCommand(splitArgs('plugin list --skip-plugins'))).toBeNull();
	});
});

describe('isBlockedCommand: dangerous global flags', () => {
	it('blocks --exec with an = value', () => {
		expect(isBlockedCommand(splitArgs("--exec='echo 1;' plugin list"))).toBe('--exec');
	});

	it('blocks --exec with a space-separated value', () => {
		expect(isBlockedCommand(splitArgs("--exec 'echo 1;' plugin list"))).toBe('--exec');
	});

	it('blocks --require=', () => {
		expect(isBlockedCommand(splitArgs('--require=a.php plugin list'))).toBe('--require');
	});

	it('blocks --ssh=', () => {
		expect(isBlockedCommand(splitArgs('--ssh=host plugin list'))).toBe('--ssh');
	});

	it('blocks --http=', () => {
		expect(isBlockedCommand(splitArgs('--http=host plugin list'))).toBe('--http');
	});
});

describe('isBlockedCommand: safe commands remain allowed', () => {
	it('allows a query command', () => {
		expect(isBlockedCommand(splitArgs("db query 'SELECT 1'"))).toBeNull();
	});

	it('allows a command that merely starts with a blocked word', () => {
		expect(isBlockedCommand(splitArgs('evaluate'))).toBeNull();
	});

	it('allows a subcommand that merely starts with a blocked word', () => {
		expect(isBlockedCommand(splitArgs('db droplet'))).toBeNull();
	});
});
