import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveBinary } from '../../src/agent-shell/binary';

const HOME = os.homedir();

function binDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'localwp-agents-bin-'));
	fs.writeFileSync(path.join(dir, 'claude'), '#!/bin/sh\n', { mode: 0o755 });
	fs.writeFileSync(path.join(dir, 'notexec'), 'text\n', { mode: 0o644 });
	return dir;
}

test('resolveBinary finds a bare name in the PATH', () => {
	const dir = binDir();

	assert.equal(resolveBinary('claude', HOME, `/nope:${dir}`), path.join(dir, 'claude'));
});

test('resolveBinary uses an absolute path as given', () => {
	const dir = binDir();
	const claude = path.join(dir, 'claude');

	assert.equal(resolveBinary(claude, HOME, ''), claude);
});

test('resolveBinary rejects a file that is not executable', () => {
	const dir = binDir();

	assert.throws(() => resolveBinary('notexec', HOME, dir), /notexec/);
});

test('resolveBinary names the binary it could not find', () => {
	assert.throws(() => resolveBinary('claude', HOME, '/nope'), /claude/);
});
