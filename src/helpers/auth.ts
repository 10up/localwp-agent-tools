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
 * Replaces whatever is at the token path with a file we created ourselves.
 *
 * The unlink is the security-relevant half. A plain write and `fs.chmod` both
 * follow a symlink, so an entry left at this path pointing at another file
 * would redirect our write — and our 0600 — onto that file, handing whoever
 * placed the link both the token and a mode change on a file they chose.
 * `fs.remove` deletes the link itself (and ignores a missing path), and `wx`
 * then refuses to create through one: it creates or fails, never truncates
 * and never follows. Throws EEXIST when another caller claims the path in
 * between, which the caller handles by adopting that caller's token.
 */
async function writeFresh(tokenFile: string, token: string): Promise<void> {
	await fs.remove(tokenFile);
	await fs.writeFile(tokenFile, token, { encoding: 'utf-8', flag: 'wx', mode: 0o600 });
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

	try {
		if (saved.exists) {
			// Something is at the path holding nothing usable, so nothing can be
			// authenticating with it. Unlink it and create our own file: that is
			// the only way to be sure the write lands here and not through a
			// symlink someone left in place (see `writeFresh`).
			await writeFresh(tokenFile, token);
		} else {
			// Nothing at the path. Create with `wx` — it never truncates and
			// never follows a symlink — so two callers starting at once can't
			// both write, which would leave one of them handing out a token the
			// file no longer holds. No unlink on this branch on purpose: it
			// would delete the winner's file and reopen exactly that race.
			await fs.writeFile(tokenFile, token, { encoding: 'utf-8', flag: 'wx', mode: 0o600 });
		}
		return harden(tokenDir, tokenFile, token);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
	}

	// Lost the create race, so the other caller's token is the one in effect.
	const winner = await rereadUntilValid(tokenFile);
	if (winner) return harden(tokenDir, tokenFile, winner);

	// The other caller never produced a usable token — or the path holds a
	// dangling symlink, which `wx` reports as EEXIST and no read can resolve.
	// Take the path over rather than leaving startup with no token at all,
	// again unlink-then-create so this write can't be redirected either.
	try {
		await writeFresh(tokenFile, token);
		return harden(tokenDir, tokenFile, token);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
	}

	// Yet another caller claimed the path in that window, so its token is the
	// one in effect and one more read is enough to pick it up.
	const late = await rereadUntilValid(tokenFile);
	if (late) return harden(tokenDir, tokenFile, late);

	throw new Error(`Could not create a usable token file at ${tokenFile}`);
}
