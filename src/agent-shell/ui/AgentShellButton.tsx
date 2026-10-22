import * as React from 'react';
import { SiteShellIcon, TextButton } from '@getflywheel/local-components';

const { useState } = React;

type SiteProps = { id: string; name: string; [key: string]: any };

const BUTTON_WRAP: React.CSSProperties = { display: 'flex', alignItems: 'center', paddingRight: 20 };

export function AgentShellButton({ site, electron }: { site: SiteProps; electron: any }) {
	const [busy, setBusy] = useState(false);

	// One launch at a time; the main process reports launch failures as notifications.
	const onClick = async () => {
		setBusy(true);
		try {
			await electron.ipcRenderer.invoke('agent-tools:agent-shell-launch', site.id);
		} catch (err) {
			console.error('[Agent Tools] Agent Shell launch failed:', err);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div style={BUTTON_WRAP}>
			<TextButton leftIcon={SiteShellIcon} privateOptions={{ padding: 'none' }} disabled={busy} onClick={onClick}>
				{busy ? 'Opening…' : 'Agent Shell'}
			</TextButton>
		</div>
	);
}
