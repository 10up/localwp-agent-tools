# Changelog

All notable changes to this project will be documented in this file, per [the Keep a Changelog standard](http://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.0] - 2026-09-04

### Added

- `create_site` MCP tool — create a new WordPress site in Local, with optional PHP / database / web server versions, multisite mode, WordPress admin credentials, and Xdebug. Returns as soon as the site is registered so the call does not outlive the MCP client's request timeout; poll `site_status` until the site reports `running`, or pass `wait: true` to block (props [@ivanlopez](https://github.com/ivanlopez) via [#80](https://github.com/10up/localwp-agent-tools/pull/80)).
- `create_site` can enable Agent Tools on the site it creates via `enableAgentTools`, registering it with the MCP server and writing its MCP config and context files for the agents named in `agents` (props [@ivanlopez](https://github.com/ivanlopez) via [#80](https://github.com/10up/localwp-agent-tools/pull/80)).
- `list_service_versions` MCP tool — list the PHP, database, and web server versions available to `create_site`, flagging which are already installed versus downloaded on demand (props [@ivanlopez](https://github.com/ivanlopez) via [#80](https://github.com/10up/localwp-agent-tools/pull/80)).
- `site_status` now reports a `creationError` when a site created with `create_site` failed during provisioning (props [@ivanlopez](https://github.com/ivanlopez) via [#80](https://github.com/10up/localwp-agent-tools/pull/80)).

### Fixed

- The add-on no longer adds each agent's context file (`CLAUDE.md`, `.cursorrules`, `.windsurfrules`) to the project's `.gitignore`. Those files are human-authored and usually committed; the add-on only writes a marked section into them, so ignoring them is misleading and does nothing for a file that is already tracked. Only the machine-generated MCP config files stay ignored (props [@claytoncollie](https://github.com/claytoncollie)).

### Security

- Require an `Authorization: Bearer <token>` header on every MCP HTTP request. The token is a 64-character hex string, generated per install and stored at `~/.local-agent-tools/token` with mode `0600`, and the server checks it in constant time. The header is the only channel now; there is no `?token=` query parameter. Reported by [@AlexU-A](https://github.com/AlexU-A) (Zivtech) via [GHSA-79p7-m44g-38qx](https://github.com/10up/localwp-agent-tools/security/advisories/GHSA-79p7-m44g-38qx).
- Create the token file with an exclusive-create flag, and unlink any existing entry at that path first. The unlink stops a symlink left at `~/.local-agent-tools/token` from redirecting the write to another file.
- Reject any request whose `Host` header is not exactly `127.0.0.1:{port}` or `localhost:{port}`, and any request whose `Origin` header, when present, is not exactly `http://127.0.0.1:{port}` or `http://localhost:{port}`. This applies to every route, and the MCP SDK's own DNS-rebinding protection now runs with the same allowlists.
- Reject a request whose `Origin` header is present but empty, the same as any other non-loopback value.
- Stop listing site IDs in the `/health` response, so the endpoint no longer discloses which sites are configured.
- Write the bearer token into a `headers` field in each generated MCP config file instead of the URL. Set `.mcp.json`, `.cursor/mcp.json`, `.windsurf/mcp.json`, and `.vscode/mcp.json` to mode `0600`, and add each file plus its `.backup` copy to the project's `.gitignore` using forward-slash paths on every operating system. The add-on now refreshes that `.gitignore` block every time it rewrites the MCP config files, including on startup and on "Regenerate Config". This means an install that never ignored `.cursor/mcp.json`, `.windsurf/mcp.json`, or `.vscode/mcp.json` gets those entries on its first start after upgrading.
- Rewrite the MCP config file for every enabled site with the current token on startup, so users upgrading from an earlier version need no manual step.
- Add a `WWW-Authenticate: Bearer realm="Agent Tools"` header to the 401 response, with a hint to regenerate the config from the Agent Tools panel in Local.
- Match the `wp_cli` blocklist after skipping any leading argument that starts with `-`, single-dash or double-dash alike, closing a bypass where such a flag before the command shifted the match. Block `--exec`, `--require`, `--ssh`, and `--http` anywhere in the arguments, since each can run PHP code or redirect the command to another host.
- Redact the database password, and any constant ending in `_KEY`, `_SALT`, `_PASSWORD`, `_SECRET`, `_TOKEN`, or `_PASS`, in `read_wp_config` output by default. The name match ignores case. Pass `includeSecrets: true` to see the real values. `raw: true` now requires `includeSecrets: true`; without it, the tool returns an explanation instead of the file, because raw PHP cannot be redacted reliably.

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

[Unreleased]: https://github.com/10up/localwp-agent-tools/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/10up/localwp-agent-tools/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/10up/localwp-agent-tools/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/10up/localwp-agent-tools/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/10up/localwp-agent-tools/releases/tag/v0.1.0
