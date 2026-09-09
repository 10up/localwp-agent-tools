# Changelog

All notable changes to this project will be documented in this file, per [the Keep a Changelog standard](http://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Global MCP endpoint at `/sites/mcp`, not bound to any site — configure it once (e.g. in `~/.claude.json`) and manage Local from anywhere, instead of needing an enabled site's folder open first. It serves the Local-wide tools (`list_sites`, `create_site`, `list_service_versions`), the site lifecycle tools, and the new Agent Tools management tools. Site-scoped tools stay on `/sites/{siteId}/mcp` and return an error pointing there if called globally.
- `enable_agent_tools` and `disable_agent_tools` MCP tools — turn Agent Tools on or off for an existing site over MCP, the same as clicking Enable in Local's UI. `enable_agent_tools` returns the site's own MCP endpoint URL, so an agent can bootstrap from the global endpoint to a site-scoped one.
- `agent_tools_status` MCP tool — report which sites have Agent Tools enabled, which agents are configured, the project directory, whether the site is registered with the MCP server, and each site's MCP endpoint URL.
- `create_site` MCP tool — create a new WordPress site in Local, with optional PHP / database / web server versions, multisite mode, WordPress admin credentials, and Xdebug. Returns as soon as the site is registered so the call does not outlive the MCP client's request timeout; poll `site_status` until the site reports `running`, or pass `wait: true` to block (props [@ivanlopez](https://github.com/ivanlopez) via [#80](https://github.com/10up/localwp-agent-tools/pull/80)).
- `create_site` can enable Agent Tools on the site it creates via `enableAgentTools`, registering it with the MCP server and writing its MCP config and context files for the agents named in `agents` (props [@ivanlopez](https://github.com/ivanlopez) via [#80](https://github.com/10up/localwp-agent-tools/pull/80)).
- `list_service_versions` MCP tool — list the PHP, database, and web server versions available to `create_site`, flagging which are already installed versus downloaded on demand (props [@ivanlopez](https://github.com/ivanlopez) via [#80](https://github.com/10up/localwp-agent-tools/pull/80)).
- `site_status` now reports a `creationError` when a site created with `create_site` failed during provisioning (props [@ivanlopez](https://github.com/ivanlopez) via [#80](https://github.com/10up/localwp-agent-tools/pull/80)).

## [0.2.1] - 2026-03-19

### Fixed

- Add lodash as explicit dependency — required at runtime by `@getflywheel/local-components`, which prevented the renderer (UI tab) from loading.
- Remove `prepare` script that breaks `npm install` in non-dev contexts (release packaging, local deploy).

## [0.2.0] - 2026-03-19

### Added

- Testing framework with Vitest (93 tests across 11 files) (props [@claytoncollie](https://github.com/claytoncollie) via [#53](https://github.com/10up/localwp-agent-tools/pull/53)).
- ESLint 9 and Prettier for consistent code style (props [@claytoncollie](https://github.com/claytoncollie) via [#53](https://github.com/10up/localwp-agent-tools/pull/53)).
- GitHub Actions CI pipeline for lint, format, typecheck, test, and build (props [@claytoncollie](https://github.com/claytoncollie) via [#53](https://github.com/10up/localwp-agent-tools/pull/53)).
- Automated release workflow triggered by version tags (props [@christianc1](https://github.com/christianc1) via [#54](https://github.com/10up/localwp-agent-tools/pull/54)).
- Retry with next port when MCP server port is taken on startup (props [@claytoncollie](https://github.com/claytoncollie) via [#47](https://github.com/10up/localwp-agent-tools/pull/47)).
- Tail-read large log files (5 MB cap) to prevent memory spikes (props [@claytoncollie](https://github.com/claytoncollie) via [#41](https://github.com/10up/localwp-agent-tools/pull/41)).
- 1 MB request body size limit on MCP HTTP server (props [@claytoncollie](https://github.com/claytoncollie) via [#39](https://github.com/10up/localwp-agent-tools/pull/39)).
- Server-side blocklist for destructive WP-CLI commands (props [@claytoncollie](https://github.com/claytoncollie) via [#37](https://github.com/10up/localwp-agent-tools/pull/37)).
- Backslash escape handling in WP-CLI argument parser (props [@claytoncollie](https://github.com/claytoncollie) via [#45](https://github.com/10up/localwp-agent-tools/pull/45)).
- Type aliases for MCP SDK types (props [@claytoncollie](https://github.com/claytoncollie) via [#50](https://github.com/10up/localwp-agent-tools/pull/50)).
- `noImplicitAny` enabled in TypeScript config (props [@claytoncollie](https://github.com/claytoncollie) via [#49](https://github.com/10up/localwp-agent-tools/pull/49)).

### Fixed

- Use `path.delimiter` instead of hardcoded colon for cross-platform PATH separator (props [@claytoncollie](https://github.com/claytoncollie) via [#34](https://github.com/10up/localwp-agent-tools/pull/34)).
- Synchronous port file cleanup in `will-quit` handler to prevent race condition (props [@claytoncollie](https://github.com/claytoncollie) via [#35](https://github.com/10up/localwp-agent-tools/pull/35)).
- Remove database user from `get_site_info` response to avoid credential leakage (props [@claytoncollie](https://github.com/claytoncollie) via [#48](https://github.com/10up/localwp-agent-tools/pull/48)).

### Security

- Remove wildcard CORS headers from MCP HTTP server (props [@claytoncollie](https://github.com/claytoncollie) via [#36](https://github.com/10up/localwp-agent-tools/pull/36)).

### Changed

- Extract shared `buildWpCliEnv` and `escapeRegex` into `src/helpers/utils.ts` (props [@claytoncollie](https://github.com/claytoncollie) via [#51](https://github.com/10up/localwp-agent-tools/pull/51)).
- Remove compiled `lib/` from version control; built on install via `prepare` script (props [@christianc1](https://github.com/christianc1) via [#54](https://github.com/10up/localwp-agent-tools/pull/54)).
- Remove unused lodash dependency (props [@claytoncollie](https://github.com/claytoncollie) via [#42](https://github.com/10up/localwp-agent-tools/pull/42)).
- Remove unused `getBinaryPlatformDir` function (props [@claytoncollie](https://github.com/claytoncollie) via [#43](https://github.com/10up/localwp-agent-tools/pull/43)).
- Remove unused templates directory (props [@claytoncollie](https://github.com/claytoncollie) via [#44](https://github.com/10up/localwp-agent-tools/pull/44)).
- Remove duplicate `bundleDependencies` from package.json (props [@claytoncollie](https://github.com/claytoncollie) via [#40](https://github.com/10up/localwp-agent-tools/pull/40)).

## [0.1.0] - 2026-03-11

### Added

- Initial release of the Agent Tools add-on for Local.
- Single HTTP MCP server running in Local's Electron main process.
- Support for Claude Code, Cursor, Windsurf, and VS Code Copilot.
- MCP tools: `wp_cli`, `read_error_log`, `read_access_log`, `wp_debug_toggle`, `read_wp_config`, `edit_wp_config`, `get_site_info`, `site_health_check`, `site_start`, `site_stop`, `site_restart`, `site_status`, `list_sites`.
- Auto-generated project context files per agent.
- Stable port allocation with file persistence.

### Fixed

- Search all lightning-services directories for service binaries (props [@rickalee](https://github.com/rickalee) via [#3](https://github.com/10up/localwp-agent-tools/pull/3)).
- Check `wp-content/debug.log` when reading PHP error logs with WP_DEBUG_LOG enabled (props [@iandunn](https://github.com/iandunn) via [#5](https://github.com/10up/localwp-agent-tools/issues/5)).

[Unreleased]: https://github.com/10up/localwp-agent-tools/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/10up/localwp-agent-tools/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/10up/localwp-agent-tools/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/10up/localwp-agent-tools/releases/tag/v0.1.0
