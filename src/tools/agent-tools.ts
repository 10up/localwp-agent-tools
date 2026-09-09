import * as path from 'path';
import { AGENT_NAMES, AgentName, LocalApi } from './environment';

// ── Tool Definitions ───────────────────────────────────────────────────
export const toolDefinitions = [
	{
		name: 'enable_agent_tools',
		description:
			'Enable Agent Tools on a Local site — registers it with this MCP server and writes its MCP ' +
			'config and project context files for the chosen agents. Same effect as clicking Enable in ' +
			"Local's UI. Returns the site's own MCP endpoint URL, which is the endpoint to use for " +
			'site-scoped tools like wp_cli and the log readers.',
		inputSchema: {
			type: 'object' as const,
			properties: {
				siteId: {
					type: 'string',
					description: 'The Local site ID. Use list_sites or agent_tools_status to find it.',
				},
				agents: {
					type: 'array',
					items: { type: 'string', enum: [...AGENT_NAMES] },
					description: 'Which agents to configure. Optional — defaults to ["claude"].',
				},
				projectDir: {
					type: 'string',
					description:
						'Subdirectory of the site folder to write the agent config into, relative to the ' +
						'site root (e.g. "app/public/wp-content/themes/my-theme"). Optional — defaults to ' +
						'the site root. Must stay inside the site folder.',
				},
			},
			required: ['siteId'],
		},
	},
	{
		name: 'disable_agent_tools',
		description:
			'Disable Agent Tools on a Local site — unregisters it from this MCP server, closes its open ' +
			'MCP sessions, and removes the MCP config entry and project context it wrote. Leaves the site ' +
			'itself untouched. No-op if the site was not enabled.',
		inputSchema: {
			type: 'object' as const,
			properties: {
				siteId: {
					type: 'string',
					description: 'The Local site ID. Use list_sites or agent_tools_status to find it.',
				},
			},
			required: ['siteId'],
		},
	},
	{
		name: 'agent_tools_status',
		description:
			'Report Agent Tools state for Local sites: whether it is enabled, which agents are configured, ' +
			'the project directory its config was written to, whether the site is currently registered with ' +
			"this MCP server, and the site's MCP endpoint URL. Omit siteId to report on every site.",
		inputSchema: {
			type: 'object' as const,
			properties: {
				siteId: {
					type: 'string',
					description: 'Optional — restrict the report to a single site.',
				},
			},
		},
	},
];

// ── Argument Parsing ───────────────────────────────────────────────────

/** Narrow a required siteId argument. Returns the id, or an error string. */
export function parseSiteIdArg(args: Record<string, unknown>): string | { error: string } {
	const siteId = args.siteId;
	if (typeof siteId !== 'string' || !siteId.trim()) {
		return { error: 'Error: "siteId" is required and must be a non-empty string.' };
	}
	return siteId.trim();
}

/**
 * Narrow the optional agents argument.
 * Returns undefined when not provided, so the caller falls back to its default.
 */
export function parseAgentsArg(args: Record<string, unknown>): AgentName[] | undefined | { error: string } {
	const value = args.agents;
	if (value === undefined || value === null) return undefined;
	if (!Array.isArray(value) || value.length === 0) {
		return { error: 'Error: "agents" must be a non-empty array when provided.' };
	}
	const invalid = value.filter((a) => typeof a !== 'string' || !AGENT_NAMES.includes(a as AgentName));
	if (invalid.length) {
		return {
			error: `Error: unknown agent(s): ${invalid.join(', ')}. Valid agents: ${AGENT_NAMES.join(', ')}.`,
		};
	}
	return value as AgentName[];
}

/**
 * Narrow the optional projectDir argument.
 *
 * This lands in path.join(sitePath, projectDir) on the main process side, so an
 * absolute path or a `..` segment would write agent config outside the site
 * folder. Reject both rather than trusting the caller.
 */
export function parseProjectDirArg(args: Record<string, unknown>): string | { error: string } {
	const value = args.projectDir;
	if (value === undefined || value === null) return '';
	if (typeof value !== 'string') {
		return { error: 'Error: "projectDir" must be a string when provided.' };
	}

	const trimmed = value.trim();
	if (!trimmed) return '';

	if (path.isAbsolute(trimmed) || /^[a-zA-Z]:[\\/]/.test(trimmed)) {
		return { error: 'Error: "projectDir" must be relative to the site folder, not an absolute path.' };
	}

	const normalized = path.normalize(trimmed).replace(/[\\/]+$/, '');
	const segments = normalized.split(/[\\/]/);
	if (segments.includes('..')) {
		return { error: 'Error: "projectDir" must stay inside the site folder.' };
	}

	return normalized === '.' ? '' : normalized;
}

// ── Tool Handler ───────────────────────────────────────────────────────
export async function handleTool(
	name: string,
	args: Record<string, unknown>,
	localApi: LocalApi,
): Promise<{ content: Array<{ type: string; text: string }> }> {
	try {
		switch (name) {
			case 'enable_agent_tools':
				return await handleEnable(args, localApi);
			case 'disable_agent_tools':
				return await handleDisable(args, localApi);
			case 'agent_tools_status':
				return await handleStatus(args, localApi);
			default:
				return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
		}
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return { content: [{ type: 'text', text: `Agent Tools Error: ${msg}` }] };
	}
}

function isError(value: unknown): value is { error: string } {
	return typeof value === 'object' && value !== null && 'error' in value;
}

async function handleEnable(
	args: Record<string, unknown>,
	localApi: LocalApi,
): Promise<{ content: Array<{ type: string; text: string }> }> {
	const siteId = parseSiteIdArg(args);
	if (isError(siteId)) return { content: [{ type: 'text', text: siteId.error }] };

	const agents = parseAgentsArg(args);
	if (isError(agents)) return { content: [{ type: 'text', text: agents.error }] };

	const projectDir = parseProjectDirArg(args);
	if (isError(projectDir)) return { content: [{ type: 'text', text: projectDir.error }] };

	try {
		const status = await localApi.enableAgentTools({ siteId, agents, projectDir });
		return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return { content: [{ type: 'text', text: `Failed to enable Agent Tools: ${msg}` }] };
	}
}

async function handleDisable(
	args: Record<string, unknown>,
	localApi: LocalApi,
): Promise<{ content: Array<{ type: string; text: string }> }> {
	const siteId = parseSiteIdArg(args);
	if (isError(siteId)) return { content: [{ type: 'text', text: siteId.error }] };

	try {
		const status = await localApi.disableAgentTools(siteId);
		return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return { content: [{ type: 'text', text: `Failed to disable Agent Tools: ${msg}` }] };
	}
}

async function handleStatus(
	args: Record<string, unknown>,
	localApi: LocalApi,
): Promise<{ content: Array<{ type: string; text: string }> }> {
	let siteId: string | undefined;
	if (args.siteId !== undefined && args.siteId !== null) {
		const parsed = parseSiteIdArg(args);
		if (isError(parsed)) return { content: [{ type: 'text', text: parsed.error }] };
		siteId = parsed;
	}

	try {
		const status = await localApi.getAgentToolsStatus(siteId);
		return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return { content: [{ type: 'text', text: `Failed to read Agent Tools status: ${msg}` }] };
	}
}
