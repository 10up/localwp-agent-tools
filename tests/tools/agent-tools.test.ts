import { describe, it, expect } from 'vitest';
import {
	toolDefinitions,
	handleTool,
	parseSiteIdArg,
	parseAgentsArg,
	parseProjectDirArg,
} from '../../src/tools/agent-tools';
import type { AgentToolsSiteStatus, LocalApi } from '../../src/tools/environment';

const status: AgentToolsSiteStatus = {
	id: 'abc123',
	name: 'Test Site',
	domain: 'test.local',
	sitePath: '/tmp/test-site',
	projectDir: '',
	enabled: true,
	agents: ['claude'],
	registered: true,
	mcpUrl: 'http://localhost:24842/sites/abc123/mcp',
};

function makeLocalApi(overrides: Partial<LocalApi> = {}): LocalApi {
	return {
		startSite: async () => ({ id: 'abc123', status: 'running' }),
		stopSite: async () => ({ id: 'abc123', status: 'halted' }),
		restartSite: async () => ({ id: 'abc123', status: 'running' }),
		getSiteStatus: async () => ({ id: 'abc123', status: 'running' }),
		listSites: async () => [],
		createSite: async () => {
			throw new Error('not used');
		},
		listServiceVersions: async () => ({ php: [], database: [], webServer: [], note: '' }),
		enableAgentTools: async () => status,
		disableAgentTools: async () => ({ ...status, enabled: false, mcpUrl: null }),
		getAgentToolsStatus: async () => [status],
		...overrides,
	};
}

describe('agent-tools tool definitions', () => {
	it('exposes the three management tools', () => {
		expect(toolDefinitions.map((t) => t.name)).toEqual([
			'enable_agent_tools',
			'disable_agent_tools',
			'agent_tools_status',
		]);
	});

	it('requires siteId for enable and disable but not for status', () => {
		const required = Object.fromEntries(
			toolDefinitions.map((t) => [t.name, (t.inputSchema as { required?: string[] }).required ?? []]),
		);
		expect(required.enable_agent_tools).toEqual(['siteId']);
		expect(required.disable_agent_tools).toEqual(['siteId']);
		expect(required.agent_tools_status).toEqual([]);
	});
});

describe('parseSiteIdArg', () => {
	it('accepts and trims a non-empty string', () => {
		expect(parseSiteIdArg({ siteId: '  abc123 ' })).toBe('abc123');
	});

	it('rejects missing, empty and non-string values', () => {
		expect(parseSiteIdArg({})).toHaveProperty('error');
		expect(parseSiteIdArg({ siteId: '   ' })).toHaveProperty('error');
		expect(parseSiteIdArg({ siteId: 42 })).toHaveProperty('error');
	});
});

describe('parseAgentsArg', () => {
	it('returns undefined when omitted so the caller can default', () => {
		expect(parseAgentsArg({})).toBeUndefined();
	});

	it('accepts known agents', () => {
		expect(parseAgentsArg({ agents: ['claude', 'cursor'] })).toEqual(['claude', 'cursor']);
	});

	it('rejects unknown agents and empty arrays', () => {
		expect(parseAgentsArg({ agents: ['emacs'] })).toHaveProperty('error');
		expect(parseAgentsArg({ agents: [] })).toHaveProperty('error');
		expect(parseAgentsArg({ agents: 'claude' })).toHaveProperty('error');
	});
});

describe('parseProjectDirArg', () => {
	it('defaults to the site root', () => {
		expect(parseProjectDirArg({})).toBe('');
		expect(parseProjectDirArg({ projectDir: '   ' })).toBe('');
		expect(parseProjectDirArg({ projectDir: '.' })).toBe('');
	});

	it('accepts a nested relative path', () => {
		expect(parseProjectDirArg({ projectDir: 'app/public/wp-content/themes/mine' })).toBe(
			'app/public/wp-content/themes/mine',
		);
	});

	it('strips a trailing separator', () => {
		expect(parseProjectDirArg({ projectDir: 'app/public/' })).toBe('app/public');
	});

	// projectDir is joined onto the site path in the main process, so traversal
	// out of the site folder would write agent config anywhere on disk.
	it('rejects absolute paths', () => {
		expect(parseProjectDirArg({ projectDir: '/etc' })).toHaveProperty('error');
		expect(parseProjectDirArg({ projectDir: 'C:\\Windows' })).toHaveProperty('error');
	});

	it('rejects traversal out of the site folder', () => {
		expect(parseProjectDirArg({ projectDir: '..' })).toHaveProperty('error');
		expect(parseProjectDirArg({ projectDir: '../../../etc' })).toHaveProperty('error');
		expect(parseProjectDirArg({ projectDir: 'app/../../escape' })).toHaveProperty('error');
	});

	it('rejects non-string values', () => {
		expect(parseProjectDirArg({ projectDir: 5 })).toHaveProperty('error');
	});
});

describe('handleTool', () => {
	it('enable_agent_tools passes parsed options through and returns the status', async () => {
		let received: unknown;
		const api = makeLocalApi({
			enableAgentTools: async (options) => {
				received = options;
				return status;
			},
		});

		const result = await handleTool(
			'enable_agent_tools',
			{ siteId: 'abc123', agents: ['cursor'], projectDir: 'app/public' },
			api,
		);

		expect(received).toEqual({ siteId: 'abc123', agents: ['cursor'], projectDir: 'app/public' });
		expect(result.content[0].text).toContain('abc123');
		expect(result.content[0].text).toContain('/sites/abc123/mcp');
	});

	it('enable_agent_tools leaves agents undefined so the main process defaults it', async () => {
		let received: { agents?: unknown } = {};
		const api = makeLocalApi({
			enableAgentTools: async (options) => {
				received = options;
				return status;
			},
		});

		await handleTool('enable_agent_tools', { siteId: 'abc123' }, api);
		expect(received.agents).toBeUndefined();
	});

	it('enable_agent_tools rejects a traversing projectDir before calling Local', async () => {
		let called = false;
		const api = makeLocalApi({
			enableAgentTools: async () => {
				called = true;
				return status;
			},
		});

		const result = await handleTool('enable_agent_tools', { siteId: 'abc123', projectDir: '../..' }, api);
		expect(called).toBe(false);
		expect(result.content[0].text).toContain('must stay inside the site folder');
	});

	it('disable_agent_tools reports the site as no longer enabled', async () => {
		const result = await handleTool('disable_agent_tools', { siteId: 'abc123' }, makeLocalApi());
		expect(JSON.parse(result.content[0].text)).toMatchObject({ enabled: false, mcpUrl: null });
	});

	it('agent_tools_status reports every site when siteId is omitted', async () => {
		const api = makeLocalApi({
			getAgentToolsStatus: async (siteId) => {
				expect(siteId).toBeUndefined();
				return [status, { ...status, id: 'def456', enabled: false, mcpUrl: null }];
			},
		});

		const result = await handleTool('agent_tools_status', {}, api);
		expect(JSON.parse(result.content[0].text)).toHaveLength(2);
	});

	it('surfaces a Local error as tool text rather than throwing', async () => {
		const api = makeLocalApi({
			enableAgentTools: async () => {
				throw new Error('Site not found: nope');
			},
		});

		const result = await handleTool('enable_agent_tools', { siteId: 'nope' }, api);
		expect(result.content[0].text).toContain('Failed to enable Agent Tools');
		expect(result.content[0].text).toContain('Site not found: nope');
	});

	it('returns an unknown tool message for a name it does not own', async () => {
		const result = await handleTool('nope', {}, makeLocalApi());
		expect(result.content[0].text).toContain('Unknown tool: nope');
	});
});
