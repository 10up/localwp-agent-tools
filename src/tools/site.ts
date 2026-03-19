import { readFile, stat, access, constants } from 'fs/promises';
import { existsSync } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { SiteConfig } from '../helpers/site-config';
import { getPhpEnvironment } from '../helpers/paths';

const execFileAsync = promisify(execFile);

/** Build an env object for WP-CLI calls that includes MySQL binaries and DB connection vars. */
function wpCliEnv(config: SiteConfig): NodeJS.ProcessEnv {
	const mysqlBinDir = config.mysqlBin ? path.dirname(config.mysqlBin) : '';
	return {
		...process.env,
		...getPhpEnvironment(config.phpBin),
		PHP: config.phpBin,
		PATH: mysqlBinDir ? `${mysqlBinDir}${path.delimiter}${process.env.PATH || ''}` : process.env.PATH,
		// DB connection vars — used by native MySQL tools (mysql, mysqldump, mysqlcheck)
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
}

// ── Tool Definitions ───────────────────────────────────────────────────
export const toolDefinitions = [
	{
		name: 'get_site_info',
		description:
			'Get comprehensive information about the Local site: paths, URLs, database config, PHP version, WordPress version, active plugins and theme.',
		inputSchema: {
			type: 'object' as const,
			properties: {},
		},
	},
	{
		name: 'site_health_check',
		description:
			'Run a health check on the WordPress site: tests database connectivity, file permissions, WP_DEBUG status, log file sizes, and PHP version.',
		inputSchema: {
			type: 'object' as const,
			properties: {},
		},
	},
];

// ── Tool Handler ───────────────────────────────────────────────────────
export async function handleTool(
	name: string,
	_args: Record<string, unknown>,
	config: SiteConfig,
): Promise<{ content: Array<{ type: string; text: string }> }> {
	try {
		switch (name) {
			case 'get_site_info':
				return handleGetSiteInfo(config);
			case 'site_health_check':
				return handleSiteHealthCheck(config);
			default:
				return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
		}
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return { content: [{ type: 'text', text: `Error: ${msg}` }] };
	}
}

// ── get_site_info ──────────────────────────────────────────────────────
async function handleGetSiteInfo(config: SiteConfig): Promise<{
	content: Array<{ type: string; text: string }>;
}> {
	const info: Record<string, unknown> = {
		sitePath: config.sitePath,
		wpPath: config.wpPath,
		siteDomain: config.siteDomain,
		siteUrl: config.siteUrl,
		logPath: config.logPath,
		database: {
			name: config.dbName,
			socket: config.dbSocket || null,
			port: config.dbPort,
		},
	};

	// Read WordPress version from wp-includes/version.php
	const versionFile = path.join(config.wpPath, 'wp-includes', 'version.php');
	if (existsSync(versionFile)) {
		try {
			const versionContent = await readFile(versionFile, 'utf-8');
			const wpVersionMatch = versionContent.match(/\$wp_version\s*=\s*['"]([^'"]+)['"]/);
			const dbVersionMatch = versionContent.match(/\$wp_db_version\s*=\s*(\d+)/);
			info.wpVersion = wpVersionMatch ? wpVersionMatch[1] : 'unknown';
			info.wpDbVersion = dbVersionMatch ? dbVersionMatch[1] : 'unknown';
		} catch {
			info.wpVersion = 'error reading version file';
		}
	}

	// Get PHP version
	try {
		const { stdout } = await execFileAsync(config.phpBin, ['-v'], {
			timeout: 5_000,
			env: { ...process.env, ...getPhpEnvironment(config.phpBin) },
		});
		const phpVersionMatch = stdout.match(/PHP\s+([\d.]+)/);
		info.phpVersion = phpVersionMatch ? phpVersionMatch[1] : stdout.split('\n')[0];
	} catch {
		info.phpVersion = 'unable to determine';
	}

	// Parse wp-config.php for key settings
	const configPath = path.join(config.wpPath, 'wp-config.php');
	if (existsSync(configPath)) {
		try {
			const configContent = await readFile(configPath, 'utf-8');
			const debugMatch = configContent.match(
				/define\s*\(\s*['"]WP_DEBUG['"]\s*,\s*([^)]+?)\s*\)/,
			);
			info.wpDebug = debugMatch ? debugMatch[1].trim() : 'not set';

			const prefixMatch = configContent.match(
				/\$table_prefix\s*=\s*['"]([^'"]+)['"]/,
			);
			info.tablePrefix = prefixMatch ? prefixMatch[1] : 'wp_';
		} catch {
			// non-critical
		}
	}

	// Try WP-CLI for active plugins and theme
	if (config.wpCliBin && existsSync(config.wpCliBin)) {
		const wpCliArgs = (extraArgs: string[]) => {
			const args: string[] = [];
			if (config.dbSocket) {
				args.push('-d', `mysqli.default_socket=${config.dbSocket}`);
				args.push('-d', `pdo_mysql.default_socket=${config.dbSocket}`);
			}
			args.push(config.wpCliBin, ...extraArgs, `--path=${config.wpPath}`, '--skip-themes', '--skip-plugins');
			return args;
		};

		try {
			const { stdout: pluginOut } = await execFileAsync(
				config.phpBin,
				wpCliArgs(['plugin', 'list', '--status=active', '--format=json']),
				{ cwd: config.wpPath, timeout: 15_000, env: wpCliEnv(config) },
			);
			info.activePlugins = JSON.parse(pluginOut);
		} catch {
			info.activePlugins = 'unable to retrieve (WP-CLI error)';
		}

		try {
			const { stdout: themeOut } = await execFileAsync(
				config.phpBin,
				wpCliArgs(['theme', 'list', '--status=active', '--format=json']),
				{ cwd: config.wpPath, timeout: 15_000, env: wpCliEnv(config) },
			);
			info.activeTheme = JSON.parse(themeOut);
		} catch {
			info.activeTheme = 'unable to retrieve (WP-CLI error)';
		}
	}

	return {
		content: [{ type: 'text', text: JSON.stringify(info, null, 2) }],
	};
}

// ── site_health_check ──────────────────────────────────────────────────
async function handleSiteHealthCheck(config: SiteConfig): Promise<{
	content: Array<{ type: string; text: string }>;
}> {
	const checks: Array<{ check: string; status: 'ok' | 'warning' | 'error'; details: string }> = [];

	// 1. Database connectivity (via WP-CLI)
	if (config.wpCliBin && existsSync(config.wpCliBin)) {
		try {
			const wpCliArgs: string[] = [];
			if (config.dbSocket) {
				wpCliArgs.push('-d', `mysqli.default_socket=${config.dbSocket}`);
				wpCliArgs.push('-d', `pdo_mysql.default_socket=${config.dbSocket}`);
			}
			wpCliArgs.push(config.wpCliBin, 'db', 'check', `--path=${config.wpPath}`, '--skip-themes', '--skip-plugins');
			await execFileAsync(config.phpBin, wpCliArgs, { cwd: config.wpPath, timeout: 15_000, env: wpCliEnv(config) });

			const countArgs: string[] = [];
			if (config.dbSocket) {
				countArgs.push('-d', `mysqli.default_socket=${config.dbSocket}`);
				countArgs.push('-d', `pdo_mysql.default_socket=${config.dbSocket}`);
			}
			countArgs.push(config.wpCliBin, 'db', 'query', 'SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()', '--skip-column-names', `--path=${config.wpPath}`, '--skip-themes', '--skip-plugins');
			const { stdout: countOut } = await execFileAsync(config.phpBin, countArgs, { cwd: config.wpPath, timeout: 15_000, env: wpCliEnv(config) });
			const tableCount = parseInt(countOut.trim(), 10) || 0;

			checks.push({
				check: 'Database connectivity',
				status: 'ok',
				details: `Connected successfully. ${tableCount} tables in ${config.dbName}.`,
			});
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			checks.push({
				check: 'Database connectivity',
				status: 'error',
				details: `Connection failed: ${msg}`,
			});
		}
	} else {
		checks.push({
			check: 'Database connectivity',
			status: 'warning',
			details: 'WP-CLI not available — cannot test database connectivity.',
		});
	}

	// 2. File permissions on key directories
	const keyDirs = [
		{ label: 'wp-content', path: path.join(config.wpPath, 'wp-content') },
		{ label: 'wp-content/uploads', path: path.join(config.wpPath, 'wp-content', 'uploads') },
		{ label: 'wp-content/plugins', path: path.join(config.wpPath, 'wp-content', 'plugins') },
		{ label: 'wp-content/themes', path: path.join(config.wpPath, 'wp-content', 'themes') },
	];

	for (const dir of keyDirs) {
		if (!existsSync(dir.path)) {
			checks.push({
				check: `File permissions: ${dir.label}`,
				status: 'warning',
				details: `Directory does not exist: ${dir.path}`,
			});
			continue;
		}

		try {
			await access(dir.path, constants.R_OK | constants.W_OK);
			checks.push({
				check: `File permissions: ${dir.label}`,
				status: 'ok',
				details: 'Readable and writable.',
			});
		} catch {
			checks.push({
				check: `File permissions: ${dir.label}`,
				status: 'error',
				details: `Not writable: ${dir.path}`,
			});
		}
	}

	// 3. WP_DEBUG status
	const wpConfigPath = path.join(config.wpPath, 'wp-config.php');
	if (existsSync(wpConfigPath)) {
		try {
			const configContent = await readFile(wpConfigPath, 'utf-8');
			const debugMatch = configContent.match(
				/define\s*\(\s*['"]WP_DEBUG['"]\s*,\s*([^)]+?)\s*\)/,
			);
			const debugValue = debugMatch ? debugMatch[1].trim() : 'not defined';
			const isEnabled = /true/i.test(debugValue);

			checks.push({
				check: 'WP_DEBUG',
				status: isEnabled ? 'warning' : 'ok',
				details: `WP_DEBUG is ${debugValue}${isEnabled ? ' (consider disabling in production)' : ''}.`,
			});
		} catch {
			checks.push({
				check: 'WP_DEBUG',
				status: 'warning',
				details: 'Could not read wp-config.php.',
			});
		}
	}

	// 4. Log file sizes
	const logFiles = [
		{ label: 'PHP error log', path: path.join(config.logPath, 'php', 'error.log') },
		{ label: 'WP debug log', path: path.join(config.wpPath, 'wp-content', 'debug.log') },
		{ label: 'Nginx access log', path: path.join(config.logPath, 'nginx', 'access.log') },
		{ label: 'Nginx error log', path: path.join(config.logPath, 'nginx', 'error.log') },
	];

	for (const log of logFiles) {
		if (!existsSync(log.path)) {
			checks.push({
				check: `Log: ${log.label}`,
				status: 'ok',
				details: 'Not present.',
			});
			continue;
		}

		try {
			const logStat = await stat(log.path);
			const sizeMb = logStat.size / (1024 * 1024);

			if (sizeMb > 100) {
				checks.push({
					check: `Log: ${log.label}`,
					status: 'warning',
					details: `Large log file: ${sizeMb.toFixed(1)} MB. Consider rotating or truncating.`,
				});
			} else {
				checks.push({
					check: `Log: ${log.label}`,
					status: 'ok',
					details: `${sizeMb.toFixed(1)} MB`,
				});
			}
		} catch {
			checks.push({
				check: `Log: ${log.label}`,
				status: 'warning',
				details: `Cannot stat file: ${log.path}`,
			});
		}
	}

	// 5. PHP version
	try {
		const { stdout } = await execFileAsync(config.phpBin, ['-v'], {
			timeout: 5_000,
			env: { ...process.env, ...getPhpEnvironment(config.phpBin) },
		});
		const phpVersionMatch = stdout.match(/PHP\s+([\d.]+)/);
		const phpVersion = phpVersionMatch ? phpVersionMatch[1] : 'unknown';

		const major = parseInt(phpVersion.split('.')[0] || '0', 10);
		const minor = parseInt(phpVersion.split('.')[1] || '0', 10);

		if (major < 8 || (major === 8 && minor < 1)) {
			checks.push({
				check: 'PHP version',
				status: 'warning',
				details: `PHP ${phpVersion} — WordPress recommends PHP 8.1+.`,
			});
		} else {
			checks.push({
				check: 'PHP version',
				status: 'ok',
				details: `PHP ${phpVersion}`,
			});
		}
	} catch {
		checks.push({
			check: 'PHP version',
			status: 'error',
			details: `Cannot execute PHP binary at: ${config.phpBin}`,
		});
	}

	// 6. wp-config.php exists
	checks.push({
		check: 'wp-config.php',
		status: existsSync(wpConfigPath) ? 'ok' : 'error',
		details: existsSync(wpConfigPath) ? 'Present.' : `Not found at: ${wpConfigPath}`,
	});

	const errors = checks.filter((c) => c.status === 'error').length;
	const warnings = checks.filter((c) => c.status === 'warning').length;
	const summary = errors > 0
		? `${errors} error(s), ${warnings} warning(s)`
		: warnings > 0
			? `${warnings} warning(s), no errors`
			: 'All checks passed';

	return {
		content: [{ type: 'text', text: JSON.stringify({ summary, checks }, null, 2) }],
	};
}
