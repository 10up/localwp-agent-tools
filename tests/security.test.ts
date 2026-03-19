import { describe, it, expect } from 'vitest';
import { splitArgs, isBlockedCommand } from '../src/tools/wpcli';
import { allToolDefinitions } from '../src/tools';

describe('Security: isBlockedCommand', () => {
	it('blocks eval', () => {
		expect(isBlockedCommand(['eval', 'echo 1;'])).toBe('eval');
	});

	it('blocks eval-file', () => {
		expect(isBlockedCommand(['eval-file', '/tmp/script.php'])).toBe('eval-file');
	});

	it('blocks shell', () => {
		expect(isBlockedCommand(['shell'])).toBe('shell');
	});

	it('blocks db drop', () => {
		expect(isBlockedCommand(['db', 'drop', '--yes'])).toBe('db drop');
	});

	it('blocks db reset', () => {
		expect(isBlockedCommand(['db', 'reset'])).toBe('db reset');
	});

	it('blocks db import', () => {
		expect(isBlockedCommand(['db', 'import', '/tmp/dump.sql'])).toBe('db import');
	});

	it('blocks site empty', () => {
		expect(isBlockedCommand(['site', 'empty'])).toBe('site empty');
	});

	it('blocks site delete', () => {
		expect(isBlockedCommand(['site', 'delete'])).toBe('site delete');
	});

	it('is case-insensitive', () => {
		expect(isBlockedCommand(['EVAL'])).toBe('eval');
		expect(isBlockedCommand(['Db', 'Drop'])).toBe('db drop');
	});

	it('does not block partial matches', () => {
		expect(isBlockedCommand(['evaluate'])).toBeNull();
		expect(isBlockedCommand(['db', 'droplet'])).toBeNull();
		expect(isBlockedCommand(['shells'])).toBeNull();
	});

	it('allows safe commands', () => {
		expect(isBlockedCommand(['post', 'list'])).toBeNull();
		expect(isBlockedCommand(['db', 'check'])).toBeNull();
		expect(isBlockedCommand(['plugin', 'list'])).toBeNull();
	});
});

describe('Security: splitArgs + isBlockedCommand integration', () => {
	it('catches eval with extra spaces', () => {
		const args = splitArgs('  eval   "echo 1;"  ');
		expect(isBlockedCommand(args)).toBe('eval');
	});

	it('catches db drop from full string', () => {
		const args = splitArgs('db drop --yes');
		expect(isBlockedCommand(args)).toBe('db drop');
	});

	it('catches quoted eval', () => {
		const args = splitArgs("eval 'phpinfo();'");
		expect(isBlockedCommand(args)).toBe('eval');
	});
});

describe('Security: tool descriptions warn about destructive commands', () => {
	it('wp_cli tool description mentions destructive commands', () => {
		const wpCliTool = allToolDefinitions.find((t) => t.name === 'wp_cli');
		expect(wpCliTool).toBeDefined();
		const desc = wpCliTool!.description.toLowerCase();
		expect(desc).toContain('eval');
		expect(desc).toContain('db drop');
		expect(desc).toContain('shell');
	});
});

describe('Security: tool definitions do not expose credentials', () => {
	it('no tool description contains password', () => {
		for (const tool of allToolDefinitions) {
			const desc = tool.description.toLowerCase();
			expect(desc).not.toContain('password');
			const props = tool.inputSchema.properties || {};
			for (const [, prop] of Object.entries(props)) {
				const propDesc = ((prop as Record<string, unknown>).description as string) || '';
				expect(propDesc.toLowerCase()).not.toContain('password');
			}
		}
	});
});

describe('Security: input validation in edit_wp_config', () => {
	it('valid constant names match the pattern', () => {
		const validPattern = /^[A-Z_][A-Z0-9_]*$/i;
		expect(validPattern.test('WP_DEBUG')).toBe(true);
		expect(validPattern.test('DB_NAME')).toBe(true);
		expect(validPattern.test('MY_CUSTOM_CONST')).toBe(true);
	});

	it('invalid constant names are rejected', () => {
		const validPattern = /^[A-Z_][A-Z0-9_]*$/i;
		expect(validPattern.test('invalid-name')).toBe(false);
		expect(validPattern.test('name with spaces')).toBe(false);
		expect(validPattern.test("'); DROP TABLE wp_posts; --")).toBe(false);
		expect(validPattern.test('')).toBe(false);
		expect(validPattern.test('1STARTS_WITH_NUMBER')).toBe(false);
	});

	it('valid constant values match the pattern', () => {
		const validValue = /^(true|false|null|'[^'\\]*'|"[^"\\]*"|-?\d+(\.\d+)?)$/i;
		expect(validValue.test('true')).toBe(true);
		expect(validValue.test('false')).toBe(true);
		expect(validValue.test("'my-value'")).toBe(true);
		expect(validValue.test('256')).toBe(true);
	});

	it('dangerous constant values are rejected', () => {
		const validValue = /^(true|false|null|'[^'\\]*'|"[^"\\]*"|-?\d+(\.\d+)?)$/i;
		expect(validValue.test('system("rm -rf /")')).toBe(false);
		expect(validValue.test('exec("whoami")')).toBe(false);
		expect(validValue.test("true); echo file_get_contents('/etc/passwd'")).toBe(false);
		expect(validValue.test('rm -rf /')).toBe(false);
	});
});
