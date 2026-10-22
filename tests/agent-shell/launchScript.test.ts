import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
	agentCommand,
	buildLaunchScript,
	expandHome,
	launchScriptPath,
	shellQuote,
} from '../../src/agent-shell/launchScript';
import type { Instance } from '../../src/agent-shell/settings';

const HOME = '/Users/x';
const CLAUDE = '/Users/x/.local/bin/claude';

const ENTRY = [
	'export PHPRC="/Users/x/Library/Application Support/Local/run/abc/conf/php"',
	'cd "/Users/x/Local Sites/bob/app/public"',
	'',
	'unset NODE_ENV',
	'',
	'echo "Launching shell: $SHELL ..."',
	'exec $SHELL',
	'',
].join('\n');

const WORK: Instance = {
	id: 'f',
	name: 'Work',
	binary: 'claude',
	configDir: '~/.claude-work',
	args: '--model opus',
	env: [
		{ name: 'NOTES_DIR', value: '~/wiki-work' },
		{ name: 'EXAMPLE_MODE', value: 'full' },
	],
};

const PERSONAL: Instance = { id: 'p', name: 'Personal', binary: 'claude', configDir: '', args: '', env: [] };

test('shellQuote wraps values in single quotes and escapes embedded quotes', () => {
	assert.equal(shellQuote("Bob's site"), "'Bob'\\''s site'");
	assert.equal(shellQuote('$HOME'), "'$HOME'");
});

test('expandHome expands only a leading tilde', () => {
	assert.equal(expandHome('~/.claude-work', HOME), '/Users/x/.claude-work');
	assert.equal(expandHome('~', HOME), '/Users/x');
	assert.equal(expandHome('/abs', HOME), '/abs');
	assert.equal(expandHome('a~b', HOME), 'a~b');
});

test('agentCommand passes the instance settings to the Claude process only', () => {
	assert.equal(
		agentCommand(WORK, CLAUDE, HOME),
		"env CLAUDE_CONFIG_DIR='/Users/x/.claude-work' NOTES_DIR='/Users/x/wiki-work' EXAMPLE_MODE='full' '/Users/x/.local/bin/claude' --model opus",
	);
});

test('agentCommand unsets CLAUDE_CONFIG_DIR when the instance has none', () => {
	assert.equal(agentCommand(PERSONAL, CLAUDE, HOME), "env -u CLAUDE_CONFIG_DIR '/Users/x/.local/bin/claude'");
});

test('agentCommand appends the login PATH for the Claude process', () => {
	assert.equal(
		agentCommand(PERSONAL, CLAUDE, HOME, '/opt/homebrew/bin:/Users/x/.local/bin'),
		`env -u CLAUDE_CONFIG_DIR PATH="$PATH":'/opt/homebrew/bin:/Users/x/.local/bin' '/Users/x/.local/bin/claude'`,
	);
});

test('buildLaunchScript rejects an entry script without a final exec line for a plain shell', () => {
	assert.throws(() => buildLaunchScript('echo hi\n', null), /Local's site shell script/);
});

test('agentCommand rejects environment variable names the shell would not accept', () => {
	const instance: Instance = { ...PERSONAL, env: [{ name: 'X; rm -rf ~', value: '1' }] };

	assert.throws(() => agentCommand(instance, CLAUDE, HOME), /X; rm -rf ~/);
});

test('buildLaunchScript runs the agent before the final shell', () => {
	const script = buildLaunchScript(ENTRY, 'AGENT');
	const lines = script.split('\n');
	const agentIndex = lines.indexOf('AGENT');

	assert.ok(agentIndex > lines.indexOf('unset NODE_ENV'));
	assert.ok(agentIndex < lines.lastIndexOf('exec $SHELL'));
	assert.ok(script.endsWith('exec $SHELL\n'));
	assert.ok(script.startsWith(ENTRY.split('unset NODE_ENV')[0]));
});

test('buildLaunchScript keeps the script running when the agent is interrupted', () => {
	const lines = buildLaunchScript(ENTRY, 'AGENT').split('\n');
	const agentIndex = lines.indexOf('AGENT');

	assert.equal(lines[agentIndex - 1], 'trap : INT');
	assert.equal(lines[agentIndex + 1], 'trap - INT');
});

test('buildLaunchScript runs the agent before Local announces the shell', () => {
	const lines = buildLaunchScript(ENTRY, 'AGENT').split('\n');
	const announceIndex = lines.findIndex((line) => line.startsWith('echo "Launching shell'));

	assert.ok(lines.indexOf('AGENT') < announceIndex);
});

test('buildLaunchScript keeps the entry script as it is for a plain shell', () => {
	assert.equal(buildLaunchScript(ENTRY, null), ENTRY);
});

test('buildLaunchScript rejects an entry script without a final exec line', () => {
	assert.throws(() => buildLaunchScript('echo hi\n', 'x'), /Local's site shell script/);
});

test('launchScriptPath gives every launch its own file', () => {
	const first = launchScriptPath('/d', 'abc', 1);
	const second = launchScriptPath('/d', 'abc', 1);

	assert.notEqual(first, second);
	for (const path of [first, second]) {
		assert.ok(path.startsWith('/d/launch-abc-1-'));
		assert.ok(path.endsWith('.sh'));
	}
});
