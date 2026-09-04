import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs-extra';
import * as crypto from 'crypto';

const DEFAULT_TOKEN_DIR = path.join(os.homedir(), '.local-agent-tools');
const TOKEN_FILE_NAME = 'token';

/** The only shape a token file may hold: 32 random bytes as lowercase hex. */
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/**
 * How long to keep re-reading the token file after losing the create race.
 * `wx` fails as soon as another caller has *opened* the file, which can be
 * before it has written the token into it, so the loser can briefly see an
 * empty file. 20 tries at 10ms is far longer than a 64-byte write needs and
 * only ever runs when two callers create the token at the same instant.
 */
const RACE_REREAD_ATTEMPTS = 20;
const RACE_REREAD_DELAY_MS = 10;

interface SavedToken {
	/** Whether a token file is present at all — a missing file and an unusable
	 * one need different handling. */
	exists: boolean;
	/** The token the file holds, or null when it holds nothing usable. */
	token: string | null;
}

/**
 * Reads the saved token. A file whose contents don't match `TOKEN_PATTERN`
 * counts as no token at all: an empty, truncated, or hand-edited file must
 * never become the secret the server enforces, because a short or predictable
 * value would weaken auth silently.
 */
async function readTokenFile(tokenFile: string): Promise<SavedToken> {
	try {
		const token = (await fs.readFile(tokenFile, 'utf-8')).trim();
		return { exists: true, token: TOKEN_PATTERN.test(token) ? token : null };
	} catch {
		// Missing, unreadable, or not a file. Either way there's no usable token
		// here, and the create path below surfaces any real error.
		return { exists: false, token: null };
	}
}

/** Re-reads the token file until it holds a valid token, or gives up. */
async function rereadUntilValid(tokenFile: string): Promise<string | null> {
	for (let attempt = 0; attempt < RACE_REREAD_ATTEMPTS; attempt += 1) {
		const saved = await readTokenFile(tokenFile);
		if (saved.token) return saved.token;
		await new Promise((resolve) => setTimeout(resolve, RACE_REREAD_DELAY_MS));
	}
	return null;
}

/**
 * Enforces owner-only permissions and returns the token. `mode` on `writeFile`
 * and `ensureDir` only applies when the call creates the entry, so a file or
 * directory that already existed keeps whatever mode it had — including one an
 * older version or the user left group- or world-readable. Every path out of
 * `getOrCreateToken` goes through here so the mode is never left to chance.
 */
async function harden(tokenDir: string, tokenFile: string, token: string): Promise<string> {
	await fs.chmod(tokenDir, 0o700);
	await fs.chmod(tokenFile, 0o600);
	return token;
}

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

	const saved = await readTokenFile(tokenFile);
	if (saved.token) return harden(tokenDir, tokenFile, saved.token);

	await fs.ensureDir(tokenDir, { mode: 0o700 });
	const token = crypto.randomBytes(32).toString('hex');

	if (saved.exists) {
		// The file is there and holds nothing usable, so nothing can be
		// authenticating with it. Overwrite in place: `wx` could only fail here,
		// and removing the file first buys nothing because `harden` sets the
		// mode explicitly either way.
		await fs.writeFile(tokenFile, token, { encoding: 'utf-8', mode: 0o600 });
		return harden(tokenDir, tokenFile, token);
	}

	try {
		// `wx` creates or fails — it never truncates. Two callers starting at
		// once therefore can't both write, which would leave one of them handing
		// out a token the file no longer holds.
		await fs.writeFile(tokenFile, token, { encoding: 'utf-8', flag: 'wx', mode: 0o600 });
		return harden(tokenDir, tokenFile, token);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
	}

	// Lost the create race, so the other caller's token is the one in effect.
	const winner = await rereadUntilValid(tokenFile);
	if (winner) return harden(tokenDir, tokenFile, winner);

	// The other caller never produced a usable token. Take the file over rather
	// than leaving startup with no token at all.
	await fs.writeFile(tokenFile, token, { encoding: 'utf-8', mode: 0o600 });
	return harden(tokenDir, tokenFile, token);
}
