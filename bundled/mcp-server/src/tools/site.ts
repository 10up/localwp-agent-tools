import { readFile, stat, access, constants } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);

// ── Environment ────────────────────────────────────────────────────────
const SITE_PATH    = process.env.SITE_PATH || '';
const WP_PATH      = process.env.WP_PATH || '';
const DB_SOCKET    = process.env.DB_SOCKET || '';
const DB_PORT      = parseInt(process.env.DB_PORT || '3306', 10);
const DB_NAME      = process.env.DB_NAME || 'local';
const DB_USER      = process.env.DB_USER || 'root';
const PHP_BIN      = process.env.PHP_BIN || 'php';
const SITE_DOMAIN  = process.env.SITE_DOMAIN || '';
const SITE_URL     = process.env.SITE_URL || '';
const LOG_PATH     = process.env.LOG_PATH || '';

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
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    switch (name) {
      case 'get_site_info':
        return handleGetSiteInfo();
      case 'site_health_check':
        return handleSiteHealthCheck();
      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: `Error: ${msg}` }] };
  }
}

// ── get_site_info ──────────────────────────────────────────────────────
async function handleGetSiteInfo(): Promise<{
  content: Array<{ type: string; text: string }>;
}> {
  const info: Record<string, unknown> = {
    sitePath: SITE_PATH,
    wpPath: WP_PATH,
    siteDomain: SITE_DOMAIN,
    siteUrl: SITE_URL,
    logPath: LOG_PATH,
    database: {
      name: DB_NAME,
      user: DB_USER,
      socket: DB_SOCKET || null,
      port: DB_PORT,
    },
  };

  // Read WordPress version from wp-includes/version.php
  const versionFile = path.join(WP_PATH, 'wp-includes', 'version.php');
  if (existsSync(versionFile)) {
    try {
      const versionContent = await readFile(versionFile, 'utf-8');
      const wpVersionMatch = versionContent.match(
        /\$wp_version\s*=\s*['"]([^'"]+)['"]/,
      );
      const dbVersionMatch = versionContent.match(
        /\$wp_db_version\s*=\s*(\d+)/,
      );
      info.wpVersion = wpVersionMatch ? wpVersionMatch[1] : 'unknown';
      info.wpDbVersion = dbVersionMatch ? dbVersionMatch[1] : 'unknown';
    } catch {
      info.wpVersion = 'error reading version file';
    }
  }

  // Get PHP version
  try {
    const { stdout } = await execFileAsync(PHP_BIN, ['-v'], { timeout: 5_000 });
    const phpVersionMatch = stdout.match(/PHP\s+([\d.]+)/);
    info.phpVersion = phpVersionMatch ? phpVersionMatch[1] : stdout.split('\n')[0];
  } catch {
    info.phpVersion = 'unable to determine';
  }

  // Parse wp-config.php for key settings
  const configPath = path.join(WP_PATH, 'wp-config.php');
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
  const wpCliBin = process.env.WP_CLI_BIN || '';
  if (wpCliBin && existsSync(wpCliBin)) {
    try {
      const { stdout: pluginOut } = await execFileAsync(
        PHP_BIN,
        [wpCliBin, 'plugin', 'list', '--status=active', '--format=json', `--path=${WP_PATH}`, '--skip-themes', '--skip-plugins'],
        { cwd: WP_PATH, timeout: 15_000, env: { ...process.env, PHP: PHP_BIN } },
      );
      info.activePlugins = JSON.parse(pluginOut);
    } catch {
      info.activePlugins = 'unable to retrieve (WP-CLI error)';
    }

    try {
      const { stdout: themeOut } = await execFileAsync(
        PHP_BIN,
        [wpCliBin, 'theme', 'list', '--status=active', '--format=json', `--path=${WP_PATH}`, '--skip-themes', '--skip-plugins'],
        { cwd: WP_PATH, timeout: 15_000, env: { ...process.env, PHP: PHP_BIN } },
      );
      info.activeTheme = JSON.parse(themeOut);
    } catch {
      info.activeTheme = 'unable to retrieve (WP-CLI error)';
    }
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(info, null, 2),
      },
    ],
  };
}

