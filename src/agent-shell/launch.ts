import * as fs from 'fs';
import * as path from 'path';
import * as LocalMain from '@getflywheel/local/main';
import { readLoginPath, resolveBinary } from './binary';
import { openWithCommand } from './destinations/custom';
import { openInGhostty } from './destinations/ghostty';
import { openInHerdr } from './destinations/herdr';
import type { LaunchTarget } from './destinations/types';
import { agentCommand, buildLaunchScript, launchScriptPath } from './launchScript';
import { instanceLabel, resolveOpen, type Settings } from './settings';
import { getSite, getSiteOverride, loadSettings } from './store';
import type * as Local from '@getflywheel/local';

/** Local's site shell service, with the custom snippet argument its typings omit. */
type ShellEntryService = { createShellEntry(site: Local.Site, customShellEntry: string): Promise<void> };

type Result = { ok: boolean; error?: string };

const SCRIPT_DIR = 'agent-tools-agent-shell';
const SCRIPT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Opens the site in the configured destination, as a shell or running the
 * Claude instance chosen for the site. Each call writes its own launch script.
 */
export async function launchAgentShell(context: LocalMain.AddonMainContext, siteId: unknown): Promise<Result> {
	const site = getSite(siteId);
	if (!site) return { ok: false, error: 'Unknown site.' };

	const home: string = context.environment.userHome;
	const userDataPath: string = context.environment.userDataPath;

	try {
		const settings = loadSettings();
		const instance = resolveOpen(settings, getSiteOverride(site.id));

		const needsLoginPath = instance !== null || settings.destination === 'custom';
		const loginPath = needsLoginPath ? await readLoginPath() : '';

		// The binary is checked before anything opens.
		let agentLine: string | null = null;
		if (instance) {
			const binaryPath = resolveBinary(instance.binary, home, loginPath);
			agentLine = agentCommand(instance, binaryPath, home, loginPath);
		}

		// Local writes its second argument into the script as is, and its typings leave it out.
		const { siteShellEntry } = LocalMain.getServiceContainer().cradle;
		const shellEntry = siteShellEntry as unknown as ShellEntryService;
		await shellEntry.createShellEntry(site, '');
		const entry = fs.readFileSync(path.join(userDataPath, 'ssh-entry', `${site.id}.sh`), 'utf8');

		// Ghostty and custom commands execute the file directly, so it needs a shebang.
		const script = `#!/bin/zsh\n${buildLaunchScript(entry, agentLine)}`;
		const scriptDir = path.join(userDataPath, SCRIPT_DIR);
		fs.mkdirSync(scriptDir, { recursive: true });
		removeOldScripts(scriptDir);
		const scriptPath = launchScriptPath(scriptDir, site.id, Date.now());
		fs.writeFileSync(scriptPath, script, { mode: 0o700 });

		const target: LaunchTarget = {
			siteName: site.name,
			webRoot: site.paths.webRoot,
			scriptPath,
			tabLabel: instance ? instanceLabel(instance) : 'Shell',
			home,
		};
		await openTarget(settings, target, loginPath);
		return { ok: true };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('[Agent Tools] opening the agent shell failed:', err);
		context.notifier.notify({ title: 'Agent Shell', message, open: undefined });
		return { ok: false, error: message };
	}
}

async function openTarget(settings: Settings, target: LaunchTarget, loginPath: string): Promise<void> {
	switch (settings.destination) {
		case 'ghostty':
			await openInGhostty(target);
			break;
		case 'custom':
			await openWithCommand(settings.customCommand, target, loginPath);
			break;
		case 'herdr':
		default:
			await openInHerdr(target);
			break;
	}
}

function removeOldScripts(dir: string): void {
	const cutoff = Date.now() - SCRIPT_MAX_AGE_MS;
	for (const name of fs.readdirSync(dir)) {
		if (!name.startsWith('launch-') || !name.endsWith('.sh')) continue;
		const file = path.join(dir, name);
		try {
			const modified = fs.statSync(file).mtimeMs;
			if (modified < cutoff) fs.unlinkSync(file);
		} catch (err) {
			console.error('[Agent Tools] removing an old launch script failed:', err);
		}
	}
}
