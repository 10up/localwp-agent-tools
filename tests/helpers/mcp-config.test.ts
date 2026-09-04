import { describe, it, expect, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { mkdtempSync, rmSync, statSync } from 'fs';
import * as fs from 'fs-extra';
import { buildMcpServerEntry, mergeMcpConfig, MCP_SERVER_KEY } from '../../src/helpers/mcp-config';

const TOKEN = 'abc123token';

const URL_NO_TOKEN = 'http://localhost:24842/sites/my-site/mcp';

describe('buildMcpServerEntry', () => {
	it('embeds the Authorization: Bearer <token> header for claude (.mcp.json)', () => {
		const entry = buildMcpServerEntry('claude', 24842, 'my-site', TOKEN);
		expect(entry).toEqual({
			type: 'http',
			url: URL_NO_TOKEN,
			headers: { Authorization: `Bearer ${TOKEN}` },
		});
	});

	it('embeds the Authorization header for cursor', () => {
		const entry = buildMcpServerEntry('cursor', 24842, 'my-site', TOKEN);
		expect(entry).toEqual({
			url: URL_NO_TOKEN,
			headers: { Authorization: `Bearer ${TOKEN}` },
		});
	});

	it('embeds the Authorization header for windsurf under serverUrl', () => {
		const entry = buildMcpServerEntry('windsurf', 24842, 'my-site', TOKEN);
		expect(entry).toEqual({
			serverUrl: URL_NO_TOKEN,
			headers: { Authorization: `Bearer ${TOKEN}` },
		});
	});

	it('embeds the Authorization header for vscode', () => {
		const entry = buildMcpServerEntry('vscode', 24842, 'my-site', TOKEN);
		expect(entry).toEqual({
			type: 'http',
			url: URL_NO_TOKEN,
			headers: { Authorization: `Bearer ${TOKEN}` },
		});
	});

	// The header is the only channel that carries the token. A URL-borne copy
	// would leak the secret into client logs, shell history, and referrers, and
	// the server no longer reads one — so no agent's URL may mention it, under
	// any spelling or encoding.
	it.each(['claude', 'cursor', 'windsurf', 'vscode'] as const)('never puts the token in the %s URL', (agent) => {
		const entry = buildMcpServerEntry(agent, 24842, 'my-site', TOKEN);
		const url: string = entry.url ?? entry.serverUrl;
		expect(url).toBe(URL_NO_TOKEN);
		expect(url).not.toContain('token');
		expect(url).not.toContain('?');
		expect(entry.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
	});

	it('keeps a token with URL-special characters out of the URL entirely', () => {
		const weirdToken = 'a b&c=d/e';
		const entry = buildMcpServerEntry('claude', 24842, 'my-site', weirdToken);
		expect(entry.url).toBe(URL_NO_TOKEN);
		// The header carries the raw token — nothing needs URL encoding now.
		expect(entry.headers).toEqual({ Authorization: `Bearer ${weirdToken}` });
	});
});

describe('mergeMcpConfig: token integration in the written .mcp.json', () => {
	let tmpDir: string;

	afterEach(() => {
		if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
	});

	it('writes the Authorization header into a fresh .mcp.json', async () => {
		tmpDir = mkdtempSync(path.join(os.tmpdir(), 'agent-tools-mcp-config-'));
		const configPath = path.join(tmpDir, '.mcp.json');
		const entry = buildMcpServerEntry('claude', 24842, 'my-site', 'secret-token');

		await mergeMcpConfig(configPath, entry, 'mcpServers');

		const written = await fs.readJSON(configPath);
		expect(written.mcpServers[MCP_SERVER_KEY]).toEqual({
			type: 'http',
			url: URL_NO_TOKEN,
			headers: { Authorization: 'Bearer secret-token' },
		});
	});

	it('writes the config file as 0600 — it now carries a bearer token', async () => {
		tmpDir = mkdtempSync(path.join(os.tmpdir(), 'agent-tools-mcp-config-'));
		const configPath = path.join(tmpDir, '.mcp.json');
		const entry = buildMcpServerEntry('claude', 24842, 'my-site', 'secret-token');

		await mergeMcpConfig(configPath, entry, 'mcpServers');

		const mode = statSync(configPath).mode & 0o777;
		expect(mode).toBe(0o600);

		const written = await fs.readJSON(configPath);
		expect(written.mcpServers[MCP_SERVER_KEY].headers).toEqual({ Authorization: 'Bearer secret-token' });
	});

	it('re-chmods to 0600 even when merging into a pre-existing, more permissive file', async () => {
		tmpDir = mkdtempSync(path.join(os.tmpdir(), 'agent-tools-mcp-config-'));
		const configPath = path.join(tmpDir, '.mcp.json');
		await fs.writeJSON(configPath, { mcpServers: {} }, { mode: 0o644 });

		const entry = buildMcpServerEntry('claude', 24842, 'my-site', 'secret-token');
		await mergeMcpConfig(configPath, entry, 'mcpServers');

		const mode = statSync(configPath).mode & 0o777;
		expect(mode).toBe(0o600);
	});

	it('preserves other entries and updates only ours when merging', async () => {
		tmpDir = mkdtempSync(path.join(os.tmpdir(), 'agent-tools-mcp-config-'));
		const configPath = path.join(tmpDir, '.mcp.json');
		await fs.writeJSON(configPath, { mcpServers: { other: { url: 'http://example.com' } } });

		const entry = buildMcpServerEntry('claude', 24842, 'my-site', 'secret-token');
		await mergeMcpConfig(configPath, entry, 'mcpServers');

		const written = await fs.readJSON(configPath);
		expect(written.mcpServers.other).toEqual({ url: 'http://example.com' });
		expect(written.mcpServers[MCP_SERVER_KEY].headers).toEqual({ Authorization: 'Bearer secret-token' });
	});
});
