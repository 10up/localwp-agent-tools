import * as React from 'react';
import { FlySelect } from '@getflywheel/local-components';
import type { Settings, SiteOverride } from '../settings';
import { agentLabel, agentOptions } from './labels';

const { useEffect, useState } = React;

type SiteProps = { id: string; name: string; [key: string]: any };

type ShellSettingProps = {
	site: SiteProps;
	electron: any;
	labelStyle: React.CSSProperties;
	helperStyle: React.CSSProperties;
};

/** The site's choice of what the Agent Shell button starts, shown in the Agent Tools panel. */
export function ShellSetting({ site, electron, labelStyle, helperStyle }: ShellSettingProps) {
	const ipc = electron.ipcRenderer;
	const [settings, setSettings] = useState<Settings | null>(null);
	const [override, setOverride] = useState<SiteOverride>('default');
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let active = true;
		Promise.all([
			ipc.invoke('agent-tools:agent-shell-get-settings'),
			ipc.invoke('agent-tools:agent-shell-get-site-agent', site.id),
		])
			.then(([loaded, current]: [Settings, SiteOverride]) => {
				if (!active) return;
				setSettings(loaded);
				setOverride(current);
			})
			.catch(
				(err: unknown) => active && setError(`The Agent Shell settings could not be loaded. ${String(err)}`),
			);
		return () => {
			active = false;
		};
	}, [site.id]);

	if (!settings) {
		return <p style={helperStyle}>{error ?? 'Loading…'}</p>;
	}

	const options: Record<string, string> = {
		default: `Use default: ${agentLabel(settings, settings.defaultOpen)}`,
		...agentOptions(settings),
	};

	// An override naming a deleted instance shows as the default it falls back to.
	const value = override in options ? override : 'default';

	const onChange = async (next: SiteOverride) => {
		const previous = override;
		setOverride(next);
		setError(null);
		const result = await ipc
			.invoke('agent-tools:agent-shell-set-site-agent', site.id, next)
			.catch((): null => null);
		if (!result?.ok) {
			setOverride(previous);
			setError('The choice could not be saved.');
		}
	};

	return (
		<>
			<div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
				<span style={labelStyle}>Shell</span>
				<FlySelect value={value} options={options} onChange={onChange} />
			</div>
			<p style={helperStyle}>
				What the Agent Shell button starts for this site. Set where it opens and the Claude instances in
				Preferences › Agent Tools.
			</p>
			{error && <p style={{ ...helperStyle, color: '#f59e0b' }}>{error}</p>}
		</>
	);
}
