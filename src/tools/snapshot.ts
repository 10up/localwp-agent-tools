import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { existsSync, readdirSync, statSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { readFile } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { SiteConfig } from '../helpers/site-config';

const execFileAsync = promisify(execFile);

/** Longer timeout for snapshot operations (5 minutes). */
const SNAPSHOT_TIMEOUT = 300_000;

/** Plugin config filename looked up in the project root and wp-content. */
const PLUGIN_CONFIG_FILE = '.snapshot-plugins.json';

// ── WP-CLI helpers (mirrors patterns from site.ts / wpcli.ts) ─────────

function buildWpCliArgs(config: SiteConfig, wpArgs: string[]): string[] {
	const args: string[] = [];
	if (config.dbSocket) {
		args.push('-d', `mysqli.default_socket=${config.dbSocket}`);
		args.push('-d', `pdo_mysql.default_socket=${config.dbSocket}`);
	}
	args.push(config.wpCliBin, ...wpArgs, `--path=${config.wpPath}`, '--skip-themes', '--skip-plugins');
	return args;
}

function wpCliEnv(config: SiteConfig): NodeJS.ProcessEnv {
	const mysqlBinDir = config.mysqlBin ? path.dirname(config.mysqlBin) : '';
	return {
		...process.env,
		PHP: config.phpBin,
		PATH: mysqlBinDir ? `${mysqlBinDir}:${process.env.PATH || ''}` : process.env.PATH,
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

/** Run a WP-CLI command and return trimmed stdout. */
async function runWp(config: SiteConfig, wpArgs: string[], timeout?: number): Promise<string> {
	const { stdout, stderr } = await execFileAsync(
		config.phpBin,
		buildWpCliArgs(config, wpArgs),
		{
			cwd: config.wpPath,
			timeout: timeout ?? SNAPSHOT_TIMEOUT,
			maxBuffer: 10 * 1024 * 1024,
			env: wpCliEnv(config),
		},
	);
	// Surface WP-CLI warnings alongside output
	let output = stdout.trim();
	if (stderr && stderr.trim()) {
		output += `\n--- stderr ---\n${stderr.trim()}`;
	}
	return output;
}

/**
 * Spawn a WP-CLI command as a detached process that survives even if
 * the MCP HTTP handler is interrupted. Writes a marker file on completion.
 * Returns the path to the marker file.
 */
function spawnDetachedWp(config: SiteConfig, wpArgs: string[], markerPath: string): void {
	const child = spawn(
		config.phpBin,
		buildWpCliArgs(config, wpArgs),
		{
			cwd: config.wpPath,
			env: wpCliEnv(config),
			detached: true,
			stdio: 'ignore',
		},
	);
	child.on('exit', (code) => {
		writeFileSync(markerPath, String(code ?? -1), 'utf-8');
	});
	child.unref();
}

// ── File / config discovery ────────────────────────────────────────────

interface SqlFileInfo {
	path: string;
	name: string;
	size: string;
	modified: string;
}

/** Return all .sql / .sql.gz files found in standard locations with metadata. */
function findAllSqlFiles(config: SiteConfig): SqlFileInfo[] {
	const searchDirs = [
		config.wpPath,
		path.join(config.wpPath, 'wp-content'),
		config.sitePath,
	];
	const extensions = ['.sql', '.sql.gz'];
	const found: SqlFileInfo[] = [];
	const seen = new Set<string>();

	for (const dir of searchDirs) {
		if (!existsSync(dir)) continue;
		try {
			for (const file of readdirSync(dir)) {
				if (!extensions.some(ext => file.endsWith(ext))) continue;
				const fullPath = path.join(dir, file);
				if (seen.has(fullPath)) continue;
				seen.add(fullPath);
				try {
					const stats = statSync(fullPath);
					const sizeMb = stats.size / (1024 * 1024);
					found.push({
						path: fullPath,
						name: file,
						size: sizeMb >= 1 ? `${sizeMb.toFixed(1)} MB` : `${(stats.size / 1024).toFixed(0)} KB`,
						modified: stats.mtime.toISOString().slice(0, 19).replace('T', ' '),
					});
				} catch {
					found.push({ path: fullPath, name: file, size: 'unknown', modified: 'unknown' });
				}
			}
		} catch {
			continue;
		}
	}
	// Sort by modified date descending (newest first)
	found.sort((a, b) => b.modified.localeCompare(a.modified));
	return found;
}

/**
 * Resolve a single SQL file to import.
 * Returns the absolute path, or null if none/ambiguous.
 */
function resolveSqlFile(config: SiteConfig, explicit?: string): string | null {
	if (explicit) {
		const resolved = path.isAbsolute(explicit) ? explicit : path.join(config.wpPath, explicit);
		return existsSync(resolved) ? resolved : null;
	}
	const all = findAllSqlFiles(config);
	return all.length === 1 ? all[0].path : null;
}

interface SnapshotConfig {
	deactivate: string[];
	activate: string[];
	commands: string[];
}

/** Look for .snapshot-plugins.json in project root or wp-content. */
async function findSnapshotConfig(config: SiteConfig): Promise<SnapshotConfig | null> {
	const candidates = [
		path.join(config.wpPath, PLUGIN_CONFIG_FILE),
		path.join(config.wpPath, 'wp-content', PLUGIN_CONFIG_FILE),
		path.join(config.sitePath, PLUGIN_CONFIG_FILE),
	];

	for (const candidate of candidates) {
		if (!existsSync(candidate)) continue;
		try {
			const raw = await readFile(candidate, 'utf-8');
			const parsed = JSON.parse(raw);
			return {
				deactivate: Array.isArray(parsed.deactivate) ? parsed.deactivate : [],
				activate: Array.isArray(parsed.activate) ? parsed.activate : [],
				commands: Array.isArray(parsed.commands) ? parsed.commands : [],
			};
		} catch {
			return null;
		}
	}
	return null;
}

// ── Tool Definitions ───────────────────────────────────────────────────

export const toolDefinitions = [
	{
		name: 'snapshot_push',
		description:
			'Push an existing local snapshot to the remote repository.\n\n' +
			'Use snapshot_create first to create a local snapshot, then pass the returned ID here.\n' +
			'The push uploads the snapshot to S3 and writes metadata to DynamoDB.\n' +
			'For large databases, the upload may take several minutes.\n\n' +
			'Requires "wp snapshots configure" to have been run at least once.',
		inputSchema: {
			type: 'object' as const,
			properties: {
				snapshot_id: {
					type: 'string',
					description: 'The local snapshot ID to push (from snapshot_create output)',
				},
				repository: {
					type: 'string',
					description: 'Snapshot repository name (default: "10up")',
				},
			},
			required: ['snapshot_id'],
		},
	},
	{
		name: 'snapshot_pull',
		description:
			'Pull a snapshot by ID into the local site.\n' +
			'Works with both local snapshot IDs (from snapshot_create) and remote IDs (shared by team).\n\n' +
			'This tool handles everything after pull:\n' +
			'- Applies .snapshot-plugins.json (deactivate/activate plugins for local use)\n' +
			'- Flushes rewrite rules and object cache\n' +
			'For large databases, the pull may timeout but continues in the background.\n\n' +
			'Login after pull: username "snapshots", password "password"\n\n' +
			'For multisite, provide site_mapping and/or main_domain.',
		inputSchema: {
			type: 'object' as const,
			properties: {
				snapshot_id: {
					type: 'string',
					description: 'The snapshot ID to pull',
				},
				repository: {
					type: 'string',
					description: 'Snapshot repository name (default: "10up")',
				},
				include_files: {
					type: 'boolean',
					description: 'Include wp-content files from the snapshot (default: false)',
				},
				site_mapping: {
					type: 'string',
					description:
						'JSON string or file path mapping old site URLs to new ones (multisite). ' +
						'Example: \'{"https://old.com":"https://new.local"}\'',
				},
				main_domain: {
					type: 'string',
					description: 'Main domain for multisite installations',
				},
			},
			required: ['snapshot_id'],
		},
	},
	{
		name: 'snapshot_import',
		description:
			'Import a SQL file into the local site database.\n\n' +
			'If sql_file is omitted, returns a list of available .sql/.sql.gz files in the project\n' +
			'for the user to choose from. Present the list and let the user pick.\n\n' +
			'Steps (when sql_file is provided):\n' +
			'1. Backup the current local database (wp db export --all-tablespaces --add-drop-table)\n' +
			'2. Import the SQL file\n' +
			'3. Detect source URL and search-replace to local URL',
		inputSchema: {
			type: 'object' as const,
			properties: {
				sql_file: {
					type: 'string',
					description: 'Path to the .sql or .sql.gz file. Absolute, relative to WordPress root, or just the filename. If omitted, lists available files.',
				},
			},
			required: [],
		},
	},
	{
		name: 'snapshot_create',
		description:
			'Create a snapshot from the CURRENT local database state, without pushing.\n' +
			'wp-scrubber sanitizes user data during creation.\n\n' +
			'This tool checks for SQL files in the project. If found, it returns the file list\n' +
			'and you MUST ask the user which option they prefer before proceeding.\n' +
			'Do NOT pass skip_sql_check on the first call; let the check run.\n\n' +
			'IMPORTANT: Do NOT include the source SQL filename in the description.\n\n' +
			'Full workflow after creation:\n' +
			'1. snapshot_create returns the snapshot ID\n' +
			'2. ALWAYS call snapshot_pull with that ID to import the scrubbed database and create the snapshots user\n' +
			'3. Optionally call snapshot_push to share with the team\n\n' +
			'Do NOT use snapshot_search to find the ID (search only queries remote).\n' +
			'Database is always included. Files and --small are OFF by default.',
		inputSchema: {
			type: 'object' as const,
			properties: {
				slug: {
					type: 'string',
					description: 'Project slug for the snapshot (e.g., "my-project")',
				},
				description: {
					type: 'string',
					description: 'Short description. NEVER include SQL filenames. Good: "Local DB 2026-03-14". Bad: "Snapshot from mysql.sql".',
				},
				repository: {
					type: 'string',
					description: 'Snapshot repository name (default: "10up")',
				},
				include_files: {
					type: 'boolean',
					description: 'Include wp-content files in the snapshot (default: false)',
				},
				small: {
					type: 'boolean',
					description: 'Trim data to ~300 posts / 500 comments (default: false)',
				},
				author_name: {
					type: 'string',
					description: 'Author name override. Falls back to value stored by "wp snapshots configure".',
				},
				author_email: {
					type: 'string',
					description: 'Author email override. Falls back to value stored by "wp snapshots configure".',
				},
				skip_sql_check: {
					type: 'boolean',
					description: 'Skip SQL file check and create from current DB (set true after user confirms).',
				},
			},
			required: ['slug', 'description'],
		},
	},
	{
		name: 'snapshot_search',
		description:
			'Search for snapshots in a REMOTE repository (pushed snapshots only). ' +
			'Local-only snapshots (created but not pushed) will NOT appear in results. ' +
			'Returns a table of matching snapshots with their IDs, project slugs, descriptions, and authors.',
		inputSchema: {
			type: 'object' as const,
			properties: {
				search: {
					type: 'string',
					description: 'Search text (project name, description, etc.). Use "*" to list all.',
				},
				repository: {
					type: 'string',
					description: 'Snapshot repository name (default: "10up")',
				},
			},
			required: ['search'],
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
			case 'snapshot_push':
				return handleSnapshotPush(args, config);
			case 'snapshot_pull':
				return handleSnapshotPull(args, config);
			case 'snapshot_import':
				return handleSnapshotImport(args, config);
			case 'snapshot_create':
				return handleSnapshotCreate(args, config);
			case 'snapshot_search':
				return handleSnapshotSearch(args, config);
			default:
				return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
		}
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return { content: [{ type: 'text', text: `Snapshot Error: ${msg}` }] };
	}
}

// ── snapshot_push ──────────────────────────────────────────────────────

async function handleSnapshotPush(
	args: Record<string, unknown>,
	config: SiteConfig,
): Promise<{ content: Array<{ type: string; text: string }> }> {
	const snapshotId = String(args.snapshot_id || '').trim();
	const repository = String(args.repository || '10up').trim();

	if (!snapshotId) return err('snapshot_id is required');

	// Push the existing local snapshot to the remote repository.
	// This uploads to S3 and writes metadata to DynamoDB.
	// For large databases, the upload may take several minutes;
	// the MCP response may be dropped but the upload continues.
	try {
		const output = await runWp(config, [
			'snapshots', 'push', snapshotId,
			`--repository=${repository}`,
		]);
		return ok(`Snapshot ${snapshotId} pushed to ${repository}.\n\n${output}`);
	} catch (e: unknown) {
		const msg = errorMsg(e);
		if (msg.includes('TIMEOUT') || msg.includes('timed out')) {
			return ok(
				`Push initiated for ${snapshotId}. The upload may still be running in the background.\n` +
				`Verify with: wp snapshots search ${snapshotId}`,
			);
		}
		return err(`Snapshot push failed: ${msg}`);
	}
}

// ── snapshot_pull ──────────────────────────────────────────────────────

async function handleSnapshotPull(
	args: Record<string, unknown>,
	config: SiteConfig,
): Promise<{ content: Array<{ type: string; text: string }> }> {
	const snapshotId = String(args.snapshot_id || '').trim();
	const repository = String(args.repository || '10up').trim();
	const includeFiles = args.include_files === true;
	const siteMapping = args.site_mapping ? String(args.site_mapping).trim() : undefined;
	const mainDomain = args.main_domain ? String(args.main_domain).trim() : undefined;

	if (!snapshotId) return err('snapshot_id is required');

	// Run the pull directly with a long timeout (SNAPSHOT_TIMEOUT = 5 minutes).
	// The wp_cli tool only has a 60-second timeout which KILLS the PHP process,
	// preventing create_snapshots_user() from running. We must run it here with
	// a longer timeout so the full pull completes (including user creation).
	//
	// The MCP HTTP transport may drop the response if the pull takes >60s,
	// but the PHP process will finish in the background. The agent should
	// verify completion by checking if the snapshots user exists.
	const pullArgs = [
		'snapshots', 'pull', snapshotId,
		`--repository=${repository}`,
		'--confirm',
		'--include_db',
		'--overwrite_local_copy',
		'--confirm_ms_constant_update',
		'--confirm_wp_download',
		'--confirm_config_create',
		'--no-confirm_wp_version_change',
		includeFiles ? '--include_files' : '--no-include_files',
	];
	if (siteMapping) pullArgs.push(`--site_mapping=${siteMapping}`);
	if (mainDomain) pullArgs.push(`--main_domain=${mainDomain}`);

	// Spawn the pull as a detached process so it survives even if the MCP
	// HTTP handler is interrupted by transport timeout. The process writes
	// a marker file when it exits so we can detect completion.
	const markerDir = path.join(os.tmpdir(), 'agent-tools-snapshots');
	try {
		if (!existsSync(markerDir)) mkdirSync(markerDir, { recursive: true });
	} catch { /* best effort */ }

	const markerPath = path.join(markerDir, `pull-${snapshotId}.done`);
	// Remove stale marker from previous pull
	try { unlinkSync(markerPath); } catch { /* ok */ }

	spawnDetachedWp(config, pullArgs, markerPath);

	// Wait for pull to complete (poll the marker file)
	const pollInterval = 3_000;
	const maxWait = SNAPSHOT_TIMEOUT;
	let waited = 0;
	while (!existsSync(markerPath) && waited < maxWait) {
		await new Promise(r => setTimeout(r, pollInterval));
		waited += pollInterval;
	}

	const log: string[] = [];
	if (existsSync(markerPath)) {
		let exitCode = -1;
		try { exitCode = parseInt(await readFile(markerPath, 'utf-8'), 10); } catch { /* ok */ }
		if (exitCode === 0) {
			log.push(`Snapshot ${snapshotId} pulled successfully.`);
		} else {
			log.push(`Snapshot ${snapshotId} pull exited with code ${exitCode}.`);
		}
		// Clean up marker
		try { unlinkSync(markerPath); } catch { /* ok */ }
	} else {
		log.push(`Snapshot ${snapshotId} pull is still running (waited ${Math.round(waited / 1000)}s).`);
		log.push('The process continues in the background.');
	}

	// Post-pull: apply .snapshot-plugins.json
	// Detect multisite for --network flag on plugin commands
	let isNetwork = false;
	try {
		const val = await runWp(config, ['config', 'get', 'MULTISITE'], 15_000);
		isNetwork = val === '1' || val.toLowerCase() === 'true';
	} catch {
		// Not multisite
	}
	const networkFlag = isNetwork ? ['--network'] : [];

	const snapshotConfig = await findSnapshotConfig(config);
	if (snapshotConfig) {
		if (snapshotConfig.deactivate.length > 0) {
			try {
				await runWp(config, ['plugin', 'deactivate', ...snapshotConfig.deactivate, ...networkFlag], 30_000);
				log.push(`Deactivated plugins: ${snapshotConfig.deactivate.join(', ')}`);
			} catch (e: unknown) {
				log.push(`Warning: some plugins could not be deactivated: ${errorMsg(e)}`);
			}
		}
		if (snapshotConfig.activate.length > 0) {
			try {
				await runWp(config, ['plugin', 'activate', ...snapshotConfig.activate, ...networkFlag], 30_000);
				log.push(`Activated plugins: ${snapshotConfig.activate.join(', ')}`);
			} catch (e: unknown) {
				log.push(`Warning: some plugins could not be activated: ${errorMsg(e)}`);
			}
		}
		for (const cmd of snapshotConfig.commands) {
			try {
				const cmdArgs = splitArgs(cmd);
				await runWp(config, cmdArgs, 30_000);
				log.push(`Ran: wp ${cmd}`);
			} catch (e: unknown) {
				log.push(`Warning: "wp ${cmd}" failed: ${errorMsg(e)}`);
			}
		}
	}

	// Post-pull: flush rewrite rules and cache
	try { await runWp(config, ['rewrite', 'flush'], 15_000); } catch { /* non-critical */ }
	try { await runWp(config, ['cache', 'flush'], 15_000); } catch { /* non-critical */ }
	log.push('Rewrite rules and cache flushed.');

	log.push('');
	log.push('Login: username "snapshots", password "password"');
	return ok(log.join('\n'));
}

// ── snapshot_import ─────────────────────────────────────────────────────

async function handleSnapshotImport(
	args: Record<string, unknown>,
	config: SiteConfig,
): Promise<{ content: Array<{ type: string; text: string }> }> {
	const sqlFilePath = args.sql_file ? String(args.sql_file).trim() : '';

	// If no sql_file provided, list available files for the user to choose
	if (!sqlFilePath) {
		const allFiles = findAllSqlFiles(config);
		const nonBackupFiles = allFiles.filter(f => !f.name.startsWith('db-backup-'));
		if (nonBackupFiles.length === 0) {
			return err(
				'No .sql or .sql.gz files found.\n' +
				`Searched: ${config.wpPath}, ${path.join(config.wpPath, 'wp-content')}, ${config.sitePath}\n` +
				'Place a MySQL dump in the project root or wp-content directory, or provide the sql_file path.',
			);
		}
		const fileList = nonBackupFiles.map((f, i) => `  ${i + 1}. ${f.name}  (${f.size}, modified ${f.modified})\n     ${f.path}`).join('\n');
		return ok(
			`Available SQL files:\n\n${fileList}\n\n` +
			'Ask the user which file to import, then call snapshot_import again with the sql_file path.',
		);
	}

	const sqlFile = resolveSqlFile(config, sqlFilePath);
	if (!sqlFile) return err(`SQL file not found: ${sqlFilePath}`);

	const log: string[] = [];
	log.push(`SQL file: ${sqlFile}`);

	// Backup current database
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
	const backupFile = path.join(config.wpPath, `db-backup-${timestamp}.sql`);
	log.push(`Backing up current database to ${backupFile}...`);
	try {
		await runWp(config, ['db', 'export', backupFile, '--all-tablespaces', '--add-drop-table']);
		log.push('Database backup complete.');
	} catch (e: unknown) {
		return err(`Database backup failed (aborting): ${errorMsg(e)}`);
	}

	// Import
	log.push('Importing database...');
	try {
		await runWp(config, ['db', 'import', sqlFile]);
		log.push('Database imported.');
	} catch (e: unknown) {
		return err(`Database import failed: ${errorMsg(e)}\nBackup available at: ${backupFile}`);
	}

	// Detect table prefix from wp-config.php (default: wp_)
	let tablePrefix = 'wp_';
	try {
		const wpConfigPath = path.join(config.wpPath, 'wp-config.php');
		if (existsSync(wpConfigPath)) {
			const wpConfig = await readFile(wpConfigPath, 'utf-8');
			const prefixMatch = wpConfig.match(/\$table_prefix\s*=\s*['"]([^'"]+)['"]/);
			if (prefixMatch) tablePrefix = prefixMatch[1];
		}
	} catch { /* use default */ }

	// Detect source URL via direct SQL query (not wp option get, which fails
	// on multisite when DOMAIN_CURRENT_SITE doesn't match the imported DB)
	let sourceUrl: string;
	try {
		const result = await runWp(config, [
			'db', 'query',
			`SELECT option_value FROM ${tablePrefix}options WHERE option_name = 'siteurl' LIMIT 1`,
			'--skip-column-names',
		], 15_000);
		sourceUrl = result.split('\n')[0].trim();
	} catch (e: unknown) {
		return err(`Could not read siteurl from imported database: ${errorMsg(e)}`);
	}
	if (!sourceUrl) return err('siteurl is empty in the imported database.');
	log.push(`Source URL: ${sourceUrl}`);

	// Detect multisite from wp-config.php
	let isMultisite = false;
	try {
		const val = await runWp(config, ['config', 'get', 'MULTISITE'], 15_000);
		isMultisite = val === '1' || val.toLowerCase() === 'true';
	} catch {
		// Not multisite
	}

	const localUrl = config.siteUrl;
	const sourceHost = extractHost(sourceUrl);
	const localHost = extractHost(localUrl);

	if (sourceHost && localHost && sourceHost !== localHost) {
		if (isMultisite) {
			// Multisite: replace domain across the network, specifying --url so
			// WP-CLI can bootstrap with the correct domain
			log.push(`Multisite: replacing domain ${sourceHost} -> ${localHost}`);
			await runWp(config, [
				'search-replace', sourceHost, localHost,
				`--url=${sourceHost}`,
				'--network', '--precise',
			]);
		} else {
			log.push(`Replacing URL: ${sourceUrl} -> ${localUrl}`);
			await runWp(config, ['search-replace', sourceUrl, localUrl, '--all-tables', '--precise']);
			// Handle protocol variant
			const altSource = flipProtocol(sourceUrl);
			if (altSource !== localUrl) {
				await runWp(config, ['search-replace', altSource, localUrl, '--all-tables', '--precise']);
			}
		}
		log.push('URL replacement complete.');
	}

	log.push('');
	log.push('Database imported. Now call snapshot_create to create the snapshot.');
	return ok(log.join('\n'));
}

// ── snapshot_create ─────────────────────────────────────────────────────

async function handleSnapshotCreate(
	args: Record<string, unknown>,
	config: SiteConfig,
): Promise<{ content: Array<{ type: string; text: string }> }> {
	const slug = String(args.slug || '').trim();
	const description = String(args.description || '').trim();
	const repository = String(args.repository || '10up').trim();
	const includeFiles = args.include_files === true;
	const small = args.small === true;
	const authorName = args.author_name ? String(args.author_name).trim() : undefined;
	const authorEmail = args.author_email ? String(args.author_email).trim() : undefined;

	const skipSqlCheck = args.skip_sql_check === true;

	if (!slug) return err('slug is required');
	if (!description) return err('description is required');

	// Check for SQL files and prompt the agent to ask the user
	if (!skipSqlCheck) {
		const sqlFiles = findAllSqlFiles(config);
		// Filter out db-backup-* files (our own backups)
		const nonBackupFiles = sqlFiles.filter(f => !f.name.startsWith('db-backup-'));
		if (nonBackupFiles.length > 0) {
			const fileList = nonBackupFiles.map(f => `  - ${f.path}  (${f.size}, modified ${f.modified})`).join('\n');
			return ok(
				'SQL files found in the project. Ask the user before proceeding:\n' +
				'Should the snapshot use the current database, or import one of these files first?\n\n' +
				fileList + '\n\n' +
				'If importing: call snapshot_import with the chosen file, then call snapshot_create.\n' +
				'If using current DB: call snapshot_create again with skip_sql_check=true.',
			);
		}
	}

	// Pre-flight
	try {
		await runWp(config, ['snapshots', '--version'], 15_000);
	} catch {
		return err(
			'wp snapshots is not installed or not available.\n' +
			'Install with: wp package install 10up/snapshots:"^1.0.0"',
		);
	}

	const createArgs = [
		'snapshots', 'create',
		`--repository=${repository}`,
		`--slug=${slug}`,
		`--description=${description}`,
		'--include_db',
	];
	createArgs.push(includeFiles ? '--include_files' : '--no-include_files');
	if (small) createArgs.push('--small');
	if (authorName) createArgs.push(`--author_name=${authorName}`);
	if (authorEmail) createArgs.push(`--author_email=${authorEmail}`);

	// Snapshot directory for filesystem fallback
	const snapshotsDir = process.env.TENUP_SNAPSHOTS_DIR || path.join(os.homedir(), '.wpsnapshots');
	let dirsBefore = new Set<string>();
	try {
		if (existsSync(snapshotsDir)) {
			dirsBefore = new Set(readdirSync(snapshotsDir));
		}
	} catch { /* best effort */ }

	try {
		const output = await runWp(config, createArgs);

		// Extract snapshot ID via regex
		let snapshotId: string | null = null;
		for (const pattern of [/Snapshot\s+([a-f0-9]+)\s+created/, /Success:\s+Snapshot\s+([a-f0-9]+)/, /([a-f0-9]{32})\s+created/]) {
			const match = output.match(pattern);
			if (match) { snapshotId = match[1]; break; }
		}

		// Fallback: diff ~/.wpsnapshots/ directory
		if (!snapshotId) {
			try {
				if (existsSync(snapshotsDir)) {
					const dirsAfter = readdirSync(snapshotsDir);
					const newDirs = dirsAfter.filter(d => !dirsBefore.has(d) && /^[a-f0-9]+$/.test(d));
					if (newDirs.length >= 1) {
						let newest = newDirs[0];
						let newestTime = 0;
						for (const d of newDirs) {
							try {
								const t = statSync(path.join(snapshotsDir, d)).mtimeMs;
								if (t > newestTime) { newestTime = t; newest = d; }
							} catch { /* skip */ }
						}
						snapshotId = newest;
					}
				}
			} catch { /* best effort */ }
		}

		if (snapshotId) {
			return ok(
				`Snapshot ID: ${snapshotId}\n` +
				`Status: created locally (not pushed)\n` +
				`Login: username "snapshots", password "password"\n` +
				`To push: wp snapshots push ${snapshotId} --repository=${repository}`,
			);
		}

		// Diagnostics if ID not found
		let dirsAfterCount = 0;
		try { dirsAfterCount = existsSync(snapshotsDir) ? readdirSync(snapshotsDir).length : 0; } catch { /* */ }
		return ok(
			`ERROR: Could not determine snapshot ID.\n` +
			`Snapshots dir: ${snapshotsDir} (exists: ${existsSync(snapshotsDir)})\n` +
			`Dirs before: ${dirsBefore.size}, after: ${dirsAfterCount}\n` +
			`WP-CLI output: ${(output || '(empty)').slice(0, 500)}`,
		);
	} catch (e: unknown) {
		return err(`Snapshot creation failed: ${errorMsg(e)}`);
	}
}

// ── snapshot_search ────────────────────────────────────────────────────

/** Max characters to return from search results to avoid exceeding MCP response limits. */
const SEARCH_MAX_CHARS = 50_000;

async function handleSnapshotSearch(
	args: Record<string, unknown>,
	config: SiteConfig,
): Promise<{ content: Array<{ type: string; text: string }> }> {
	const search = String(args.search || '').trim();
	const repository = String(args.repository || '10up').trim();

	if (!search) return err('search text is required (use "*" to list all)');

	try {
		await runWp(config, ['snapshots', '--version'], 15_000);
	} catch {
		return err(
			'wp snapshots is not installed or not available.\n' +
			'Install with: wp package install 10up/snapshots:"^1.0.0"',
		);
	}

	try {
		const output = await runWp(
			config,
			['snapshots', 'search', search, `--repository=${repository}`],
			30_000,
		);

		if (output.length > SEARCH_MAX_CHARS) {
			const truncated = output.slice(0, SEARCH_MAX_CHARS);
			const lastNewline = truncated.lastIndexOf('\n');
			return ok(
				(lastNewline > 0 ? truncated.slice(0, lastNewline) : truncated) +
				'\n\n--- Output truncated (too many results). Use a more specific search term. ---',
			);
		}

		return ok(output);
	} catch (e: unknown) {
		const msg = errorMsg(e);
		return err(`Snapshot search failed: ${msg}`);
	}
}

// ── Utilities ──────────────────────────────────────────────────────────

/** Split a command string into args, respecting single and double quotes. */
function splitArgs(str: string): string[] {
	const args: string[] = [];
	let current = '';
	let inSingle = false;
	let inDouble = false;
	for (let i = 0; i < str.length; i++) {
		const ch = str[i];
		if (ch === "'" && !inDouble) { inSingle = !inSingle; }
		else if (ch === '"' && !inSingle) { inDouble = !inDouble; }
		else if (ch === ' ' && !inSingle && !inDouble) {
			if (current) { args.push(current); current = ''; }
		} else { current += ch; }
	}
	if (current) args.push(current);
	return args;
}

function extractHost(url: string): string | null {
	try {
		return new URL(url).host;
	} catch {
		return null;
	}
}

function flipProtocol(url: string): string {
	if (url.startsWith('https://')) return url.replace('https://', 'http://');
	if (url.startsWith('http://')) return url.replace('http://', 'https://');
	return url;
}

function errorMsg(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

function ok(text: string): { content: Array<{ type: string; text: string }> } {
	return { content: [{ type: 'text', text }] };
}

function err(message: string): { content: Array<{ type: string; text: string }> } {
	return { content: [{ type: 'text', text: `Error: ${message}` }] };
}
