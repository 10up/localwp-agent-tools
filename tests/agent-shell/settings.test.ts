import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
	DEFAULT_SETTINGS,
	instanceLabel,
	normalizeSettings,
	resolveOpen,
	sitesUsing,
	type Instance,
	type Settings,
} from '../../src/agent-shell/settings';

function instance(id: string, name: string): Instance {
	return { id, name, binary: 'claude', configDir: '', args: '', env: [] };
}

function settingsWith(defaultOpen: string): Settings {
	return {
		...DEFAULT_SETTINGS,
		defaultOpen,
		instances: [instance('p', 'Personal'), instance('f', 'Work')],
	};
}

test('normalizeSettings returns the defaults for missing settings', () => {
	assert.deepEqual(normalizeSettings(undefined), DEFAULT_SETTINGS);
});

test('normalizeSettings starts with a Claude instance as the default agent before anything is saved', () => {
	for (const raw of [undefined, {}]) {
		const settings = normalizeSettings(raw);

		assert.deepEqual(settings.instances, [
			{ id: 'claude', name: 'Claude', binary: 'claude', configDir: '', args: '', env: [] },
		]);
		assert.equal(resolveOpen(settings, undefined)?.id, 'claude');
	}
});

test('normalizeSettings keeps saved settings without instances empty', () => {
	const settings = normalizeSettings({ defaultOpen: 'claude', instances: [] });

	assert.deepEqual(settings.instances, []);
	assert.equal(resolveOpen(settings, undefined), null);
});

test('instanceLabel names an instance whose name is blank', () => {
	assert.equal(instanceLabel(instance('a', 'Claude Work')), 'Claude Work');
	assert.equal(instanceLabel(instance('b', '  ')), 'Unnamed instance');
});

test('normalizeSettings replaces an unknown destination with herdr', () => {
	assert.equal(normalizeSettings({ destination: 'warp' }).destination, 'herdr');
});

test('normalizeSettings drops invalid instances and fills instance defaults', () => {
	const settings = normalizeSettings({
		instances: [
			{
				id: 'a',
				name: 'Kept',
				env: [
					{ name: 'X', value: '1' },
					{ name: '', value: 'dropped' },
				],
			},
			{ name: 'No id' },
			{ id: 'b' },
		],
	});

	assert.deepEqual(settings.instances, [
		{ id: 'a', name: 'Kept', binary: 'claude', configDir: '', args: '', env: [{ name: 'X', value: '1' }] },
	]);
});

test('resolveOpen uses the default when the site has no override', () => {
	const settings = settingsWith('p');

	assert.equal(resolveOpen(settings, undefined)?.id, 'p');
	assert.equal(resolveOpen(settings, 'default')?.id, 'p');
});

test('resolveOpen returns null for the shell and the instance for an override', () => {
	const settings = settingsWith('p');

	assert.equal(resolveOpen(settings, 'shell'), null);
	assert.equal(resolveOpen(settings, 'f')?.id, 'f');
});

test('resolveOpen falls back when the chosen instance was deleted', () => {
	assert.equal(resolveOpen(settingsWith('p'), 'gone')?.id, 'p');
	assert.equal(resolveOpen(settingsWith('gone'), 'default'), null);
});

test('sitesUsing counts the sites whose override names the instance', () => {
	assert.equal(sitesUsing('f', ['f', 'default', undefined, 'f', 'shell']), 2);
});
