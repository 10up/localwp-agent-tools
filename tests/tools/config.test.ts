import { describe, it, expect } from 'vitest';
import { parseDefineConstants } from '../../src/tools/config';

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
