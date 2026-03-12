# Changelog

All notable changes to this project will be documented in this file, per [the Keep a Changelog standard](http://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/10up/localwp-agent-tools/compare/main...HEAD
[0.1.0]: https://github.com/10up/localwp-agent-tools/releases/tag/0.1.0
