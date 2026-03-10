import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { access, constants } from 'node:fs/promises';
import path from 'node:path';

const execFileAsync = promisify(execFile);

// ── Environment ────────────────────────────────────────────────────────
const WP_PATH = process.env.WP_PATH || '';
const PHP_BIN = process.env.PHP_BIN || 'php';
const WP_CLI_BIN_ENV = process.env.WP_CLI_BIN || '';

// ── WP-CLI resolution ──────────────────────────────────────────────────
function getCommonWpCliPaths(): string[] {
  const homedir = process.env.HOME || process.env.USERPROFILE || '';
  const wpPaths = [
    path.join(WP_PATH, 'wp-cli.phar'),
    path.join(WP_PATH, '..', 'wp-cli.phar'),
  ];

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(homedir, 'AppData', 'Roaming');
    return [
      ...wpPaths,
      path.join(homedir, '.wp-cli', 'wp-cli.phar'),
      path.join(homedir, 'bin', 'wp-cli.phar'),
      path.join(appData, 'Composer', 'vendor', 'bin', 'wp'),
      'C:\\ProgramData\\chocolatey\\bin\\wp.bat',
    ];
  }

  // macOS and Linux
  return [
    '/usr/local/bin/wp',
    '/usr/bin/wp',
    '/opt/homebrew/bin/wp',
    '/snap/bin/wp',
    ...wpPaths,
    path.join(homedir, '.wp-cli', 'wp-cli.phar'),
    path.join(homedir, 'bin', 'wp'),
    path.join(homedir, '.local', 'bin', 'wp'),
    path.join(homedir, '.composer', 'vendor', 'bin', 'wp'),
  ];
}

let _resolvedWpCli: string | null = null;
let _wpCliResolved = false;

async function resolveWpCli(): Promise<string | null> {
  if (_wpCliResolved) return _resolvedWpCli;
  _wpCliResolved = true;

  // 1. Check environment variable
  if (WP_CLI_BIN_ENV) {
    try {
      await access(WP_CLI_BIN_ENV, constants.X_OK);
      _resolvedWpCli = WP_CLI_BIN_ENV;
      console.error(`[wpcli] Using WP-CLI from env: ${WP_CLI_BIN_ENV}`);
      return _resolvedWpCli;
    } catch {
      // If it's a .phar file, it may not be executable on its own — run via PHP
      if (existsSync(WP_CLI_BIN_ENV)) {
        _resolvedWpCli = WP_CLI_BIN_ENV;
        console.error(`[wpcli] Using WP-CLI phar from env: ${WP_CLI_BIN_ENV}`);
        return _resolvedWpCli;
      }
      console.error(`[wpcli] WP_CLI_BIN (${WP_CLI_BIN_ENV}) not found or not executable.`);
    }
  }

  // 2. Probe common locations (platform-aware)
  for (const p of getCommonWpCliPaths()) {
    if (existsSync(p)) {
      _resolvedWpCli = p;
      console.error(`[wpcli] Found WP-CLI at: ${p}`);
      return _resolvedWpCli;
    }
  }

  // 3. Try `which wp` (or `where wp` on Windows) as a last resort
  try {
    const whichCmd = process.platform === 'win32' ? 'where' : 'which';
    const { stdout } = await execFileAsync(whichCmd, ['wp'], { timeout: 5_000 });
    const found = stdout.trim().split(/\r?\n/)[0]; // `where` may return multiple lines
    if (found && existsSync(found)) {
      _resolvedWpCli = found;
      console.error(`[wpcli] Found WP-CLI via ${whichCmd}: ${found}`);
      return _resolvedWpCli;
    }
  } catch {
    // not found in PATH
  }

  console.error('[wpcli] WP-CLI not found anywhere.');
  return null;
}

// ── Core WP-CLI execution ──────────────────────────────────────────────
async function runWpCli(
  wpArgs: string[],
  options?: { timeout?: number },
): Promise<{ stdout: string; stderr: string }> {
  const wpCliBin = await resolveWpCli();

  if (!wpCliBin) {
    throw new Error(
      'WP-CLI is not installed or not found. To install:\n' +
        '  curl -O https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar\n' +
        '  chmod +x wp-cli.phar\n' +
        '  sudo mv wp-cli.phar /usr/local/bin/wp\n\n' +
        'Or set the WP_CLI_BIN environment variable to the path of your wp-cli binary.',
    );
  }

  // Build command: php [-d socket_overrides] <wp-cli.phar> <args> --path=<wp_path>
  const cmdArgs: string[] = [];

  // Local's wp-config.php uses DB_HOST=localhost, which makes PHP's mysqli
  // connect via Unix socket. By default it looks for /tmp/mysql.sock, but
  // Local uses a custom socket path per site. Pass it via PHP's -d directive
  // so mysqlnd knows where the socket actually is.
  if (process.env.DB_SOCKET) {
    cmdArgs.push('-d', `mysqli.default_socket=${process.env.DB_SOCKET}`);
    cmdArgs.push('-d', `pdo_mysql.default_socket=${process.env.DB_SOCKET}`);
  }

  cmdArgs.push(wpCliBin, ...wpArgs);

  // Always ensure --path is set unless the user explicitly passed it
  const hasPathArg = wpArgs.some((a) => a.startsWith('--path=') || a === '--path');
  if (!hasPathArg && WP_PATH) {
    cmdArgs.push(`--path=${WP_PATH}`);
  }

  // Skip themes/plugins that may fatally error
  cmdArgs.push('--skip-themes', '--skip-plugins');

  const timeout = options?.timeout ?? 60_000;

  return execFileAsync(PHP_BIN, cmdArgs, {
    cwd: WP_PATH,
    timeout,
    maxBuffer: 10 * 1024 * 1024, // 10 MB
    env: {
      ...process.env,
      PHP: PHP_BIN,
    },
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
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    switch (name) {
      case 'wp_cli':
        return handleWpCli(args);
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
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const rawArgs = String(args.args ?? '').trim();
  if (!rawArgs) {
    return { content: [{ type: 'text', text: 'Error: args parameter is required.' }] };
  }

  // Split the args string respecting quoted segments
  const wpArgs = splitArgs(rawArgs);
  const { stdout, stderr } = await runWpCli(wpArgs);

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
