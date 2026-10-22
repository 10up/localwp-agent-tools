import * as React from 'react';
import { AgentShellButton } from './ui/AgentShellButton';
import { getDraft } from './ui/draft';
import { PreferencesPane } from './ui/PreferencesPane';

type SiteProps = { id: string; name: string; [key: string]: any };

/** Adds the Agent Shell button to the site header and its Preferences pane. */
export function registerAgentShellUi(context: any): void {
	const { hooks, electron } = context;

	hooks.addContent('SiteInfo_Top_TopRight', (site: SiteProps) => (
		<AgentShellButton key={`agent-shell-${site.id}`} site={site} electron={electron} />
	));

	hooks.addFilter('preferencesMenuItems', (items: any[]) => [
		...items,
		{
			path: 'agent-tools',
			displayName: 'Agent Tools',
			sections: PreferencesPane,
			sectionsProps: { electron },
			onApply: () => {
				const draft = getDraft();
				if (!draft) return;

				electron.ipcRenderer.invoke('agent-tools:agent-shell-save-settings', draft).catch((err: unknown) => {
					console.error('[Agent Tools] Saving the Agent Shell settings failed:', err);
					window.alert(`The Agent Shell settings could not be saved. ${String(err)}`);
				});
			},
		},
	]);
}
