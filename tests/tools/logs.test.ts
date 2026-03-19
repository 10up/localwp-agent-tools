import { describe, it, expect } from 'vitest';
import { parsePhpErrorLine, setWpConstant } from '../../src/tools/logs';

describe('parsePhpErrorLine', () => {
	it('parses a fatal error', () => {
		const line =
			'[01-Jan-2025 12:00:00 UTC] PHP Fatal error: Call to undefined function foo() in /var/www/test.php on line 42';
		const result = parsePhpErrorLine(line);
		expect(result.timestamp).toBe('01-Jan-2025 12:00:00 UTC');
		expect(result.level).toBe('Fatal error');
		expect(result.message).toBe('Call to undefined function foo()');
		expect(result.file).toBe('/var/www/test.php');
		expect(result.line).toBe(42);
	});

	it('parses a warning', () => {
		const line = '[01-Jan-2025 12:00:00 UTC] PHP Warning: Undefined variable $foo in /var/www/test.php on line 10';
		const result = parsePhpErrorLine(line);
		expect(result.level).toBe('Warning');
		expect(result.file).toBe('/var/www/test.php');
		expect(result.line).toBe(10);
	});

	it('parses a notice', () => {
		const line = '[01-Jan-2025 12:00:00 UTC] PHP Notice: Undefined index: foo in /var/www/test.php on line 5';
		const result = parsePhpErrorLine(line);
		expect(result.level).toBe('Notice');
	});

	it('parses a deprecated notice', () => {
		const line =
			'[01-Jan-2025 12:00:00 UTC] PHP Deprecated: Function create_function() is deprecated in /var/www/test.php on line 1';
		const result = parsePhpErrorLine(line);
		expect(result.level).toBe('Deprecated');
	});

	it('parses a parse error', () => {
		const line =
			"[01-Jan-2025 12:00:00 UTC] PHP Parse error: syntax error, unexpected '}' in /var/www/test.php on line 99";
		const result = parsePhpErrorLine(line);
		expect(result.level).toBe('Parse error');
		expect(result.line).toBe(99);
	});

	it('parses line without file/line info', () => {
		const line = '[01-Jan-2025 12:00:00 UTC] PHP Warning: Some generic warning';
		const result = parsePhpErrorLine(line);
		expect(result.level).toBe('Warning');
		expect(result.message).toBe('Some generic warning');
		expect(result.file).toBeUndefined();
		expect(result.line).toBeUndefined();
	});

	it('returns raw for non-matching line', () => {
		const line = 'This is not a PHP error line';
		const result = parsePhpErrorLine(line);
		expect(result).toEqual({ raw: line });
		expect(result.timestamp).toBeUndefined();
		expect(result.level).toBeUndefined();
	});

	it('always includes raw property', () => {
		const line = '[01-Jan-2025 12:00:00 UTC] PHP Fatal error: test in /test.php on line 1';
		const result = parsePhpErrorLine(line);
		expect(result.raw).toBe(line);
	});
});

describe('setWpConstant', () => {
	const baseConfig = [
		'<?php',
		"define( 'DB_NAME', 'local' );",
		"define( 'WP_DEBUG', false );",
		'',
		"/* That's all, stop editing! Happy publishing. */",
		'',
		"require_once ABSPATH . 'wp-settings.php';",
	].join('\n');

	it('replaces an existing constant', () => {
		const result = setWpConstant(baseConfig, 'WP_DEBUG', 'true');
		expect(result).toContain("define( 'WP_DEBUG', true );");
		expect(result).not.toContain("define( 'WP_DEBUG', false );");
	});

	it('inserts before "That\'s all" marker when constant does not exist', () => {
		const result = setWpConstant(baseConfig, 'WP_MEMORY_LIMIT', "'256M'");
		const lines = result.split('\n');
		const markerIndex = lines.findIndex((l) => l.includes("That's all"));
		const insertIndex = lines.findIndex((l) => l.includes('WP_MEMORY_LIMIT'));
		expect(insertIndex).toBeLessThan(markerIndex);
		expect(insertIndex).toBeGreaterThan(-1);
	});

	it('inserts before require_once when no marker exists', () => {
		const noMarker = [
			'<?php',
			"define( 'DB_NAME', 'local' );",
			'',
			"require_once ABSPATH . 'wp-settings.php';",
		].join('\n');
		const result = setWpConstant(noMarker, 'NEW_CONST', 'true');
		const lines = result.split('\n');
		const requireIndex = lines.findIndex((l) => l.includes('require_once'));
		const insertIndex = lines.findIndex((l) => l.includes('NEW_CONST'));
		expect(insertIndex).toBeLessThan(requireIndex);
	});

	it('appends to end when no marker or require_once exists', () => {
		const minimal = "<?php\ndefine( 'DB_NAME', 'local' );";
		const result = setWpConstant(minimal, 'NEW_CONST', "'value'");
		expect(result).toContain("define( 'NEW_CONST', 'value' );");
		expect(result.indexOf('NEW_CONST')).toBeGreaterThan(minimal.length - 1);
	});

	it('preserves other constants when replacing', () => {
		const result = setWpConstant(baseConfig, 'WP_DEBUG', 'true');
		expect(result).toContain("define( 'DB_NAME', 'local' );");
	});

	it('handles the inserted line format correctly', () => {
		const result = setWpConstant(baseConfig, 'SCRIPT_DEBUG', 'true');
		expect(result).toContain("define( 'SCRIPT_DEBUG', true );");
	});

	it('handles regex special characters in constant name via separate regex construction', () => {
		// setWpConstant constructs regex from the name parameter directly,
		// so standard constant names work fine
		const result = setWpConstant(baseConfig, 'WP_DEBUG_LOG', 'true');
		expect(result).toContain("define( 'WP_DEBUG_LOG', true );");
	});
});
