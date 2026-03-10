# LocalWP Agent Tools

A Local add-on that provides an MCP server, skills, and project context for AI-powered WordPress development. Works with Claude Code, Cursor, Windsurf, VS Code Copilot, and any MCP client.

## What It Does

When you click "Enable" on a site in Local, the add-on:

1. **Registers the site with the MCP server** — a single HTTP server running in Local's main process that gives AI tools access to WP-CLI, error logs, configuration, and site management
2. **Writes MCP config** (`.mcp.json`, `.cursor/mcp.json`, etc.) — auto-configured with the correct HTTP endpoint for each agent
3. **Generates project context** (`CLAUDE.md`, `.cursorrules`, etc.) — site context including PHP/MySQL versions, active plugins, theme, and file structure
4. **Copies WordPress skills** to `.claude/skills/` — debugging and database exploration workflows (Claude Code only)
5. **Updates `.gitignore`** — so generated files aren't committed

Then open the site folder in your AI tool of choice and you're ready to go.

## Architecture

The MCP server runs as a single HTTP server inside Local's Electron main process — no separate Node.js processes per site. Each site gets its own endpoint:

```
http://localhost:{port}/sites/{siteId}/mcp
```

The server uses the MCP Streamable HTTP transport. The port is stable across restarts (persisted at `~/.local-agent-tools/port`, default 24842).

Sites remain registered even when stopped, so the MCP endpoint is always reachable. Tools that need running services (WP-CLI, database) return appropriate errors; file-based tools (config, logs, site info) work regardless. Config is refreshed on each tool call, so starting a site automatically makes database tools work without reconnecting.

## Supported Agents

| Agent | MCP Config | Context File |
|-------|-----------|--------------|
| Claude Code | `.mcp.json` | `CLAUDE.md` |
| Cursor | `.cursor/mcp.json` | `.cursorrules` |
| Windsurf | `.windsurf/mcp.json` | `.windsurfrules` |
| VS Code Copilot | `.vscode/mcp.json` | `.github/copilot-instructions.md` |

## MCP Tools (12 total)

| Category | Tools | Description |
|----------|-------|-------------|
| **WP-CLI** | `wp_cli` | Run any WP-CLI command (database queries, imports, exports, search-replace, plugin/theme management, etc.) |
| **Logs** | `read_error_log` | Read and parse the PHP error log |
| | `read_access_log` | Read the nginx access log |
| | `wp_debug_toggle` | Enable/disable WP_DEBUG, WP_DEBUG_LOG, and SCRIPT_DEBUG |
| **Config** | `read_wp_config` | Parse wp-config.php constants and table prefix |
| | `edit_wp_config` | Add or modify a wp-config.php constant (with backup) |
| **Site** | `get_site_info` | Paths, URLs, database config, PHP/WP versions, active plugins and theme |
| | `site_health_check` | Database connectivity, file permissions, WP_DEBUG status, log sizes, PHP version |
| **Environment** | `site_start` | Start a site's services (PHP, MySQL, web server) |
| | `site_stop` | Stop a site's services |
| | `site_restart` | Restart a site's services |
| | `site_status` | Get current status of a site |
| | `list_sites` | List all Local sites with status |

## Skills (Claude Code only)

- **wp-debugger** — Systematic troubleshooting for errors, white screens, plugin conflicts, slow pages
- **wp-db-explorer** — Natural language to SQL queries against the WordPress database

## Installation

### From Source

```bash
git clone <repo-url> agent-tools
cd agent-tools
npm install --legacy-peer-deps
npm run build
```

Copy the built add-on to Local's add-ons directory:

```bash
# macOS
cp -r . ~/Library/Application\ Support/Local/addons/agent-tools/

# Install production dependencies in the installed location
cd ~/Library/Application\ Support/Local/addons/agent-tools/
npm install --production --ignore-scripts

# Then restart Local
```

## Development

```bash
# Build the add-on
npm run build

# Watch for changes
npm run watch
```

After building, sync to the installed add-on:

```bash
cp -R lib/* ~/Library/Application\ Support/Local/addons/agent-tools/lib/
```

Then restart Local to pick up changes.

## Project Structure

```
agent-tools/
├── src/                        # Add-on source (TypeScript)
│   ├── main.ts                 # Main process — lifecycle hooks, IPC, MCP server startup
│   ├── renderer.tsx            # Renderer process — React UI
│   ├── mcp-server.ts           # HTTP MCP server — session management, Streamable HTTP transport
│   ├── helpers/
│   │   ├── site-config.ts      # SiteConfig type and SiteConfigRegistry
│   │   ├── paths.ts            # Platform-specific binary resolution (PHP, MySQL, WP-CLI)
│   │   └── port.ts             # Stable port allocation with file persistence
│   └── tools/                  # MCP tool implementations
│       ├── index.ts            # Aggregates definitions, routes handleToolCall()
│       ├── wpcli.ts            # wp_cli
│       ├── logs.ts             # read_error_log, read_access_log, wp_debug_toggle
│       ├── config.ts           # read_wp_config, edit_wp_config
│       ├── site.ts             # get_site_info, site_health_check
│       └── environment.ts      # site_start, site_stop, site_restart, site_status, list_sites
├── bundled/
│   └── skills/                 # Claude Code skills
│       ├── wp-debugger/
│       └── wp-db-explorer/
├── templates/                  # Config templates
│   ├── claude-md.hbs           # CLAUDE.md Handlebars template
│   └── gitignore-additions.txt
├── lib/                        # Compiled output
├── package.json
└── tsconfig.json
```

## Requirements

- Local 9.0+
- An MCP-compatible AI tool (Claude Code, Cursor, Windsurf, VS Code Copilot, etc.)

## Platform Support

macOS (darwin-arm64 and darwin-x64), Windows, and Linux.

## License

MIT
