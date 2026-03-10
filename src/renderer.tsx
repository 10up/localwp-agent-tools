import React, { useState, useEffect, useCallback } from 'react';
import { TextButton, TableListRow, FlySelect, Divider } from '@getflywheel/local-components';
import { AddonRendererContext } from '@getflywheel/local/renderer';

type AgentTarget = 'claude' | 'cursor' | 'windsurf' | 'vscode';

const AGENT_OPTIONS: { value: AgentTarget; label: string }[] = [
	{ value: 'claude', label: 'Claude Code' },
	{ value: 'cursor', label: 'Cursor' },
	{ value: 'windsurf', label: 'Windsurf' },
	{ value: 'vscode', label: 'VS Code Copilot' },
];

const AGENT_HINTS: Record<AgentTarget, string> = {
	claude: 'Restart Claude Code or start a new session to load the MCP server.',
	cursor: 'Enable the MCP in Cursor Settings > Tools & MCP — find "local-wp" and toggle it on.',
	windsurf: 'Enable the MCP in Windsurf Settings > Cascade > MCP Servers — find "local-wp" and toggle it on.',
	vscode: 'Open the Command Palette and run "MCP: List Servers" to verify the server is loaded.',
};

interface AgentToolsStatus {
	enabled: boolean;
	configExists: boolean;
	mcpServerInstalled: boolean;
	sitePath: string;
	projectDir: string;
	agents: AgentTarget[];
}

interface SiteProps {
	id: string;
	name: string;
	[key: string]: any;
}

const INSTALL_LOCATION_OPTIONS: { [value: string]: string } = {
	'': 'Site Root',
	'app/public': 'WordPress Root (app/public)',
	'app/public/wp-content': 'wp-content',
};

const checkboxStyle: React.CSSProperties = {
	display: 'flex',
	alignItems: 'center',
	gap: 6,
	fontSize: 12,
	color: '#ccc',
	cursor: 'pointer',
	marginBottom: 2,
};

const sectionHeadingStyle: React.CSSProperties = {
	fontSize: 11,
	fontWeight: 600,
	textTransform: 'uppercase',
	letterSpacing: '0.05em',
	color: '#888',
	margin: '0 0 6px 0',
};

const helperTextStyle: React.CSSProperties = {
	fontSize: 11,
	color: '#888',
	margin: '2px 0 0 0',
};

