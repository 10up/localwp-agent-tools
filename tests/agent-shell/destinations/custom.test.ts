import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { openWithCommand, renderTemplate } from '../../../src/agent-shell/destinations/custom';
import type { LaunchTarget } from '../../../src/agent-shell/destinations/types';

const TARGET: LaunchTarget = {
	siteName: 'bob',
	webRoot: os.tmpdir(),
	scriptPath: '/tmp/none.sh',
	tabLabel: 'Shell',
	home: os.homedir(),
};

test('openWithCommand returns while a long-running command keeps running', async () => {
	const started = Date.now();
	await openWithCommand('sleep 5', TARGET);

	assert.ok(Date.now() - started < 4000);
});

test('openWithCommand reports a command that fails right away', async () => {
	await assert.rejects(openWithCommand('exit 3', TARGET), /3/);
});

const VALUES = { script: '/a b/s.sh', cwd: '/Users/x/Local Sites/bob/app/public', site: "Bob's site" };

test('openWithCommand finds commands in the given PATH', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-shell-bin-'));
	fs.writeFileSync(path.join(dir, 'example-launcher'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });

	try {
		await openWithCommand('example-launcher', TARGET, `${dir}:/usr/bin:/bin`);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test('openWithCommand includes the command error output in the failure', async () => {
	await assert.rejects(openWithCommand('echo "error-$((2 + 3))" >&2; exit 4', TARGET, '/usr/bin:/bin'), /error-5/);
});

test('renderTemplate quotes the script path', () => {
	assert.equal(renderTemplate('open -a Ghostty {script}', VALUES), "open -a Ghostty '/a b/s.sh'");
});

test('renderTemplate quotes the site name and working directory', () => {
	assert.equal(
		renderTemplate('tool --title {site} --dir {cwd}', VALUES),
		"tool --title 'Bob'\\''s site' --dir '/Users/x/Local Sites/bob/app/public'",
	);
});

test('renderTemplate fills every occurrence and leaves unknown placeholders alone', () => {
	assert.equal(renderTemplate('{site} {site} {foo}', VALUES), "'Bob'\\''s site' 'Bob'\\''s site' {foo}");
});

test('renderTemplate rejects an empty template', () => {
	assert.throws(() => renderTemplate('  ', VALUES), /custom command/);
});
