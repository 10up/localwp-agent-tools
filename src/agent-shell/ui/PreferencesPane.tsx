import * as React from 'react';
import { Button, FlySelect, TableList, TableListRow, Text, TextButton, Title } from '@getflywheel/local-components';
import { instanceLabel, newInstanceId, type Destination, type Instance, type Settings } from '../settings';
import { setDraft } from './draft';
import { agentOptions } from './labels';

const { useEffect, useState } = React;

type PaneProps = { electron: any; setApplyButtonDisabled: (disabled: boolean) => void };

const DESTINATION_OPTIONS: Record<Destination, string> = {
	herdr: 'Herdr',
	ghostty: 'Ghostty',
	custom: 'Custom command',
};

/** Local's buttons centre themselves in a column (align-self: center), so they sit in a row. */
const ROW: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12 };

/** Same width as Local's text inputs, so each instance's Edit and Delete line up. */
const CONFIG_DIR_COLUMN: React.CSSProperties = {
	width: 266,
	flex: 'none',
	overflow: 'hidden',
	textOverflow: 'ellipsis',
	whiteSpace: 'nowrap',
};
/** Local styles text inputs 266px wide; a name and value pair fills that width together. */
const PAIR_INPUT: React.CSSProperties = { width: (266 - 12) / 2, flex: 'none' };

/** TableListRow leaves out the label cell for an empty label, which shifts the row into the label column. */
const EMPTY_LABEL = '\u00a0';

export function PreferencesPane({ electron, setApplyButtonDisabled }: PaneProps) {
	const ipc = electron.ipcRenderer;
	const [settings, setSettings] = useState<Settings | null>(null);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		ipc.invoke('agent-tools:agent-shell-get-settings')
			.then((loaded: Settings) => {
				setSettings(loaded);
				setDraft(loaded);
			})
			.catch((err: unknown) => setError(`The settings could not be loaded. ${String(err)}`));
		return () => setDraft(null);
	}, []);

	if (!settings) return <Text>{error ?? 'Loading…'}</Text>;

	const update = (next: Settings) => {
		setSettings(next);
		setDraft(next);
		setApplyButtonDisabled(false);
	};

	const updateInstance = (id: string, changes: Partial<Instance>) => {
		update({
			...settings,
			instances: settings.instances.map((instance) =>
				instance.id === id ? { ...instance, ...changes } : instance,
			),
		});
	};

	const addInstance = () => {
		const instance: Instance = {
			id: newInstanceId(),
			name: 'New instance',
			binary: 'claude',
			configDir: '',
			args: '',
			env: [],
		};
		update({ ...settings, instances: [...settings.instances, instance] });
		setEditingId(instance.id);
	};

	const deleteInstance = async (instance: Instance) => {
		let count: number;
		try {
			count = await ipc.invoke('agent-tools:agent-shell-sites-using', instance.id);
		} catch (err) {
			console.error('[Agent Tools] Counting the sites that use an instance failed:', err);
			window.alert(`"${instanceLabel(instance)}" could not be deleted. ${String(err)}`);
			return;
		}
		const usage =
			count > 0
				? ` ${count} ${count === 1 ? 'site uses' : 'sites use'} it and will use the default agent instead.`
				: '';
		if (!window.confirm(`Delete "${instanceLabel(instance)}"?${usage}`)) return;

		update({
			...settings,
			defaultOpen: settings.defaultOpen === instance.id ? 'shell' : settings.defaultOpen,
			instances: settings.instances.filter((candidate) => candidate.id !== instance.id),
		});
		if (editingId === instance.id) setEditingId(null);
	};

	const editing = settings.instances.find((instance) => instance.id === editingId) ?? null;

	return (
		<>
			<SubHeading>Agent Shell</SubHeading>
			<TableList form>
				<TableListRow label="Open in">
					<FlySelect
						value={settings.destination}
						options={DESTINATION_OPTIONS}
						onChange={(destination: Destination) => update({ ...settings, destination })}
					/>
					<p>Where the Agent Shell button opens the site.</p>
				</TableListRow>
				{settings.destination === 'custom' && (
					<TableListRow label="Command">
						<input
							type="text"
							value={settings.customCommand}
							placeholder="open -a Ghostty {script}"
							onChange={(e) => update({ ...settings, customCommand: e.target.value })}
						/>
						<p>
							Use <code>{'{script}'}</code>, <code>{'{cwd}'}</code> and <code>{'{site}'}</code>. Each
							value is quoted for the shell.
						</p>
					</TableListRow>
				)}
				<TableListRow label="Default agent">
					<FlySelect
						value={settings.defaultOpen in agentOptions(settings) ? settings.defaultOpen : 'shell'}
						options={agentOptions(settings)}
						onChange={(defaultOpen: string) => update({ ...settings, defaultOpen })}
					/>
					<p>
						What the Agent Shell button starts in the new tab. A site can choose another one in its Tools ›
						Agent Tools panel.
					</p>
				</TableListRow>
			</TableList>

			<SubHeading>Claude instances</SubHeading>
			<TableList form>
				{settings.instances.map((instance) => (
					<TableListRow key={instance.id} label={instanceLabel(instance)}>
						<div style={ROW}>
							<span style={CONFIG_DIR_COLUMN}>{instance.configDir.trim() || '~/.claude (default)'}</span>
							<TextButton privateOptions={{ padding: 'none' }} onClick={() => setEditingId(instance.id)}>
								Edit
							</TextButton>
							<TextButton privateOptions={{ padding: 'none' }} onClick={() => deleteInstance(instance)}>
								Delete
							</TextButton>
						</div>
					</TableListRow>
				))}
				<TableListRow label={settings.instances.length === 0 ? 'No instances yet' : EMPTY_LABEL}>
					<div style={ROW}>
						<Button onClick={addInstance}>Add instance</Button>
					</div>
					<p>
						Values are stored in plain text in Local's settings. Don't put API keys or other secrets here.
					</p>
				</TableListRow>
			</TableList>

			{editing && (
				<>
					<SubHeading>
						<div style={ROW}>
							<span>Edit {instanceLabel(editing)}</span>
							<TextButton privateOptions={{ padding: 'none' }} onClick={() => setEditingId(null)}>
								Done
							</TextButton>
						</div>
					</SubHeading>
					<InstanceForm instance={editing} onChange={(changes) => updateInstance(editing.id, changes)} />
				</>
			)}
		</>
	);
}

