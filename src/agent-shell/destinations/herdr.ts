import { execFile } from 'child_process';
import { existsSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import * as LocalMain from '@getflywheel/local/main';
import { shellQuote } from '../launchScript';
import type { LaunchTarget } from './types';

const execFileAsync = promisify(execFile);

type Workspace = { workspace_id: string; label: string };

const HERDR_TIMEOUT_MS = 10_000;
const SERVER_WAIT_MS = 15_000;
const SERVER_POLL_MS = 500;
const HERDR_APP = 'Herdr.app';

/** Matches an interactive herdr client: `herdr`, `herdr --session <name>` or `herdr session attach <name>`. */
const TUI_CLIENT_PATTERN = /(^|\/)herdr(\s+--session\s+\S+|\s+session\s+attach\s+\S+)?\s*$/;

/**
 * Opens a new focused tab in the herdr workspace labelled with the site name,
 * creating the workspace when none has that label, and runs the launch script
 * in it. Starts herdr first when its server is not running.
 */
export async function openInHerdr(target: LaunchTarget): Promise<void> {
	const bin = findHerdr(target.home);
	if (!bin) throw new Error('herdr was not found in ~/.local/bin, /opt/homebrew/bin or /usr/local/bin.');

	// Opening herdr starts its server, so the tab is created once the server answers.
	const serverRunning = await isServerRunning(bin);
	if (!serverRunning) {
		await showHerdr(bin, target.home);
		await waitForServer(bin);
	}

	const workspace = await findWorkspace(bin, target.siteName);
	const created = workspace
		? await herdrJson(bin, [
				'tab',
				'create',
				'--workspace',
				workspace,
				'--cwd',
				target.webRoot,
				'--label',
				target.tabLabel,
				'--focus',
			])
		: await herdrJson(bin, ['workspace', 'create', '--cwd', target.webRoot, '--label', target.siteName, '--focus']);

	const pane: string | undefined = created?.result?.root_pane?.pane_id;
	if (!pane) throw new Error('herdr did not return a pane for the new tab.');

	// A new workspace starts with an unnamed first tab.
	const tab: string | undefined = created?.result?.tab?.tab_id;
	if (!workspace && tab) {
		await execFileAsync(bin, ['tab', 'rename', tab, target.tabLabel], { timeout: HERDR_TIMEOUT_MS });
	}

	await execFileAsync(bin, ['pane', 'run', pane, `exec /bin/zsh ${shellQuote(target.scriptPath)}`], {
		timeout: HERDR_TIMEOUT_MS,
	});

	if (serverRunning) {
		await showHerdr(bin, target.home);
	}
}

/** Local starts with the GUI's minimal PATH, so herdr is looked up in its usual install locations. */
function findHerdr(home: string): string | null {
	const candidates = [path.join(home, '.local', 'bin', 'herdr'), '/opt/homebrew/bin/herdr', '/usr/local/bin/herdr'];
	return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function findHerdrApp(home: string): string | null {
	const candidates = [path.join('/Applications', HERDR_APP), path.join(home, 'Applications', HERDR_APP)];
	return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

async function herdrJson(bin: string, args: string[]): Promise<any> {
	const { stdout } = await execFileAsync(bin, args, { timeout: HERDR_TIMEOUT_MS });
	return JSON.parse(stdout);
}

async function isServerRunning(bin: string): Promise<boolean> {
	try {
		await herdrJson(bin, ['workspace', 'list']);
		return true;
	} catch {
		return false;
	}
}

async function waitForServer(bin: string): Promise<void> {
	const deadline = Date.now() + SERVER_WAIT_MS;
	while (Date.now() < deadline) {
		const running = await isServerRunning(bin);
		if (running) return;
		await new Promise((resolve) => setTimeout(resolve, SERVER_POLL_MS));
	}
	throw new Error('The herdr server did not start.');
}

async function findWorkspace(bin: string, label: string): Promise<string | null> {
	const list = await herdrJson(bin, ['workspace', 'list']);
	const workspaces: Workspace[] = list?.result?.workspaces ?? [];
	return workspaces.find((workspace) => workspace.label === label)?.workspace_id ?? null;
}

/**
 * Brings herdr to the front. Herdr UI opens when installed. Otherwise
 * the terminal chosen in Local's preferences comes to the front when a herdr
 * client already runs, or opens a new window running herdr.
 */
async function showHerdr(bin: string, home: string): Promise<void> {
	const app = findHerdrApp(home);
	if (app) {
		await execFileAsync('open', [app]);
		return;
	}

	const { userData } = LocalMain.getServiceContainer().cradle;
	const defaultApps = userData.get('settings-default-apps', {});
	const terminal: string = defaultApps?.defaultTerminal || 'Terminal';

	const clientRunning = await isTuiClientRunning();
	if (clientRunning) {
		await execFileAsync('open', ['-a', terminal]);
		return;
	}

	const launcher = path.join(os.tmpdir(), 'agent-tools-herdr-launcher.sh');
	writeFileSync(launcher, `#!/bin/zsh\nexec ${shellQuote(bin)}\n`, { mode: 0o755 });
	await execFileAsync('open', ['-a', terminal, launcher]);
}

async function isTuiClientRunning(): Promise<boolean> {
	const { stdout } = await execFileAsync('ps', ['-axo', 'args=']);
	return stdout.split('\n').some((line) => TUI_CLIENT_PATTERN.test(line.trim()));
}
