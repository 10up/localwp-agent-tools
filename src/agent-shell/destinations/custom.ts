import { spawn } from 'child_process';
import { shellQuote } from '../launchScript';
import type { LaunchTarget } from './types';

/** How long a command may run before it counts as started; an exit within it is checked. */
const STARTUP_WINDOW_MS = 1500;

type TemplateValues = { script: string; cwd: string; site: string };

/** Fills {script}, {cwd} and {site}, each quoted for the shell. Other braces are left as typed. */
export function renderTemplate(template: string, values: TemplateValues): string {
	const trimmed = template.trim();
	if (trimmed === '') {
		throw new Error('The custom command is empty. Set it in Preferences › Agent Tools.');
	}

	return template.replace(/\{(script|cwd|site)\}/g, (_match, key: keyof TemplateValues) => shellQuote(values[key]));
}

/**
 * Starts the custom command in the background with the given PATH, so tools
 * installed for the user's login shell are found. Commands that open a window
 * and keep running, such as many terminal launchers, are left running. A
 * command that exits with an error during the first moments is reported with
 * the last line it wrote to stderr.
 */
export function openWithCommand(template: string, target: LaunchTarget, pathEnv: string): Promise<void> {
	const command = renderTemplate(template, {
		script: target.scriptPath,
		cwd: target.webRoot,
		site: target.siteName,
	});

	return new Promise((resolve, reject) => {
		const child = spawn('/bin/zsh', ['-c', command], {
			cwd: target.webRoot,
			detached: true,
			env: { ...process.env, PATH: pathEnv },
			stdio: ['ignore', 'ignore', 'pipe'],
		});

		let stderr = '';
		child.stderr.on('data', (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		const timer = setTimeout(() => {
			child.stderr.destroy();
			child.unref();
			resolve();
		}, STARTUP_WINDOW_MS);

		child.on('error', (err) => {
			clearTimeout(timer);
			reject(err);
		});

		child.on('exit', (code, signal) => {
			clearTimeout(timer);
			if (code === 0) {
				resolve();
				return;
			}

			const lastLine = stderr.trim().split('\n').pop() ?? '';
			const status = signal ? `was stopped by ${signal}` : `exited with code ${code}`;
			const detail = lastLine === '' ? '' : ` ${lastLine}`;
			reject(new Error(`The custom command ${status}.${detail}`));
		});
	});
}