function SubHeading({ children }: { children: React.ReactNode }) {
	return (
		<Title tag="h3" style={{ padding: '10px 30px' }}>
			{children}
		</Title>
	);
}

function InstanceForm({ instance, onChange }: { instance: Instance; onChange: (changes: Partial<Instance>) => void }) {
	const setVariable = (index: number, changes: Partial<Instance['env'][number]>) => {
		onChange({ env: instance.env.map((variable, i) => (i === index ? { ...variable, ...changes } : variable)) });
	};

	return (
		<TableList form>
			<TableListRow label="Name">
				<input
					type="text"
					value={instance.name}
					placeholder="Claude Work"
					onChange={(e) => onChange({ name: e.target.value })}
				/>
			</TableListRow>
			<TableListRow label="Binary path">
				<input
					type="text"
					value={instance.binary}
					placeholder="claude"
					onChange={(e) => onChange({ binary: e.target.value })}
				/>
				<p>
					<code>claude</code>, or an absolute path. A name is looked up in your login shell's PATH.
				</p>
			</TableListRow>
			<TableListRow label="CLAUDE_CONFIG_DIR">
				<input
					type="text"
					value={instance.configDir}
					placeholder="~/.claude"
					onChange={(e) => onChange({ configDir: e.target.value })}
				/>
				<p>The Claude configuration directory for this instance. Leave empty for Claude Code's default.</p>
			</TableListRow>
			<TableListRow label="Launch arguments">
				<input
					type="text"
					value={instance.args}
					placeholder="--model opus"
					onChange={(e) => onChange({ args: e.target.value })}
				/>
				<p>Added to the command as typed.</p>
			</TableListRow>
			<TableListRow label="Environment variables">
				{instance.env.map((variable, index) => (
					<div key={index} style={{ ...ROW, marginBottom: 8 }}>
						<input
							type="text"
							style={PAIR_INPUT}
							value={variable.name}
							placeholder="NAME"
							onChange={(e) => setVariable(index, { name: e.target.value })}
						/>
						<input
							type="text"
							style={PAIR_INPUT}
							value={variable.value}
							placeholder="value"
							onChange={(e) => setVariable(index, { value: e.target.value })}
						/>
						<TextButton
							privateOptions={{ padding: 'none' }}
							onClick={() => onChange({ env: instance.env.filter((_variable, i) => i !== index) })}
						>
							Remove
						</TextButton>
					</div>
				))}
				<div style={ROW}>
					<TextButton
						privateOptions={{ padding: 'none' }}
						onClick={() => onChange({ env: [...instance.env, { name: '', value: '' }] })}
					>
						Add variable
					</TextButton>
				</div>
				<p>Set for the Claude process only.</p>
			</TableListRow>
		</TableList>
	);
}
