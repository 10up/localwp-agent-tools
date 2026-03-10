import { SiteConfig } from '../helpers/site-config';
import {
	toolDefinitions as wpcliTools,
	handleTool as handleWpcliTool,
} from './wpcli';
import {
	toolDefinitions as logTools,
	handleTool as handleLogTool,
} from './logs';
import {
	toolDefinitions as configTools,
	handleTool as handleConfigTool,
} from './config';
import {
	toolDefinitions as siteTools,
	handleTool as handleSiteTool,
} from './site';
import {
	toolDefinitions as environmentTools,
	handleTool as handleEnvironmentTool,
	LocalApi,
} from './environment';

export type { LocalApi } from './environment';

export type ToolResult = { content: Array<{ type: string; text: string }> };

// All tool definitions aggregated
export const allToolDefinitions = [
	...wpcliTools,
	...logTools,
	...configTools,
	...siteTools,
	...environmentTools,
];

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
			content: [{
				type: 'text',
				text: `Unknown tool: ${name}. Available tools: ${allToolDefinitions.map(t => t.name).join(', ')}`,
			}],
		};
	}
	return handler(name, args, config, localApi);
}