// ── site_health_check ──────────────────────────────────────────────────
async function handleSiteHealthCheck(): Promise<{
  content: Array<{ type: string; text: string }>;
}> {
  const checks: Array<{ check: string; status: 'ok' | 'warning' | 'error'; details: string }> = [];

  // 1. Database connectivity (via WP-CLI)
  const wpCliBin = process.env.WP_CLI_BIN || '';
  if (wpCliBin && existsSync(wpCliBin)) {
    try {
      const wpCliArgs = [wpCliBin, 'db', 'check', `--path=${WP_PATH}`, '--skip-themes', '--skip-plugins'];
      if (DB_SOCKET) wpCliArgs.splice(3, 0, '-d', `mysqli.default_socket=${DB_SOCKET}`, '-d', `pdo_mysql.default_socket=${DB_SOCKET}`);
      await execFileAsync(PHP_BIN, wpCliArgs, { cwd: WP_PATH, timeout: 15_000, env: { ...process.env, PHP: PHP_BIN } });

      // Get table count
      const countArgs = [wpCliBin, 'db', 'query', 'SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()', '--skip-column-names', `--path=${WP_PATH}`, '--skip-themes', '--skip-plugins'];
      if (DB_SOCKET) countArgs.splice(3, 0, '-d', `mysqli.default_socket=${DB_SOCKET}`, '-d', `pdo_mysql.default_socket=${DB_SOCKET}`);
      const { stdout: countOut } = await execFileAsync(PHP_BIN, countArgs, { cwd: WP_PATH, timeout: 15_000, env: { ...process.env, PHP: PHP_BIN } });
      const tableCount = parseInt(countOut.trim(), 10) || 0;

      checks.push({
        check: 'Database connectivity',
        status: 'ok',
        details: `Connected successfully. ${tableCount} tables in ${DB_NAME}.`,
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
    { label: 'wp-content', path: path.join(WP_PATH, 'wp-content') },
    { label: 'wp-content/uploads', path: path.join(WP_PATH, 'wp-content', 'uploads') },
    { label: 'wp-content/plugins', path: path.join(WP_PATH, 'wp-content', 'plugins') },
    { label: 'wp-content/themes', path: path.join(WP_PATH, 'wp-content', 'themes') },
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
  const configPath = path.join(WP_PATH, 'wp-config.php');
  if (existsSync(configPath)) {
    try {
      const configContent = await readFile(configPath, 'utf-8');
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
    { label: 'PHP error log', path: path.join(LOG_PATH, 'php', 'error.log') },
    { label: 'WP debug log', path: path.join(WP_PATH, 'wp-content', 'debug.log') },
    { label: 'Nginx access log', path: path.join(LOG_PATH, 'nginx', 'access.log') },
    { label: 'Nginx error log', path: path.join(LOG_PATH, 'nginx', 'error.log') },
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
    const { stdout } = await execFileAsync(PHP_BIN, ['-v'], { timeout: 5_000 });
    const phpVersionMatch = stdout.match(/PHP\s+([\d.]+)/);
    const phpVersion = phpVersionMatch ? phpVersionMatch[1] : 'unknown';

    // Check for minimum recommended version
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
      details: `Cannot execute PHP binary at: ${PHP_BIN}`,
    });
  }

  // 6. wp-config.php exists
  checks.push({
    check: 'wp-config.php',
    status: existsSync(configPath) ? 'ok' : 'error',
    details: existsSync(configPath) ? 'Present.' : `Not found at: ${configPath}`,
  });

  // Summary
  const errors = checks.filter((c) => c.status === 'error').length;
  const warnings = checks.filter((c) => c.status === 'warning').length;
  const summary = errors > 0
    ? `${errors} error(s), ${warnings} warning(s)`
    : warnings > 0
      ? `${warnings} warning(s), no errors`
      : 'All checks passed';

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ summary, checks }, null, 2),
      },
    ],
  };
}
