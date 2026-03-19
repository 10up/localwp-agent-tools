import { readFile, writeFile, copyFile, stat, open } from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import { SiteConfig } from '../helpers/site-config';

const MAX_LOG_READ_SIZE = 5 * 1024 * 1024; // 5 MB

/**
 * Read the tail of a log file efficiently.
 * For files larger than MAX_LOG_READ_SIZE, only the last 5 MB is read
 * to avoid loading huge log files entirely into memory.
 */
async function readLogTail(filePath: string): Promise<string> {
	const fileStat = await stat(filePath);

	if (fileStat.size <= MAX_LOG_READ_SIZE) {
		return readFile(filePath, 'utf-8');
	}

	// Read only the last MAX_LOG_READ_SIZE bytes
	const fd = await open(filePath, 'r');
	try {
		const offset = fileStat.size - MAX_LOG_READ_SIZE;
		const buffer = Buffer.alloc(MAX_LOG_READ_SIZE);
		await fd.read(buffer, 0, MAX_LOG_READ_SIZE, offset);
		const content = buffer.toString('utf-8');

		// Skip the first partial line (we likely landed mid-line)
		const firstNewline = content.indexOf('\n');
		return firstNewline >= 0 ? content.slice(firstNewline + 1) : content;
	} finally {
		await fd.close();
	}
}

// ── Tool Definitions ───────────────────────────────────────────────────
export const toolDefinitions = [
	{
		name: 'read_error_log',
		description:
			'Read the PHP error log for the Local site. Returns the last N lines (default 50), parsed into structured entries when possible.',
		inputSchema: {
			type: 'object' as const,
			properties: {
				lines: {
					type: 'number',
					description: 'Number of lines to return from the end of the log. Default 50.',
					default: 50,
				},
				filter: {
					type: 'string',
					description: 'Optional string to filter log lines (case-insensitive).',
				},
			},
		},
	},
	{
		name: 'read_access_log',
		description:
			'Read the nginx access log for the Local site. Returns the last N lines (default 50).',
		inputSchema: {
			type: 'object' as const,
			properties: {
				lines: {
					type: 'number',
					description: 'Number of lines to return from the end of the log. Default 50.',
					default: 50,
				},
				filter: {
					type: 'string',
					description: 'Optional string to filter log lines (case-insensitive).',
				},
			},
		},
	},
	{
		name: 'wp_debug_toggle',
		description:
			'Enable or disable WordPress debug mode. Modifies WP_DEBUG, WP_DEBUG_LOG, and SCRIPT_DEBUG constants in wp-config.php.',
		inputSchema: {
			type: 'object' as const,
			properties: {
				enable: {
					type: 'boolean',
					description: 'Set to true to enable debug mode, false to disable.',
				},
				debug_log: {
					type: 'boolean',
					description:
						'Enable WP_DEBUG_LOG (writes errors to wp-content/debug.log). Defaults to same value as enable.',
				},
				script_debug: {
					type: 'boolean',
					description:
						'Enable SCRIPT_DEBUG (loads non-minified scripts). Defaults to same value as enable.',
				},
			},
			required: ['enable'],
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
			case 'read_error_log':
				return handleReadErrorLog(args, config);
			case 'read_access_log':
				return handleReadAccessLog(args, config);
			case 'wp_debug_toggle':
				return handleWpDebugToggle(args, config);
			default:
				return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
		}
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return { content: [{ type: 'text', text: `Error: ${msg}` }] };
	}
}

// ── read_error_log ─────────────────────────────────────────────────────

/**
 * Finds the most relevant PHP error log file.
 *
 * When WP_DEBUG and WP_DEBUG_LOG are true, WordPress calls
 * ini_set('error_log', WP_CONTENT_DIR . '/debug.log') which redirects
 * PHP errors away from the server's error.log to wp-content/debug.log.
 * We check both locations and return whichever was modified most recently.
 */
async function findErrorLog(config: SiteConfig): Promise<string | null> {
	const serverLog = path.join(config.logPath, 'php', 'error.log');
	const debugLog = path.join(config.wpPath, 'wp-content', 'debug.log');

	const serverExists = existsSync(serverLog);
	const debugExists = existsSync(debugLog);

	if (serverExists && debugExists) {
		const serverMtime = (await stat(serverLog)).mtimeMs;
		const debugMtime = (await stat(debugLog)).mtimeMs;
		return debugMtime >= serverMtime ? debugLog : serverLog;
	}

	if (debugExists) return debugLog;
	if (serverExists) return serverLog;
	return null;
}

async function handleReadErrorLog(
	args: Record<string, unknown>,
	config: SiteConfig,
): Promise<{ content: Array<{ type: string; text: string }> }> {
	const numLines = Number(args.lines ?? 50);
	const filter = args.filter ? String(args.filter) : null;

	const logFile = await findErrorLog(config);
	if (!logFile) {
		return {
			content: [{ type: 'text', text: `PHP error log not found. Searched:\n  ${path.join(config.logPath, 'php', 'error.log')}\n  ${path.join(config.wpPath, 'wp-content', 'debug.log')}` }],
		};
	}

	const content = await readLogTail(logFile);
	let lines = content.split('\n').filter((l) => l.trim());

	if (filter) {
		const lowerFilter = filter.toLowerCase();
		lines = lines.filter((l) => l.toLowerCase().includes(lowerFilter));
	}

	const lastLines = lines.slice(-numLines);
	const entries = lastLines.map((line) => parsePhpErrorLine(line));

	const logStat = await stat(logFile);
	const sizeKb = Math.round(logStat.size / 1024);

	return {
		content: [
			{
				type: 'text',
				text: JSON.stringify(
					{ file: logFile, sizeKb, totalLines: lines.length, showing: lastLines.length, entries },
					null,
					2,
				),
			},
		],
	};
}

