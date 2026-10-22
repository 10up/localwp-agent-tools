import * as LocalMain from '@getflywheel/local/main';
import { launchAgentShell } from './launch';
import { normalizeSettings, sitesUsing } from './settings';
import {
	allSiteOverrides,
	getSite,
	getSiteOverride,
	isValidOverride,
	loadSettings,
	saveSettings,
	setSiteOverride,
} from './store';

const CHANNELS = [
	'agent-tools:agent-shell-launch',
	'agent-tools:agent-shell-get-settings',
	'agent-tools:agent-shell-save-settings',
	'agent-tools:agent-shell-get-site-agent',
	'agent-tools:agent-shell-set-site-agent',
	'agent-tools:agent-shell-sites-using',
] as const;

/** Registers the IPC handlers behind the Agent Shell button, its preferences and the site panel. */
export function registerAgentShell(context: LocalMain.AddonMainContext): void {
	const { ipcMain } = context.electron;

	for (const channel of CHANNELS) {
		ipcMain.removeHandler(channel);
	}

	ipcMain.handle('agent-tools:agent-shell-launch', (_e: unknown, siteId: unknown) =>
		launchAgentShell(context, siteId),
	);

	ipcMain.handle('agent-tools:agent-shell-get-settings', () => loadSettings());

	ipcMain.handle('agent-tools:agent-shell-save-settings', (_e: unknown, settings: unknown) => {
		const normalized = normalizeSettings(settings);
		saveSettings(normalized);
		return normalized;
	});

	ipcMain.handle('agent-tools:agent-shell-get-site-agent', (_e: unknown, siteId: unknown) => {
		const site = getSite(siteId);
		return site ? getSiteOverride(site.id) : 'default';
	});

	ipcMain.handle('agent-tools:agent-shell-set-site-agent', (_e: unknown, siteId: unknown, value: unknown) => {
		const site = getSite(siteId);
		if (!site) return { ok: false };

		const valid = isValidOverride(value, loadSettings());
		if (!valid) return { ok: false };

		setSiteOverride(site.id, value);
		return { ok: true };
	});

	ipcMain.handle('agent-tools:agent-shell-sites-using', (_e: unknown, instanceId: unknown) =>
		typeof instanceId === 'string' ? sitesUsing(instanceId, allSiteOverrides()) : 0,
	);
}
