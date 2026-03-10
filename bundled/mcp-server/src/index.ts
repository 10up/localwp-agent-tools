#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// ── Import tool modules ────────────────────────────────────────────────
import {
  toolDefinitions as wpcliTools,
  handleTool as handleWpcliTool,
} from './tools/wpcli.js';
import {
  toolDefinitions as logTools,
  handleTool as handleLogTool,
} from './tools/logs.js';
import {
  toolDefinitions as configTools,
  handleTool as handleConfigTool,
} from './tools/config.js';
import {
  toolDefinitions as siteTools,
  handleTool as handleSiteTool,
} from './tools/site.js';
import {
  toolDefinitions as environmentTools,
  handleTool as handleEnvironmentTool,
} from './tools/environment.js';

// ── Aggregate all tools ────────────────────────────────────────────────
const allTools = [
  ...wpcliTools,
  ...logTools,
  ...configTools,
  ...siteTools,
  ...environmentTools,
];

// Map tool names to their handler modules
type ToolHandler = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ content: Array<{ type: string; text: string }> }>;

const toolHandlerMap: Record<string, ToolHandler> = {};

for (const tool of wpcliTools) {
  toolHandlerMap[tool.name] = handleWpcliTool;
}
for (const tool of logTools) {
  toolHandlerMap[tool.name] = handleLogTool;
}
for (const tool of configTools) {
  toolHandlerMap[tool.name] = handleConfigTool;
}
for (const tool of siteTools) {
  toolHandlerMap[tool.name] = handleSiteTool;
}
for (const tool of environmentTools) {
  toolHandlerMap[tool.name] = handleEnvironmentTool;
}

// ── Create MCP Server ──────────────────────────────────────────────────
const server = new Server(
  {
    name: 'localwp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// ── List tools handler ─────────────────────────────────────────────────
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: allTools,
  };
});

// ── Call tool handler ──────────────────────────────────────────────────
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  console.error(`[localwp] Tool called: ${name}`);

  const handler = toolHandlerMap[name];
  if (!handler) {
    return {
      content: [
        {
          type: 'text',
          text: `Unknown tool: ${name}. Available tools: ${allTools.map((t) => t.name).join(', ')}`,
        },
      ],
      isError: true,
    };
  }

  try {
    const result = await handler(name, (args ?? {}) as Record<string, unknown>);
    return result;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[localwp] Tool error (${name}): ${msg}`);
    return {
      content: [{ type: 'text', text: `Error executing ${name}: ${msg}` }],
      isError: true,
    };
  }
});

// ── Start the server ───────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[localwp] MCP server started on stdio');
}

main().catch((err) => {
  console.error('[localwp] Fatal error:', err);
  process.exit(1);
});