// ── read_access_log ────────────────────────────────────────────────────
async function handleReadAccessLog(
	args: Record<string, unknown>,
	config: SiteConfig,
): Promise<{ content: Array<{ type: string; text: string }> }> {
	const numLines = Number(args.lines ?? 50);
	const filter = args.filter ? String(args.filter) : null;

	const candidates = [
		path.join(config.logPath, 'nginx', 'access.log'),
		path.join(config.logPath, 'nginx', 'access.log.1'),
		path.join(config.logPath, 'apache', 'access.log'),
	];

	let logFile: string | null = null;
	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			logFile = candidate;
			break;
		}
	}

	if (!logFile) {
		return {
			content: [
				{ type: 'text', text: `Access log not found. Searched:\n${candidates.join('\n')}` },
			],
		};
	}

	const content = await readLogTail(logFile);
	let lines = content.split('\n').filter((l) => l.trim());

	if (filter) {
		const lowerFilter = filter.toLowerCase();
		lines = lines.filter((l) => l.toLowerCase().includes(lowerFilter));
	}

	const lastLines = lines.slice(-numLines);

	const logStat = await stat(logFile);
	const sizeKb = Math.round(logStat.size / 1024);

	return {
		content: [
			{
				type: 'text',
				text: JSON.stringify(
					{ file: logFile, sizeKb, totalLines: lines.length, showing: lastLines.length, lines: lastLines },
					null,
					2,
				),
			},
		],
	};
}

// ── wp_debug_toggle ────────────────────────────────────────────────────
async function handleWpDebugToggle(
	args: Record<string, unknown>,
	config: SiteConfig,
): Promise<{ content: Array<{ type: string; text: string }> }> {
	const enable = Boolean(args.enable);
	const debugLog = args.debug_log !== undefined ? Boolean(args.debug_log) : enable;
	const scriptDebug = args.script_debug !== undefined ? Boolean(args.script_debug) : enable;

	const configPath = path.join(config.wpPath, 'wp-config.php');
	if (!existsSync(configPath)) {
		return {
			content: [{ type: 'text', text: `wp-config.php not found at: ${configPath}` }],
		};
	}

	const backupPath = `${configPath}.bak`;
	await copyFile(configPath, backupPath);

	let fileContent = await readFile(configPath, 'utf-8');

	const boolStr = (val: boolean) => (val ? 'true' : 'false');

	fileContent = setWpConstant(fileContent, 'WP_DEBUG', boolStr(enable));
	fileContent = setWpConstant(fileContent, 'WP_DEBUG_LOG', boolStr(debugLog));
	fileContent = setWpConstant(fileContent, 'SCRIPT_DEBUG', boolStr(scriptDebug));

	await writeFile(configPath, fileContent, 'utf-8');

	return {
		content: [
			{
				type: 'text',
				text: [
					`Debug settings updated in ${configPath}:`,
					`  WP_DEBUG = ${boolStr(enable)}`,
					`  WP_DEBUG_LOG = ${boolStr(debugLog)}`,
					`  SCRIPT_DEBUG = ${boolStr(scriptDebug)}`,
					``,
					`Backup saved to: ${backupPath}`,
				].join('\n'),
			},
		],
	};
}

// ── Helpers ────────────────────────────────────────────────────────────

function setWpConstant(content: string, name: string, value: string): string {
	const regex = new RegExp(
		`(define\\s*\\(\\s*['"]${name}['"]\\s*,\\s*)([^)]+?)(\\s*\\)\\s*;)`,
		'g',
	);

	if (regex.test(content)) {
		return content.replace(regex, `$1${value}$3`);
	}

	const marker = /\/\*.*?That's all.*?\*\//i;
	const insertLine = `define( '${name}', ${value} );\n`;

	if (marker.test(content)) {
		return content.replace(marker, `${insertLine}$&`);
	}

	const settingsLine = /require_once.*wp-settings\.php/;
	if (settingsLine.test(content)) {
		return content.replace(settingsLine, `${insertLine}$&`);
	}

	return content + `\n${insertLine}`;
}

function parsePhpErrorLine(line: string): { raw: string; timestamp?: string; level?: string; message?: string; file?: string; line?: number } {
	const match = line.match(
		/^\[([^\]]+)\]\s+(?:PHP\s+)?(Fatal error|Warning|Notice|Deprecated|Parse error|Strict Standards|Recoverable fatal error)?:?\s*(.*?)(?:\s+in\s+(\S+?)(?:\s+on\s+line\s+(\d+))?)?$/i,
	);

	if (!match) {
		return { raw: line };
	}

	return {
		raw: line,
		timestamp: match[1] || undefined,
		level: match[2] || undefined,
		message: match[3] || undefined,
		file: match[4] || undefined,
		line: match[5] ? parseInt(match[5], 10) : undefined,
	};
}
