import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs-extra';
import * as crypto from 'crypto';

const DEFAULT_TOKEN_DIR = path.join(os.homedir(), '.local-agent-tools');
const TOKEN_FILE_NAME = 'token';

/**
 * Returns the per-install bearer token used to authenticate MCP HTTP
 * requests, generating and persisting one on first use. Mirrors the
 * persistence pattern in `port.ts` so the token survives across restarts.
 *
 * `tokenDir` defaults to the real `~/.local-agent-tools` and is injectable
 * only so tests can point at a temp directory — callers in main.ts always
 * call this argument-free.
 */
export async function getOrCreateToken(tokenDir: string = DEFAULT_TOKEN_DIR): Promise<string> {
	const tokenFile = path.join(tokenDir, TOKEN_FILE_NAME);

	try {
		const content = await fs.readFile(tokenFile, 'utf-8');
		const token = content.trim();
		if (token) {
			return token;
		}
	} catch {
		// No saved token file
	}

	const token = crypto.randomBytes(32).toString('hex');
	await fs.ensureDir(tokenDir, { mode: 0o700 });
	await fs.writeFile(tokenFile, token, { encoding: 'utf-8', mode: 0o600 });
	return token;
}

export async function removeTokenFile(tokenDir: string = DEFAULT_TOKEN_DIR): Promise<void> {
	try {
		await fs.remove(path.join(tokenDir, TOKEN_FILE_NAME));
	} catch {
		// Best-effort cleanup
	}
}

export function removeTokenFileSync(tokenDir: string = DEFAULT_TOKEN_DIR): void {
	try {
		fs.removeSync(path.join(tokenDir, TOKEN_FILE_NAME));
	} catch {
		// Best-effort cleanup
	}
}
