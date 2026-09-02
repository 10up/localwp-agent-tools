import { describe, it, expect, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { mkdtempSync, rmSync, statSync } from 'fs';
import { getOrCreateToken } from '../../src/helpers/auth';

describe('getOrCreateToken', () => {
	let tmpParent: string;

	afterEach(() => {
		if (tmpParent) rmSync(tmpParent, { recursive: true, force: true });
	});

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
});
