import { randomBytes } from 'crypto';
import * as path from 'path';
import type { Instance } from './settings';

const EXEC_SHELL_LINE = /^exec \$SHELL\s*$/;
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function expandHome(value: string, home: string): string {
	if (value === '~') return home;
	if (value.startsWith('~/')) return path.join(home, value.slice(2));
	return value;
}

/**
 * The command that starts an instance. Its settings are passed through `env`,
 * so they reach the Claude process only and never stay in the shell. The
 * login PATH is appended after Local's, so tools Claude runs are found while
 * the site's PHP and MySQL stay first. Launch arguments are inserted as typed,
 * like a command line.
 */
export function agentCommand(instance: Instance, binaryPath: string, home: string, loginPath = ''): string {
	const parts = ['env'];

	const configDir = instance.configDir.trim();
	if (configDir === '') {
		parts.push('-u CLAUDE_CONFIG_DIR');
	} else {
		parts.push(`CLAUDE_CONFIG_DIR=${shellQuote(expandHome(configDir, home))}`);
	}

	if (loginPath !== '') {
		parts.push(`PATH="$PATH":${shellQuote(loginPath)}`);
	}

	for (const variable of instance.env) {
		if (!ENV_NAME_PATTERN.test(variable.name)) {
			throw new Error(`"${variable.name}" is not a valid environment variable name.`);
		}
		parts.push(`${variable.name}=${shellQuote(expandHome(variable.value, home))}`);
	}

	parts.push(shellQuote(binaryPath));

	const args = instance.args.trim();
	if (args !== '') parts.push(args);

	return parts.join(' ');
}

/**
 * Local's site shell script, with the agent command placed ahead of its final
 * `exec $SHELL`, so the tab stays a site shell after the agent exits.
 */
export function buildLaunchScript(entryScript: string, agentLine: string | null): string {
	const lines = entryScript.split('\n');
	let execIndex = -1;
	for (let i = lines.length - 1; i >= 0; i--) {
		if (EXEC_SHELL_LINE.test(lines[i])) {
			execIndex = i;
			break;
		}
	}
	if (execIndex === -1) {
		throw new Error(
			"Local's site shell script has no final `exec $SHELL` line, so it cannot open a shell that stays open.",
		);
	}
	if (agentLine === null) return entryScript;

	// Local echoes "Launching shell" just before the exec; the agent runs ahead of that message.
	const previous = lines[execIndex - 1] ?? '';
	const insertIndex = previous.startsWith('echo "Launching shell') ? execIndex - 1 : execIndex;

	// Ctrl-C while the agent starts would otherwise end the script before `exec $SHELL`
	// and close the tab. `trap :` runs a no-op, so the agent still receives the signal.
	lines.splice(insertIndex, 0, 'trap : INT', agentLine, 'trap - INT');
	return lines.join('\n');
}

export function launchScriptPath(dir: string, siteId: string, now: number): string {
	const suffix = randomBytes(4).toString('hex');
	return path.join(dir, `launch-${siteId}-${now}-${suffix}.sh`);
}
