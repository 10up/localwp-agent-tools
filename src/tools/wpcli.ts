import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import * as path from 'path';
import { SiteConfig } from '../helpers/site-config';
import { getPhpEnvironment } from '../helpers/paths';

const execFileAsync = promisify(execFile);

/**
 * Commands that are too destructive to allow through the MCP tool.
 * Checked against the first one or two parsed arguments.
 * Users can still run these directly in a terminal.
 */
const BLOCKED_COMMANDS: string[][] = [
	['eval'],
	['eval-file'],
	['shell'],
	['db', 'drop'],
	['db', 'reset'],
	['db', 'import'],
	['site', 'empty'],
	['site', 'delete'],
];

function isBlockedCommand(args: string[]): string | null {
	for (const blocked of BLOCKED_COMMANDS) {
		if (blocked.every((part, i) => args[i]?.toLowerCase() === part)) {
			return blocked.join(' ');
		}
	}
	return null;
}

// ── Core WP-CLI execution ──────────────────────────────────────────────
async function runWpCli(
	wpArgs: string[],
	config: SiteConfig,
	options?: { timeout?: number },
): Promise<{ stdout: string; stderr: string }> {
	if (!config.wpCliBin) {
		throw new Error(
			'WP-CLI is not installed or not found. To install:\n' +
			'  curl -O https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar\n' +
			'  chmod +x wp-cli.phar\n' +
			'  sudo mv wp-cli.phar /usr/local/bin/wp\n\n' +
			'Or set the WP_CLI_BIN environment variable to the path of your wp-cli binary.',
		);
	}

	const cmdArgs: string[] = [];

	// Local's wp-config.php uses DB_HOST=localhost, which makes PHP's mysqli
	// connect via Unix socket. Pass the correct socket path via PHP -d directive.
	if (config.dbSocket) {
		cmdArgs.push('-d', `mysqli.default_socket=${config.dbSocket}`);
		cmdArgs.push('-d', `pdo_mysql.default_socket=${config.dbSocket}`);
	}

	cmdArgs.push(config.wpCliBin, ...wpArgs);

	// Always ensure --path is set unless the user explicitly passed it
	const hasPathArg = wpArgs.some((a) => a.startsWith('--path=') || a === '--path');
	if (!hasPathArg && config.wpPath) {
		cmdArgs.push(`--path=${config.wpPath}`);
	}

	// Skip themes/plugins that may fatally error
	cmdArgs.push('--skip-themes', '--skip-plugins');

	const timeout = options?.timeout ?? 60_000;

	// Add MySQL binary directory to PATH so WP-CLI commands like `db check`
	// can find `mysqlcheck`, `mysqldump`, etc.
	const mysqlBinDir = config.mysqlBin ? path.dirname(config.mysqlBin) : '';
	const envPath = mysqlBinDir
		? `${mysqlBinDir}:${process.env.PATH || ''}`
		: process.env.PATH || '';

	const env: NodeJS.ProcessEnv = {
		...process.env,
		...getPhpEnvironment(config.phpBin),
		PHP: config.phpBin,
		PATH: envPath,
		// DB connection vars — used by native MySQL tools (mysql, mysqldump, mysqlcheck)
		// that WP-CLI shells out to for `wp db` commands
		...(config.dbSocket ? { MYSQL_UNIX_PORT: config.dbSocket } : {}),
		...(config.dbHost ? { MYSQL_HOST: config.dbHost } : {}),
		...(config.dbPort ? { MYSQL_TCP_PORT: String(config.dbPort) } : {}),
		MYSQL_PWD: config.dbPassword || '',
		DB_HOST: config.dbHost || 'localhost',
		DB_USER: config.dbUser || 'root',
		DB_PASSWORD: config.dbPassword || 'root',
		DB_NAME: config.dbName || 'local',
		...(config.dbSocket ? { DB_SOCKET: config.dbSocket } : {}),
		...(config.dbPort ? { DB_PORT: String(config.dbPort) } : {}),
	};

	return execFileAsync(config.phpBin, cmdArgs, {
		cwd: config.wpPath,
		timeout,
		maxBuffer: 10 * 1024 * 1024,
		env,
	});
}

// ── Tool Definitions ───────────────────────────────────────────────────
export const toolDefinitions = [
	{
		name: 'wp_cli',
		description:
			'Run an arbitrary WP-CLI command. Pass arguments without the leading "wp" prefix. Example: args="post list --post_type=page --format=json"\n\n' +
			'WARNING: Some WP-CLI commands are destructive and should only be run after confirming with the user:\n' +
			'- "eval" / "eval-file" / "shell" — execute arbitrary PHP code\n' +
			'- "db drop" / "db reset" — destroy the database\n' +
			'- "db import" — overwrite the database\n' +
			'- "plugin install <url>" / "theme install <url>" — install code from external sources\n' +
			'- "site empty" / "site delete" — delete site content\n' +
			'- "search-replace" (without --dry-run) — bulk modify database content\n' +
			'Always confirm with the user before running these commands.',
		inputSchema: {
			type: 'object' as const,
			properties: {
				args: {
					type: 'string',
					description:
						'WP-CLI arguments (without "wp" prefix). Example: "post list --post_type=page --format=json"',
				},
			},
			required: ['args'],
		},
	},
];

// ── Tool Handler ───────────────────────────────────────────────────────
export async function handleTool(
	name: string,
	args: Record<string, unknown>,
	config: SiteConfig,
): Promise<{ content: Array<{ type: string; text: string }> }> {
	try {
		switch (name) {
			case 'wp_cli':
				return handleWpCli(args, config);
			default:
				return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
		}
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return { content: [{ type: 'text', text: `WP-CLI Error: ${msg}` }] };
	}
}

// ── wp_cli ─────────────────────────────────────────────────────────────
async function handleWpCli(
	args: Record<string, unknown>,
	config: SiteConfig,
): Promise<{ content: Array<{ type: string; text: string }> }> {
	const rawArgs = String(args.args ?? '').trim();
	if (!rawArgs) {
		return { content: [{ type: 'text', text: 'Error: args parameter is required.' }] };
	}

	const wpArgs = splitArgs(rawArgs);

	const blockedCmd = isBlockedCommand(wpArgs);
	if (blockedCmd) {
		return {
			content: [{
				type: 'text',
				text: `Error: "wp ${blockedCmd}" is blocked for safety. This command is destructive and must be run manually in a terminal.`,
			}],
		};
	}

	const { stdout, stderr } = await runWpCli(wpArgs, config);

	let output = stdout;
	if (stderr && stderr.trim()) {
		output += `\n--- stderr ---\n${stderr.trim()}`;
	}

	return { content: [{ type: 'text', text: output || '(no output)' }] };
}

// ── Utility: split command-line string into args array ─────────────────
function splitArgs(str: string): string[] {
	const args: string[] = [];
	let current = '';
	let inSingle = false;
	let inDouble = false;

	for (let i = 0; i < str.length; i++) {
		const ch = str[i];

		if (ch === "'" && !inDouble) {
			inSingle = !inSingle;
		} else if (ch === '"' && !inSingle) {
			inDouble = !inDouble;
		} else if (ch === ' ' && !inSingle && !inDouble) {
			if (current) {
				args.push(current);
				current = '';
			}
		} else {
			current += ch;
		}
	}
	if (current) args.push(current);
	return args;
}
