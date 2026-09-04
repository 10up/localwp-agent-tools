import * as path from 'path';
import * as fs from 'fs-extra';

// ---------------------------------------------------------------------------
// MCP Config — Per-Agent HTTP Format
//
// Pure helpers for building and merging the MCP server entry written into
// each coding agent's config file (.mcp.json, .cursor/mcp.json, etc.).
// Kept free of Local runtime imports (unlike main.ts) so they can be unit
// tested directly.
// ---------------------------------------------------------------------------

/** The key we use inside any mcpServers/servers object to identify our entry */
export const MCP_SERVER_KEY = 'local-wp';

/**
 * Supported coding agent targets.
 * Each defines where MCP config and project context live.
 */
export type AgentTarget = 'claude' | 'cursor' | 'windsurf' | 'vscode';

/**
 * Builds the MCP server entry for a specific agent.
 * Each agent has different JSON shapes for HTTP MCP servers, but every shape
 * carries the token in exactly one place: an `Authorization: Bearer <token>`
 * header. The URL never carries the token — a `?token=` query parameter would
 * leak the secret into client logs and process listings, and the server no
 * longer accepts one.
 */
export function buildMcpServerEntry(
	agent: AgentTarget,
	port: number,
	siteId: string,
	token: string,
): Record<string, any> {
	const url = `http://localhost:${port}/sites/${siteId}/mcp`;
	const headers = { Authorization: `Bearer ${token}` };

	switch (agent) {
		case 'claude':
			return { type: 'http', url, headers };
		case 'cursor':
			return { url, headers };
		case 'windsurf':
			return { serverUrl: url, headers };
		case 'vscode':
			return { type: 'http', url, headers };
	}
}

/**
 * Safely merges our MCP server entry into an existing MCP config file.
 * Creates the file (and parent directories) if it doesn't exist.
 * Preserves all other entries in the file.
 */
export async function mergeMcpConfig(
	configPath: string,
	serverEntry: Record<string, any>,
	topLevelKey: string,
): Promise<void> {
	let existing: any = {};

	if (await fs.pathExists(configPath)) {
		try {
			existing = await fs.readJSON(configPath);
		} catch {
			// File exists but isn't valid JSON — back it up before overwriting
			const backupPath = configPath + '.backup';
			await fs.copy(configPath, backupPath);
			console.warn(`[Agent Tools] Backed up invalid JSON at ${configPath} to ${backupPath}`);
			existing = {};
		}
	}

	if (!existing[topLevelKey] || typeof existing[topLevelKey] !== 'object') {
		existing[topLevelKey] = {};
	}

	existing[topLevelKey][MCP_SERVER_KEY] = serverEntry;

	await fs.ensureDir(path.dirname(configPath));

	// This file now carries a secret (the bearer token in our entry's
	// Authorization header), so keep it owner-only. `mode` only applies when
	// writeJSON creates the file — if it already existed, its mode is left
	// as-is — so we chmod explicitly afterward to guarantee 0600 either way.
	await fs.writeJSON(configPath, existing, { spaces: 2, mode: 0o600 });
	await fs.chmod(configPath, 0o600);
}
