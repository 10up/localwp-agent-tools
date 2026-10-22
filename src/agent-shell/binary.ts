import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { expandHome } from './launchScript';

const execFileAsync = promisify(execFile);

const LOGIN_PATH_TIMEOUT_MS = 10_000;

/**
 * Absolute path for a configured binary: a path is used as given (after `~`
 * expansion), a bare name is searched in pathEnv. Shell functions and aliases
 * of the same name are never involved.
 */
export function resolveBinary(binary: string, home: string, pathEnv: string): string {
	const name = expandHome(binary.trim(), home);

	if (name.includes('/')) {
		if (isExecutableFile(name)) return name;
		throw new Error(`${binary} is not an executable file.`);
	}

	for (const dir of pathEnv.split(':')) {
		if (dir === '') continue;
		const candidate = path.join(dir, name);
		if (isExecutableFile(candidate)) return candidate;
	}

	throw new Error(`${binary} was not found in your PATH.`);
}

/**
 * The PATH of the user's interactive login shell, where tools installed in
 * places like ~/.local/bin are added. Local itself starts with the GUI's
 * minimal PATH.
 */
export async function readLoginPath(): Promise<string> {
	try {
		const { stdout } = await execFileAsync('/bin/zsh', ['-lic', 'print -r -- "$PATH"'], {
			timeout: LOGIN_PATH_TIMEOUT_MS,
		});
		const lines = stdout.split('\n').filter((line) => line.trim() !== '');
		return lines[lines.length - 1] ?? process.env.PATH ?? '';
	} catch (err) {
		console.error('[Agent Tools] reading the login PATH failed:', err);
		return process.env.PATH ?? '';
	}
}

function isExecutableFile(file: string): boolean {
	try {
		if (!fs.statSync(file).isFile()) return false;
		fs.accessSync(file, fs.constants.X_OK);
		return true;
	} catch {
		return false;
	}
}
