import * as LocalMain from '@getflywheel/local/main';
import type * as Local from '@getflywheel/local';
import { normalizeSettings, type Settings, type SiteOverride } from './settings';

/** Local userData group holding the global settings. */
const SETTINGS_GROUP = 'agent-tools-agent-shell';

/** Site data field holding a site's override. */
const OVERRIDE_FIELD = 'agentToolsAgentShell';

const SITE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export function loadSettings(): Settings {
	const { userData } = LocalMain.getServiceContainer().cradle;
	return normalizeSettings(userData.get(SETTINGS_GROUP, {}));
}

export function saveSettings(settings: Settings): void {
	const { userData } = LocalMain.getServiceContainer().cradle;
	userData.set(SETTINGS_GROUP, settings);
}

export function getSite(siteId: unknown): Local.Site | null {
	if (typeof siteId !== 'string' || !SITE_ID_PATTERN.test(siteId)) return null;
	try {
		return siteData().getSite(siteId);
	} catch {
		return null;
	}
}

export function getSiteOverride(siteId: string): SiteOverride {
	const value = readField(siteId, OVERRIDE_FIELD);
	return typeof value === 'string' ? value : 'default';
}

/** An override is 'default', 'shell' or the id of an existing instance. */
export function isValidOverride(value: unknown, settings: Settings): value is SiteOverride {
	if (value === 'default' || value === 'shell') return true;
	return settings.instances.some((instance) => instance.id === value);
}

export function setSiteOverride(siteId: string, value: SiteOverride): void {
	siteData().updateSite(siteId, { [OVERRIDE_FIELD]: value } as unknown as Partial<Local.SiteJSON>);
}

export function allSiteOverrides(): Array<SiteOverride | undefined> {
	const sites = siteData().getSites();
	return Object.keys(sites).map((id) => {
		const value = readField(id, OVERRIDE_FIELD);
		return typeof value === 'string' ? value : undefined;
	});
}

function siteData(): LocalMain.Services.SiteDataService {
	return LocalMain.getServiceContainer().cradle.siteData;
}

function readField(siteId: string, key: string): unknown {
	const site = siteData().getSite(siteId) as (Local.Site & Record<string, unknown>) | null;
	return site?.[key];
}
