import { execFile } from 'child_process';
import { promisify } from 'util';
import type { LaunchTarget } from './types';

const execFileAsync = promisify(execFile);

/** Opens a new Ghostty window that runs the launch script. */
export async function openInGhostty(target: LaunchTarget): Promise<void> {
	await execFileAsync('open', ['-a', 'Ghostty', target.scriptPath]);
}