function AgentToolsPanel({ site, electron }: { site: SiteProps; electron: any }) {
	const [status, setStatus] = useState<AgentToolsStatus | null>(null);
	const [busy, setBusy] = useState(false);
	const [projectDir, setProjectDir] = useState('');
	const [selectedAgents, setSelectedAgents] = useState<AgentTarget[]>(['claude']);

	const fetchStatus = useCallback(async () => {
		try {
			const result = await electron.ipcRenderer.invoke('agent-tools:get-status', site.id);
			setStatus(result);
			if (result.projectDir !== undefined) {
				setProjectDir(result.projectDir);
			}
			if (result.agents && result.agents.length > 0) {
				setSelectedAgents(result.agents);
			}
		} catch {
			// ignore
		}
	}, [site.id, electron]);

	useEffect(() => { fetchStatus(); }, [fetchStatus]);

	const isEnabled = status?.enabled || false;

	const toggleAgent = (agent: AgentTarget) => {
		setSelectedAgents(prev => {
			if (prev.includes(agent)) {
				return prev.filter(a => a !== agent);
			}
			return [...prev, agent];
		});
	};

	const handleEnable = async (event: any) => {
		if (selectedAgents.length === 0) return;
		event.target.setAttribute('disabled', 'true');
		setBusy(true);
		try {
			await electron.ipcRenderer.invoke('agent-tools:enable-site', site.id, projectDir, selectedAgents);
			await fetchStatus();
		} finally {
			setBusy(false);
			event.target.removeAttribute('disabled');
		}
	};

	const handleDisable = async (event: any) => {
		event.target.setAttribute('disabled', 'true');
		setBusy(true);
		try {
			await electron.ipcRenderer.invoke('agent-tools:disable-site', site.id);
			await fetchStatus();
		} finally {
			setBusy(false);
			event.target.removeAttribute('disabled');
		}
	};

	const handleRegenerate = async (event: any) => {
		event.target.setAttribute('disabled', 'true');
		try {
			await electron.ipcRenderer.invoke('agent-tools:regenerate-config', site.id);
			await fetchStatus();
		} finally {
			event.target.removeAttribute('disabled');
		}
	};

	const handleChangeDir = async () => {
		setBusy(true);
		try {
			await electron.ipcRenderer.invoke('agent-tools:change-project-dir', site.id, projectDir);
			await fetchStatus();
		} finally {
			setBusy(false);
		}
	};

	// ── Not yet enabled ──────────────────────────────────────────────────
	if (!isEnabled) {
		return (
			<>
				<div style={{ marginBottom: 8 }}>
					<p style={sectionHeadingStyle}>Coding Agents</p>
					{AGENT_OPTIONS.map(opt => (
						<label key={opt.value} style={checkboxStyle}>
							<input
								type="checkbox"
								checked={selectedAgents.includes(opt.value)}
								onChange={() => toggleAgent(opt.value)}
							/>
							{opt.label}
						</label>
					))}
					{selectedAgents.length === 0 && (
						<p style={{ ...helperTextStyle, color: '#f59e0b' }}>
							Select at least one coding agent.
						</p>
					)}
				</div>

				<div style={{ marginBottom: 8 }}>
					<div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
						<span style={{ fontSize: 12, color: '#999', whiteSpace: 'nowrap' }}>Install location</span>
						<FlySelect
							value={projectDir}
							onChange={(value: string) => setProjectDir(value)}
							options={INSTALL_LOCATION_OPTIONS}
						/>
					</div>
					<p style={helperTextStyle}>
						Where MCP config and project context files are placed within the site.
					</p>
				</div>

				<TextButton
					style={{ paddingLeft: 0 }}
					onClick={handleEnable}
				>
					{busy ? 'Setting up...' : 'Enable'}
				</TextButton>

				<p style={helperTextStyle}>
					Installs an MCP server and project context for AI-powered WordPress development.
				</p>
			</>
		);
	}

	// ── Enabled ──────────────────────────────────────────────────────────

	const agentsChanged = status?.agents
		? (selectedAgents.length !== status.agents.length || selectedAgents.some(a => !status.agents.includes(a)))
		: false;

	const handleUpdateAgents = async () => {
		if (selectedAgents.length === 0) return;
		setBusy(true);
		try {
			await electron.ipcRenderer.invoke('agent-tools:update-agents', site.id, selectedAgents);
			await fetchStatus();
		} finally {
			setBusy(false);
		}
	};

	return (
		<>
			{/* ── Settings ───────────────────────────────────── */}
			<p style={sectionHeadingStyle}>Settings</p>

			<div style={{ marginBottom: 8 }}>
				<label style={{ fontSize: 12, color: '#999', display: 'block', marginBottom: 3 }}>
					Coding agents
				</label>
				{AGENT_OPTIONS.map(opt => (
					<label key={opt.value} style={checkboxStyle}>
						<input
							type="checkbox"
							checked={selectedAgents.includes(opt.value)}
							onChange={() => toggleAgent(opt.value)}
						/>
						{opt.label}
					</label>
				))}
				{agentsChanged && selectedAgents.length > 0 && (
					<TextButton
						style={{ paddingLeft: 0, fontSize: 12, marginTop: 2 }}
						onClick={handleUpdateAgents}
					>
						{busy ? 'Updating...' : 'Update'}
					</TextButton>
				)}
				{selectedAgents.length === 0 && (
					<p style={{ ...helperTextStyle, color: '#f59e0b' }}>
						Select at least one coding agent.
					</p>
				)}
			</div>

			<div style={{ marginBottom: 8 }}>
				<div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
					<span style={{ fontSize: 12, color: '#999', whiteSpace: 'nowrap' }}>Install location</span>
					<FlySelect
						value={projectDir}
						onChange={(value: string) => setProjectDir(value)}
						options={INSTALL_LOCATION_OPTIONS}
					/>
				</div>
				{projectDir !== (status?.projectDir || '') && (
					<TextButton
						style={{ paddingLeft: 0, fontSize: 12 }}
						onClick={handleChangeDir}
					>
						{busy ? 'Moving...' : 'Apply'}
					</TextButton>
				)}
				<p style={helperTextStyle}>
					Where MCP config and project context files are placed within the site.
				</p>
			</div>

			{/* ── Next Steps ─────────────────────────────────── */}
			<Divider marginSize="s" />
			<p style={sectionHeadingStyle}>Next Steps</p>

			<div style={{ marginBottom: 8 }}>
				{(status?.agents || []).map(agent => (
					<p key={agent} style={{ margin: '3px 0', fontSize: 11, color: '#aaa' }}>
						<strong style={{ color: '#ccc' }}>{AGENT_OPTIONS.find(o => o.value === agent)?.label}:</strong>{' '}
						{AGENT_HINTS[agent]}
					</p>
				))}
			</div>

			{/* ── Actions ────────────────────────────────────── */}
			<Divider marginSize="s" />
			<p style={sectionHeadingStyle}>Actions</p>

			<TextButton
				style={{ paddingLeft: 0 }}
				onClick={handleRegenerate}
			>
				Regenerate Config
			</TextButton>
			<p style={helperTextStyle}>
				Re-generates MCP config and project context. Useful if the agent is having trouble using the tools.
			</p>

			<TextButton
				style={{ paddingLeft: 0 }}
				onClick={handleDisable}
			>
				Disable
			</TextButton>
			<p style={helperTextStyle}>
				Removes Agent Tools config files from this site.
			</p>
		</>
	);
}

export default function (context: AddonRendererContext): void {
	const { hooks, electron } = context;

	hooks.addContent('siteInfoUtilities', (site: SiteProps) => {
		return (
			<TableListRow key="agent-tools" label="Agent Tools">
				<AgentToolsPanel site={site} electron={electron} />
			</TableListRow>
		);
	});
}
