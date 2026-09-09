# LocalWP Agent Tools

[![Support Level](https://img.shields.io/badge/support-active-green.svg)](#support-level) [![CI](https://github.com/10up/localwp-agent-tools/actions/workflows/ci.yml/badge.svg)](https://github.com/10up/localwp-agent-tools/actions/workflows/ci.yml) [![GPL-2.0-or-later License](https://img.shields.io/github/license/10up/localwp-agent-tools.svg)](https://github.com/10up/localwp-agent-tools/blob/main/LICENSE.md)

> A [Local](https://localwp.com/) add-on that provides an MCP server and project context for AI-powered WordPress development. Works with Claude Code, Cursor, Windsurf, VS Code Copilot, and any MCP client.

## What It Does

When you click "Enable" on a site in Local, the add-on:

1. **Registers the site with the MCP server** — a single HTTP server running in Local's main process that gives AI tools access to WP-CLI, error logs, configuration, and site management
2. **Writes MCP config** (`.mcp.json`, `.cursor/mcp.json`, etc.) — auto-configured with the correct HTTP endpoint for each agent
3. **Generates project context** (`CLAUDE.md`, `.cursorrules`, etc.) — site context including PHP/MySQL versions, active plugins, theme, and file structure
4. **Updates `.gitignore`** — so generated files aren't committed

Then open the site folder in your AI tool of choice and you're ready to go.

## Architecture

The MCP server runs as a single HTTP server inside Local's Electron main process — no separate Node.js processes per site. It serves two kinds of endpoint:

```
http://localhost:{port}/sites/mcp             # global — all of Local
http://localhost:{port}/sites/{siteId}/mcp    # one specific site
```

The server uses the MCP Streamable HTTP transport. The port is stable across restarts (persisted at `~/.local-agent-tools/port`, default 24842).

Sites remain registered even when stopped, so the MCP endpoint is always reachable. Tools that need running services (WP-CLI, database) return appropriate errors; file-based tools (config, logs, site info) work regardless. Config is refreshed on each tool call, so starting a site automatically makes database tools work without reconnecting.

### The global endpoint

`/sites/mcp` is not tied to any site, so you configure it once and use it from anywhere — no need to open a particular site folder first. It serves the tools that address Local itself (`list_sites`, `create_site`, `list_service_versions`), the site lifecycle tools (`site_start` and friends, which take an explicit `siteId`), and the tools that turn Agent Tools on and off per site (`enable_agent_tools`, `disable_agent_tools`, `agent_tools_status`).

That makes it the way to bootstrap: connect to the global endpoint, create or find a site, enable Agent Tools on it, and `enable_agent_tools` hands back that site's own endpoint URL for the site-scoped work.

The site-scoped tools (`wp_cli`, the log readers, the wp-config tools, `get_site_info`, `site_health_check`) are deliberately not served here — they need a bound site, and calling one returns an error pointing at the per-site endpoint instead.

To add it to Claude Code, using the persisted port:

```bash
claude mcp add --scope user --transport http local-wp-global \
  "http://localhost:$(cat ~/.local-agent-tools/port)/sites/mcp"
```

`--scope user` is the part that makes it global. Without it `claude mcp add` defaults to `--scope local`, which registers the server only for the directory you ran it in — the opposite of the point here. Use `--scope project` instead if you want it committed to a repo's `.mcp.json` for the team.

Or by hand, as a top-level `mcpServers` entry in `~/.claude.json` (Cursor, Windsurf, and VS Code use the same shapes as the per-site config the add-on writes):

```json
{
	"mcpServers": {
		"local-wp-global": { "type": "http", "url": "http://localhost:24842/sites/mcp" }
	}
}
```

`claude mcp list` confirms it connected.

`curl http://localhost:{port}/health` lists the port's registered sites and confirms the global endpoint is up.

One caveat: the global endpoint is reachable by any process on the machine, as the per-site endpoints already are — the server binds `127.0.0.1` and has no authentication. It widens what that means in practice, since site management and `create_site` are now reachable from one well-known URL rather than only from an enabled site's.

## Supported Agents

| Agent           | MCP Config           | Context File                      |
| --------------- | -------------------- | --------------------------------- |
| Claude Code     | `.mcp.json`          | `CLAUDE.md`                       |
| Cursor          | `.cursor/mcp.json`   | `.cursorrules`                    |
| Windsurf        | `.windsurf/mcp.json` | `.windsurfrules`                  |
| VS Code Copilot | `.vscode/mcp.json`   | `.github/copilot-instructions.md` |

## MCP Tools (17 total)

| Category        | Tools                   | Description                                                                                                |
| --------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| **WP-CLI**      | `wp_cli`                | Run any WP-CLI command (database queries, imports, exports, search-replace, plugin/theme management, etc.) |
| **Logs**        | `read_error_log`        | Read and parse the PHP error log                                                                           |
|                 | `read_access_log`       | Read the nginx access log                                                                                  |
|                 | `wp_debug_toggle`       | Enable/disable WP_DEBUG, WP_DEBUG_LOG, and SCRIPT_DEBUG                                                    |
| **Config**      | `read_wp_config`        | Parse wp-config.php constants and table prefix                                                             |
|                 | `edit_wp_config`        | Add or modify a wp-config.php constant (with backup)                                                       |
| **Site**        | `get_site_info`         | Paths, URLs, database config, PHP/WP versions, active plugins and theme                                    |
|                 | `site_health_check`     | Database connectivity, file permissions, WP_DEBUG status, log sizes, PHP version                           |
| **Environment** | `site_start`            | Start a site's services (PHP, MySQL, web server)                                                           |
|                 | `site_stop`             | Stop a site's services                                                                                     |
|                 | `site_restart`          | Restart a site's services                                                                                  |
|                 | `site_status`           | Get current status of a site                                                                               |
|                 | `list_sites`            | List all Local sites with status                                                                           |
|                 | `create_site`           | Create a new WordPress site in Local, optionally enabling Agent Tools on it                                |
|                 | `list_service_versions` | PHP, database, and web server versions available to `create_site`                                          |
| **Agent Tools** | `enable_agent_tools`    | Enable Agent Tools on a site — register it and write its MCP config and context files                      |
|                 | `disable_agent_tools`   | Disable Agent Tools on a site and remove what it wrote                                                     |
|                 | `agent_tools_status`    | Report which sites have Agent Tools enabled, their agents, and their MCP endpoint URLs                     |

### Creating sites

`create_site` drives the same code path as Local's own **Add Site** flow, so a new site gets provisioned services and a real WordPress install:

```
create_site({ name: "Client Redesign", phpVersion: "8.2.29", enableAgentTools: true })
```

Three things to know:

- **It returns before the site is ready.** Provisioning takes a minute or more — longer when Local has to download service binaries first — which is well past most MCP clients' request timeout. The call returns as soon as the site is registered, and `site_status` reports `adding` → `provisioning` → `running`. Poll that until it reports `running`. Pass `wait: true` to block instead, only if your client tolerates long tool calls.
- **Local may ask for the user's password.** Unless Local is set to localhost router mode, provisioning shells out to update `/etc/hosts` and macOS/Windows will prompt for administrator credentials. Site creation is never fully unattended.
- **Failures surface on the next poll.** If provisioning fails after the call returns, `site_status` includes a `creationError` field explaining why.

Omit `phpVersion`, `database` and `webServer` to accept Local's own defaults, or call `list_service_versions` first to see what is available. Versions reported with `installed: false` are downloaded on demand, which makes creation considerably slower.

With `enableAgentTools: true`, Agent Tools is turned on for the site once it finishes provisioning — registering it with the MCP server and writing its MCP config and context files, exactly as clicking **Enable** in the UI does. Use `agents` to pick which ones (defaults to `["claude"]`).

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

# Linux
cp -r . ~/.config/Local/addons/agent-tools/

# Windows (PowerShell)
Copy-Item -Recurse -Force . "$env:APPDATA\Local\addons\agent-tools"
```

Install production dependencies in the installed location and restart Local:

```bash
# macOS
cd ~/Library/Application\ Support/Local/addons/agent-tools/

# Linux
cd ~/.config/Local/addons/agent-tools/

# Windows (PowerShell)
cd "$env:APPDATA\Local\addons\agent-tools"
```

```bash
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
# macOS
cp -R lib/* ~/Library/Application\ Support/Local/addons/agent-tools/lib/

# Linux
cp -R lib/* ~/.config/Local/addons/agent-tools/lib/

# Windows (PowerShell)
Copy-Item -Recurse -Force lib\* "$env:APPDATA\Local\addons\agent-tools\lib"
```

Then restart Local to pick up changes.

## Project Structure

```
agent-tools/
├── src/                        # Add-on source (TypeScript)
│   ├── main.ts                 # Main process — lifecycle hooks, IPC, MCP server startup
│   ├── renderer.tsx            # Renderer process — React UI
│   ├── mcp-server.ts           # HTTP MCP server — routing, session management, Streamable HTTP transport
│   ├── helpers/
│   │   ├── site-config.ts      # SiteConfig type and SiteConfigRegistry
│   │   ├── paths.ts            # Platform-specific binary resolution (PHP, MySQL, WP-CLI)
│   │   ├── new-site.ts         # Pure helpers for create_site: nicename, domain, and path validation
│   │   └── port.ts             # Stable port allocation with file persistence
│   └── tools/                  # MCP tool implementations
│       ├── index.ts            # Aggregates definitions (full vs global), routes handleToolCall()
│       ├── wpcli.ts            # wp_cli
│       ├── logs.ts             # read_error_log, read_access_log, wp_debug_toggle
│       ├── config.ts           # read_wp_config, edit_wp_config
│       ├── site.ts             # get_site_info, site_health_check
│       ├── environment.ts      # site_start, site_stop, site_restart, site_status, list_sites, create_site, list_service_versions
│       └── agent-tools.ts      # enable_agent_tools, disable_agent_tools, agent_tools_status
├── lib/                        # Compiled output
├── package.json
└── tsconfig.json
```

## Requirements

- Local 9.0+
- An MCP-compatible AI tool (Claude Code, Cursor, Windsurf, VS Code Copilot, etc.)

## Platform Support

macOS (darwin-arm64 and darwin-x64), Windows, and Linux.

## Support Level

**Active:** 10up is actively working on this, and we expect to continue work for the foreseeable future including keeping tested up to the most recent version of Local. Bug reports, feature requests, questions, and pull requests are welcome.

## Changelog

A complete listing of all notable changes to Agent Tools are documented in [CHANGELOG.md](https://github.com/10up/localwp-agent-tools/blob/main/CHANGELOG.md).

## Contributing

Please read [CODE_OF_CONDUCT.md](https://github.com/10up/localwp-agent-tools/blob/main/CODE_OF_CONDUCT.md) for details on our code of conduct, [CONTRIBUTING.md](https://github.com/10up/localwp-agent-tools/blob/main/CONTRIBUTING.md) for details on the process for submitting pull requests to us, and [CREDITS.md](https://github.com/10up/localwp-agent-tools/blob/main/CREDITS.md) for a listing of maintainers, contributors, and libraries for Agent Tools.

## Like what you see?

[![Work with the 10up WordPress Practice at Fueled](https://github.com/10up/.github/blob/trunk/profile/10up-github-banner.jpg)](http://10up.com/contact/)
