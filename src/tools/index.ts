import { SiteConfig } from '../helpers/site-config';
import { toolDefinitions as wpcliTools, handleTool as handleWpcliTool } from './wpcli';
import { toolDefinitions as logTools, handleTool as handleLogTool } from './logs';
import { toolDefinitions as configTools, handleTool as handleConfigTool } from './config';
import { toolDefinitions as siteTools, handleTool as handleSiteTool } from './site';
import { toolDefinitions as environmentTools, handleTool as handleEnvironmentTool, LocalApi } from './environment';
import { toolDefinitions as previewTools, handleTool as handlePreviewTool } from './preview';
import { toolDefinitions as agentToolsTools, handleTool as handleAgentToolsTool } from './agent-tools';

export type {
	LocalApi,
	PreviewInfo,
	CreateSiteOptions,
	CreateSiteResult,
	MultisiteMode,
	AgentName,
	ServiceVersion,
	ServiceVersions,
	AgentToolsSiteStatus,
	EnableAgentToolsOptions,
} from './environment';

export type ToolResult = { content: Array<{ type: string; text: string }> };

/**
 * Tools that operate on one specific site and need its SiteConfig.
 * Only reachable through a per-site endpoint (/sites/{siteId}/mcp).
 */
const siteScopedTools = [...wpcliTools, ...logTools, ...configTools, ...siteTools];

/**
 * Site-bound tools (WP-CLI, logs, config, site info) resolve against the
 * endpoint's site by default, but accept an optional siteId so a session
 * connected to the primary site can operate on another REGISTERED site —
 * the preview-environment flow: spin up a preview via preview_start, then
 * run wp_cli / read logs against it without reconnecting the MCP client.
 * Environment tools (site_start etc.) are excluded: they route their own
 * siteId against ALL Local sites, registered or not.
 */
export const crossSiteToolNames = new Set(siteScopedTools.map((t) => t.name));

const SITE_ID_PARAM = {
	type: 'string',
	description:
		'Optional Local site ID to run this against a different registered site — for example a preview created ' +
		"by preview_start. Defaults to this endpoint's site.",
};

function withSiteIdParam<T extends { name: string; inputSchema: { properties?: Record<string, unknown> } }>(
	tool: T,
): T {
	if (!crossSiteToolNames.has(tool.name)) return tool;
	if (tool.inputSchema.properties?.siteId) return tool;
	return {
		...tool,
		inputSchema: {
			...tool.inputSchema,
			properties: { ...tool.inputSchema.properties, siteId: SITE_ID_PARAM },
		},
	};
}

/**
 * Tools that address Local itself, or address a site by an explicit siteId argument.
 * Reachable from both the global endpoint and any per-site endpoint. The preview
 * tools belong here: preview_start takes an optional siteId (required on the
 * global endpoint), and preview_list and preview_destroy address Local itself.
 */
const globalTools = [...environmentTools, ...previewTools, ...agentToolsTools];

/** Full surface, served on a per-site endpoint. */
export const allToolDefinitions = [...siteScopedTools, ...globalTools].map(withSiteIdParam);

/** Subset served on the global endpoint (/sites/mcp), where no site is bound. */
export const globalToolDefinitions = [...globalTools];

/** Names of the tools that cannot run without a bound site. */
export const siteScopedToolNames = new Set(siteScopedTools.map((t) => t.name));

// Unified handler type: (name, args, config, localApi) => ToolResult
type ToolHandler = (
	name: string,
	args: Record<string, unknown>,
	config: SiteConfig | null,
	localApi: LocalApi,
) => Promise<ToolResult>;

// Build handler map — routes tool name to the correct module
const toolHandlerMap: Record<string, ToolHandler> = {};

// Site-scoped modules are only ever reached with a non-null config; handleToolCall
// rejects the call before dispatch otherwise, so the assertions below hold.
for (const tool of wpcliTools) {
	toolHandlerMap[tool.name] = (name, args, config, _localApi) => handleWpcliTool(name, args, config as SiteConfig);
}
for (const tool of logTools) {
	toolHandlerMap[tool.name] = (name, args, config, _localApi) => handleLogTool(name, args, config as SiteConfig);
}
for (const tool of configTools) {
	toolHandlerMap[tool.name] = (name, args, config, _localApi) => handleConfigTool(name, args, config as SiteConfig);
}
for (const tool of siteTools) {
	toolHandlerMap[tool.name] = (name, args, config, _localApi) => handleSiteTool(name, args, config as SiteConfig);
}
for (const tool of environmentTools) {
	toolHandlerMap[tool.name] = (name, args, config, localApi) => handleEnvironmentTool(name, args, config, localApi);
}
for (const tool of previewTools) {
	toolHandlerMap[tool.name] = (name, args, config, localApi) => handlePreviewTool(name, args, config, localApi);
}
for (const tool of agentToolsTools) {
	toolHandlerMap[tool.name] = (name, args, _config, localApi) => handleAgentToolsTool(name, args, localApi);
}

/**
 * Handle a tool call, routing to the correct module based on tool name.
 *
 * `config` is null for sessions on the global endpoint, which has no bound site.
 * Site-scoped tools are not advertised there, but guard against them being called
 * anyway rather than dispatching with a missing config.
 */
export async function handleToolCall(
	name: string,
	args: Record<string, unknown>,
	config: SiteConfig | null,
	localApi: LocalApi,
): Promise<ToolResult> {
	const available = config ? allToolDefinitions : globalToolDefinitions;
	const handler = toolHandlerMap[name];

	if (!handler) {
		return {
			content: [
				{
					type: 'text',
					text: `Unknown tool: ${name}. Available tools: ${available.map((t) => t.name).join(', ')}`,
				},
			],
		};
	}

	if (!config && siteScopedToolNames.has(name)) {
		return {
			content: [
				{
					type: 'text',
					text:
						`Error: ${name} operates on a single site and is not available on the global endpoint. ` +
						"Connect to that site's own endpoint (/sites/{siteId}/mcp) instead — " +
						'agent_tools_status reports the URL for each enabled site, and enable_agent_tools ' +
						'creates one for a site that is not enabled yet.',
				},
			],
		};
	}

	return handler(name, args, config, localApi);
}
