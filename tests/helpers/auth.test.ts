import { describe, it, expect, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { getOrCreateToken } from '../../src/helpers/auth';

const HEX_64 = /^[0-9a-f]{64}$/;

describe('getOrCreateToken', () => {
	let tmpParent: string;

	afterEach(() => {
		if (tmpParent) rmSync(tmpParent, { recursive: true, force: true });
	});

	/** Creates a token dir holding a file with exactly `contents`. */
	function seedTokenFile(contents: string, mode = 0o600): string {
		tmpParent = mkdtempSync(path.join(os.tmpdir(), 'agent-tools-auth-'));
		const tokenDir = path.join(tmpParent, '.local-agent-tools');
		mkdirSync(tokenDir, { mode: 0o700 });
		const tokenFile = path.join(tokenDir, 'token');
		writeFileSync(tokenFile, contents, { mode });
		chmodSync(tokenFile, mode);
		return tokenDir;
	}

	it('returns a 64-character hex token', async () => {
		tmpParent = mkdtempSync(path.join(os.tmpdir(), 'agent-tools-auth-'));
		const tokenDir = path.join(tmpParent, '.local-agent-tools');

		const token = await getOrCreateToken(tokenDir);

		expect(token).toMatch(/^[0-9a-f]{64}$/);
	});

	it('returns the same token on a second call (persistence)', async () => {
		tmpParent = mkdtempSync(path.join(os.tmpdir(), 'agent-tools-auth-'));
		const tokenDir = path.join(tmpParent, '.local-agent-tools');

		const first = await getOrCreateToken(tokenDir);
		const second = await getOrCreateToken(tokenDir);

		expect(second).toBe(first);
	});

	it('writes the token file as 0600 and the token directory as 0700', async () => {
		tmpParent = mkdtempSync(path.join(os.tmpdir(), 'agent-tools-auth-'));
		const tokenDir = path.join(tmpParent, '.local-agent-tools');

		await getOrCreateToken(tokenDir);

		const dirMode = statSync(tokenDir).mode & 0o777;
		const fileMode = statSync(path.join(tokenDir, 'token')).mode & 0o777;

		expect(dirMode).toBe(0o700);
		expect(fileMode).toBe(0o600);
	});

	// A file that doesn't hold a 64-hex token is worthless as a shared secret:
	// an empty or truncated one would make the length guard in `tokenMatches`
	// trivially satisfiable. Every unusable shape must be replaced, not kept.
	it.each([
		['an empty file', ''],
		['a whitespace-only file', '   \n\t\n'],
		['a non-hex file', 'not-a-token'],
		['a token of the wrong length', 'abcdef0123456789'],
		['an uppercase-hex token', 'A'.repeat(64)],
	])('replaces %s with a fresh 0600 token', async (_label, contents) => {
		const tokenDir = seedTokenFile(contents);

		const token = await getOrCreateToken(tokenDir);

		expect(token).toMatch(HEX_64);
		expect(readFileSync(path.join(tokenDir, 'token'), 'utf-8')).toBe(token);
		expect(statSync(path.join(tokenDir, 'token')).mode & 0o777).toBe(0o600);
		expect(statSync(tokenDir).mode & 0o777).toBe(0o700);
	});

	// `mode` on writeFile only applies when the call creates the file, so a
	// token file left group- or world-readable by an older version stays that
	// way unless we chmod it explicitly — which we must, even on the path that
	// keeps the existing token.
	it('tightens a pre-existing 0644 token file to 0600 and keeps its token', async () => {
		const existing = 'a'.repeat(64);
		const tokenDir = seedTokenFile(existing, 0o644);
		chmodSync(tokenDir, 0o755);

		const token = await getOrCreateToken(tokenDir);

		expect(token).toBe(existing);
		expect(statSync(path.join(tokenDir, 'token')).mode & 0o777).toBe(0o600);
		expect(statSync(tokenDir).mode & 0o777).toBe(0o700);
	});

	// Two Local windows starting at once both reach the create path. `wx` lets
	// exactly one win; the loser must adopt the winner's token rather than
	// truncating the file and handing out one the file no longer holds.
	it('two concurrent calls agree on one token, and the file holds it', async () => {
		tmpParent = mkdtempSync(path.join(os.tmpdir(), 'agent-tools-auth-'));
		const tokenDir = path.join(tmpParent, '.local-agent-tools');

		const [first, second] = await Promise.all([getOrCreateToken(tokenDir), getOrCreateToken(tokenDir)]);

		expect(first).toMatch(HEX_64);
		expect(second).toBe(first);
		expect(readFileSync(path.join(tokenDir, 'token'), 'utf-8')).toBe(first);
		expect(statSync(path.join(tokenDir, 'token')).mode & 0o777).toBe(0o600);
	});
});
