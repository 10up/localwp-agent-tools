import { SiteConfig } from '../helpers/site-config';
import { toolDefinitions as wpcliTools, handleTool as handleWpcliTool } from './wpcli';
import { toolDefinitions as logTools, handleTool as handleLogTool } from './logs';
import { toolDefinitions as configTools, handleTool as handleConfigTool } from './config';
import { toolDefinitions as siteTools, handleTool as handleSiteTool } from './site';
import { toolDefinitions as environmentTools, handleTool as handleEnvironmentTool, LocalApi } from './environment';
import { toolDefinitions as previewTools, handleTool as handlePreviewTool } from './preview';

export type { LocalApi, PreviewInfo } from './environment';

export type ToolResult = { content: Array<{ type: string; text: string }> };

/**
 * Site-bound tools (WP-CLI, logs, config, site info) resolve against the
 * endpoint's site by default, but accept an optional siteId so a session
 * connected to the primary site can operate on another REGISTERED site —
 * the preview-environment flow: spin up a preview via preview_start, then
 * run wp_cli / read logs against it without reconnecting the MCP client.
 * Environment tools (site_start etc.) are excluded: they route their own
 * siteId against ALL Local sites, registered or not.
 */
export const crossSiteToolNames = new Set(
	[...wpcliTools, ...logTools, ...configTools, ...siteTools].map((t) => t.name),
);

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

// All tool definitions aggregated
export const allToolDefinitions = [
	...wpcliTools,
	...logTools,
	...configTools,
	...siteTools,
	...environmentTools,
	...previewTools,
].map(withSiteIdParam);

// Unified handler type: (name, args, config, localApi) => ToolResult
type ToolHandler = (
	name: string,
	args: Record<string, unknown>,
	config: SiteConfig,
	localApi: LocalApi,
) => Promise<ToolResult>;

// Build handler map — routes tool name to the correct module
const toolHandlerMap: Record<string, ToolHandler> = {};

for (const tool of wpcliTools) {
	toolHandlerMap[tool.name] = (name, args, config, _localApi) => handleWpcliTool(name, args, config);
}
for (const tool of logTools) {
	toolHandlerMap[tool.name] = (name, args, config, _localApi) => handleLogTool(name, args, config);
}
for (const tool of configTools) {
	toolHandlerMap[tool.name] = (name, args, config, _localApi) => handleConfigTool(name, args, config);
}
for (const tool of siteTools) {
	toolHandlerMap[tool.name] = (name, args, config, _localApi) => handleSiteTool(name, args, config);
}
for (const tool of environmentTools) {
	toolHandlerMap[tool.name] = (name, args, config, localApi) => handleEnvironmentTool(name, args, config, localApi);
}
for (const tool of previewTools) {
	toolHandlerMap[tool.name] = (name, args, config, localApi) => handlePreviewTool(name, args, config, localApi);
}

/**
 * Handle a tool call, routing to the correct module based on tool name.
 */
export async function handleToolCall(
	name: string,
	args: Record<string, unknown>,
	config: SiteConfig,
	localApi: LocalApi,
): Promise<ToolResult> {
	const handler = toolHandlerMap[name];
	if (!handler) {
		return {
			content: [
				{
					type: 'text',
					text: `Unknown tool: ${name}. Available tools: ${allToolDefinitions.map((t) => t.name).join(', ')}`,
				},
			],
		};
	}
	return handler(name, args, config, localApi);
}
