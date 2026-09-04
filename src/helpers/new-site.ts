import * as path from 'path';

/**
 * Helpers for deriving and validating the details of a brand-new Local site.
 *
 * These mirror what Local's own "Add Site" UI does before it hands off to
 * AddSiteService, minus the interactive dialogs — see Local's
 * shared/helpers/format-site-nicename, main/_helpers/sanitizeDomain and
 * renderer/_helpers/validate-site-info.
 */

/** Local's `new-site-defaults` user setting, as far as we care about it. */
export interface NewSiteDefaults {
	sitesPath: string;
	tld: string;
	adminEmail: string;
	siteLanguage: string;
}

/** Local's built-in defaults, used when the user hasn't overridden them. */
export const BUILT_IN_SITE_DEFAULTS: NewSiteDefaults = {
	sitesPath: '~/Local Sites/',
	tld: '.local',
	adminEmail: 'dev-email@wpengine.local',
	siteLanguage: 'en_US',
};

/** Same pattern Local validates new site domains against. */
const HOSTNAME_PATTERN =
	/^(([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9])\.)*([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9])$/;

/**
 * Format a site name so it plays nicely with paths and domains.
 * "Crazy Name!" becomes "crazy-name".
 */
export function formatSiteNicename(siteName: string): string {
	return siteName
		.replace(/[^a-z0-9\s-]/gi, '')
		.replace(/\s/gi, '-')
		.replace(/-{2,}/gi, '-')
		.replace(/^-+/gi, '')
		.replace(/-+$/gi, '')
		.toLowerCase();
}

/** Build the default domain for a site — `<nicename><tld>`, e.g. `my-site.local`. */
export function deriveDomain(nicename: string, tld: string): string {
	const suffix = tld.startsWith('.') ? tld : `.${tld}`;
	return `${nicename}${suffix}`;
}

/** Build the default path for a site — `<sitesPath>/<nicename>`. */
export function deriveSitePath(sitesPath: string, nicename: string): string {
	return path.join(sitesPath, nicename);
}

export interface ExistingSite {
	domain: string;
	path: string;
}

export interface ValidateNewSiteInput {
	name: string;
	domain: string;
	/** Absolute, `~` already expanded. */
	sitePath: string;
}

export interface ValidateNewSiteContext {
	/** Every site Local already knows about, with `~` already expanded in `path`. */
	existingSites: ExistingSite[];
	/** The configured default sites directory, absolute and `~` already expanded. */
	defaultSitesPath: string;
	/** Whether the target path already contains Local's `app` or `conf` directory. */
	pathHasLocalData: boolean;
	platform: NodeJS.Platform;
}

/**
 * Validate a prospective new site. Returns an error message, or null when valid.
 */
export function validateNewSite(input: ValidateNewSiteInput, ctx: ValidateNewSiteContext): string | null {
	const { name, domain, sitePath } = input;

	if (!name.trim()) {
		return 'Site name is required.';
	}

	if (!formatSiteNicename(name)) {
		return `"${name}" does not contain any letters or numbers, so it cannot be turned into a site name.`;
	}

	if (!HOSTNAME_PATTERN.test(domain)) {
		return `"${domain}" is not a valid local domain.`;
	}

	const takenDomain = ctx.existingSites.find((site) => site.domain === domain);
	if (takenDomain) {
		return `The domain "${domain}" is already taken by another site. Pass a different name or domain.`;
	}

	const normalize = (p: string) => stripTrailingSep(path.normalize(p));

	if (normalize(sitePath) === normalize(ctx.defaultSitesPath)) {
		return `The site path cannot be the default sites directory itself (${ctx.defaultSitesPath}).`;
	}

	const takenPath = ctx.existingSites.find((site) => normalize(site.path) === normalize(sitePath));
	if (takenPath) {
		return `The path "${sitePath}" is already taken by another site. Pass a different name or path.`;
	}

	if (ctx.pathHasLocalData) {
		return `"${sitePath}" already has existing Local site data. Pass a different name or path.`;
	}

	if (ctx.platform === 'darwin') {
		if (!/^\/(Users|Volumes)\/.+/.test(sitePath)) {
			return `On macOS the site path must be under /Users or /Volumes. Got "${sitePath}".`;
		}
	} else if (ctx.platform === 'win32') {
		if (sitePath.startsWith('\\\\')) {
			return 'Network drives cannot be used for Local sites.';
		}
		if (/^[a-z]:\\?$/i.test(sitePath)) {
			return 'The root of a drive cannot be used as the site path.';
		}
		if (sitePath.toLowerCase().startsWith('c:') && !sitePath.toLowerCase().startsWith('c:\\users')) {
			return `On Windows a path on the C: drive must be under C:\\Users. Got "${sitePath}".`;
		}
	}

	return null;
}

function stripTrailingSep(p: string): string {
	return p.length > 1 ? p.replace(/[\\/]+$/, '') : p;
}
