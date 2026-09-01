import { describe, it, expect } from 'vitest';
import {
	BUILT_IN_SITE_DEFAULTS,
	deriveDomain,
	deriveSitePath,
	formatSiteNicename,
	validateNewSite,
	ValidateNewSiteContext,
} from '../../src/helpers/new-site';

describe('formatSiteNicename', () => {
	it('slugifies a display name', () => {
		expect(formatSiteNicename('Crazy Name!')).toBe('crazy-name');
	});

	it('collapses repeated separators and trims them', () => {
		expect(formatSiteNicename('  --My   Cool -- Site--  ')).toBe('my-cool-site');
	});

	it('drops characters that are not letters, digits, spaces or dashes', () => {
		expect(formatSiteNicename('Ünïcødé & Co. #1')).toBe('ncd-co-1');
	});

	it('returns an empty string when nothing usable is left', () => {
		expect(formatSiteNicename('!!!')).toBe('');
	});
});

describe('deriveDomain', () => {
	it('appends the configured tld', () => {
		expect(deriveDomain('my-site', '.local')).toBe('my-site.local');
	});

	it('tolerates a tld without a leading dot', () => {
		expect(deriveDomain('my-site', 'test')).toBe('my-site.test');
	});
});

describe('deriveSitePath', () => {
	it('joins the sites directory and the nicename', () => {
		expect(deriveSitePath('/Users/dev/Local Sites', 'my-site')).toBe('/Users/dev/Local Sites/my-site');
	});

	it('normalizes a trailing separator on the sites directory', () => {
		expect(deriveSitePath('/Users/dev/Local Sites/', 'my-site')).toBe('/Users/dev/Local Sites/my-site');
	});
});

describe('BUILT_IN_SITE_DEFAULTS', () => {
	it("matches Local's own new-site defaults", () => {
		expect(BUILT_IN_SITE_DEFAULTS.sitesPath).toBe('~/Local Sites/');
		expect(BUILT_IN_SITE_DEFAULTS.tld).toBe('.local');
	});
});

describe('validateNewSite', () => {
	const baseCtx: ValidateNewSiteContext = {
		existingSites: [{ domain: 'taken.local', path: '/Users/dev/Local Sites/taken' }],
		defaultSitesPath: '/Users/dev/Local Sites',
		pathHasLocalData: false,
		platform: 'darwin',
	};

	const validInput = {
		name: 'My Site',
		domain: 'my-site.local',
		sitePath: '/Users/dev/Local Sites/my-site',
	};

	it('accepts a well-formed new site', () => {
		expect(validateNewSite(validInput, baseCtx)).toBeNull();
	});

	it('rejects an empty name', () => {
		expect(validateNewSite({ ...validInput, name: '   ' }, baseCtx)).toMatch(/name is required/i);
	});

	it('rejects a name with no usable characters', () => {
		expect(validateNewSite({ ...validInput, name: '!!!' }, baseCtx)).toMatch(/letters or numbers/i);
	});

	it('rejects an invalid domain', () => {
		expect(validateNewSite({ ...validInput, domain: 'not a domain' }, baseCtx)).toMatch(
			/not a valid local domain/i,
		);
	});

	it('rejects a domain already used by another site', () => {
		expect(validateNewSite({ ...validInput, domain: 'taken.local' }, baseCtx)).toMatch(/already taken/i);
	});

	it('rejects a path already used by another site', () => {
		const input = { ...validInput, sitePath: '/Users/dev/Local Sites/taken' };
		expect(validateNewSite(input, baseCtx)).toMatch(/already taken/i);
	});

	it('ignores a trailing separator when comparing paths', () => {
		const input = { ...validInput, sitePath: '/Users/dev/Local Sites/taken/' };
		expect(validateNewSite(input, baseCtx)).toMatch(/already taken/i);
	});

	it('rejects the default sites directory itself', () => {
		const input = { ...validInput, sitePath: '/Users/dev/Local Sites' };
		expect(validateNewSite(input, baseCtx)).toMatch(/cannot be the default sites directory/i);
	});

	it('rejects a path that already holds Local site data', () => {
		expect(validateNewSite(validInput, { ...baseCtx, pathHasLocalData: true })).toMatch(
			/existing Local site data/i,
		);
	});

	it('rejects a macOS path outside /Users and /Volumes', () => {
		const input = { ...validInput, sitePath: '/opt/sites/my-site' };
		expect(validateNewSite(input, baseCtx)).toMatch(/\/Users or \/Volumes/);
	});

	it('accepts a macOS path under /Volumes', () => {
		const input = { ...validInput, sitePath: '/Volumes/External/my-site' };
		expect(validateNewSite(input, baseCtx)).toBeNull();
	});

	const winCtx: ValidateNewSiteContext = {
		...baseCtx,
		existingSites: [],
		defaultSitesPath: 'C:\\Users\\dev\\Local Sites',
		platform: 'win32',
	};

	it('rejects a Windows C: path outside C:\\Users', () => {
		const input = { ...validInput, sitePath: 'C:\\sites\\my-site' };
		expect(validateNewSite(input, winCtx)).toMatch(/C:\\Users/);
	});

	it('accepts a Windows path under C:\\Users', () => {
		const input = { ...validInput, sitePath: 'C:\\Users\\dev\\Local Sites\\my-site' };
		expect(validateNewSite(input, winCtx)).toBeNull();
	});

	it('accepts a Windows path on another drive', () => {
		const input = { ...validInput, sitePath: 'D:\\sites\\my-site' };
		expect(validateNewSite(input, winCtx)).toBeNull();
	});

	it('rejects a Windows drive root', () => {
		const input = { ...validInput, sitePath: 'D:\\' };
		expect(validateNewSite(input, winCtx)).toMatch(/root of a drive/i);
	});

	it('rejects a Windows network path', () => {
		const input = { ...validInput, sitePath: '\\\\server\\share\\my-site' };
		expect(validateNewSite(input, winCtx)).toMatch(/network drive/i);
	});
});
