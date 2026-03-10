# Agent Tools

A Local add-on that provides an MCP server, skills, and project context for AI-powered WordPress development. Works with Claude Code, Cursor, Windsurf, and any MCP client.

## What It Does

When you click "Enable" on a site in Local, the add-on:

1. **Copies an MCP server** to `.agent-tools/mcp-server/` — a Node.js server that gives your AI tools direct access to the site's database, WP-CLI, error logs, and configuration
2. **Copies WordPress skills** to `.claude/skills/` — debugging and database exploration workflows
3. **Writes `.mcp.json`** — auto-configured with your site's database credentials, binary paths, and socket locations
4. **Generates `CLAUDE.md`** — site context including PHP/MySQL versions, active plugins, theme, and file structure
5. **Updates `.gitignore`** — so generated files aren't committed

Then open the site folder in your AI tool of choice and you're ready to go.

## MCP Tools (17 total)

| Category | Tools |
|----------|-------|
| **Database** | `db_query`, `db_table_info`, `db_export`, `db_search_replace` |
| **WP-CLI** | `wp_cli` |
| **Logs** | `read_error_log`, `read_access_log`, `wp_debug_toggle` |
| **Config** | `read_wp_config`, `edit_wp_config` |
| **Site** | `get_site_info`, `site_health_check` |
| **Environment** | `site_start`, `site_stop`, `site_restart`, `site_status`, `list_sites` |

## Skills

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

# Then restart Local
```

### MCP Server Dependencies

The MCP server's dependencies are installed automatically when you enable Agent Tools for a site. If that fails, you can install them manually:

```bash
cd ~/Local\ Sites/my-site/.agent-tools/mcp-server/
npm install --production
```

## Development

```bash
# Build everything (add-on + MCP server)
npm run build

# Watch add-on changes
npm run watch

# Build MCP server separately
cd bundled/mcp-server && npm run build
```

### Testing the MCP Server Standalone

You can test the MCP server without the Local add-on by creating a `.mcp.json` manually in any Local site directory. See `templates/` for reference.

## Project Structure

```
agent-tools/
├── src/                        # Local add-on source
│   ├── main.ts                 # Main process (backend)
│   ├── renderer.tsx            # Renderer process (React UI)
│   └── helpers/paths.ts        # Platform-specific path resolution
├── bundled/                    # Files copied to each site
│   ├── mcp-server/             # MCP server (Node.js stdio)
│   │   ├── src/
│   │   │   ├── index.ts        # Server entry point
│   │   │   └── tools/          # Tool implementations
│   │   │       ├── database.ts # db_query, db_table_info, db_export, db_search_replace
│   │   │       ├── wpcli.ts    # wp_cli
│   │   │       ├── logs.ts     # read_error_log, read_access_log, wp_debug_toggle
│   │   │       ├── config.ts   # read_wp_config, edit_wp_config
│   │   │       ├── site.ts     # get_site_info, site_health_check
│   │   │       └── environment.ts # site_start, site_stop, site_restart, list_sites
│   │   ├── build/              # Compiled output
│   │   └── package.json
│   └── skills/                 # SKILL.md files
│       ├── wp-debugger/
│       └── wp-db-explorer/
├── templates/                  # Config templates
│   ├── claude-md.hbs           # CLAUDE.md Handlebars template
│   └── gitignore-additions.txt
├── lib/                        # Compiled add-on output
├── package.json
└── tsconfig.json
```

## Requirements

- Local 9.0+
- Node.js 18+ (for the MCP server)
- An MCP-compatible AI tool (Claude Code, Cursor, Windsurf, etc.)

## Platform Support

macOS (darwin-arm64 and darwin-x64), Windows, and Linux.

## License

MIT
