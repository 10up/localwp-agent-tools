import { SiteConfig } from '../helpers/site-config';

// ── LocalApi interface ─────────────────────────────────────────────────
// Implemented in main.ts, wrapping Local's SiteProcessManager APIs.

export interface LocalApi {
	startSite(siteId: string): Promise<{ id: string; name?: string; status: string; message?: string }>;
	stopSite(siteId: string): Promise<{ id: string; name?: string; status: string; message?: string }>;
	restartSite(siteId: string): Promise<{ id: string; name?: string; status: string; message?: string }>;
	getSiteStatus(siteId: string): Promise<{ id: string; name?: string; domain?: string; status: string }>;
	listSites(): Promise<Array<{ id: string; name: string; domain: string; path: string; status: string }>>;
}

// ── Tool Definitions ───────────────────────────────────────────────────
export const toolDefinitions = [
	{
		name: 'site_start',
		description:
			'Start a Local site\'s services (PHP, MySQL, web server). ' +
			'If siteId is omitted, operates on the current site.',
		inputSchema: {
			type: 'object' as const,
			properties: {
				siteId: {
					type: 'string',
					description: 'The Local site ID. Optional — defaults to the current site.',
				},
			},
		},
	},
	{
		name: 'site_stop',
		description:
			'Stop a Local site\'s services (PHP, MySQL, web server). ' +
			'If siteId is omitted, operates on the current site.',
		inputSchema: {
			type: 'object' as const,
			properties: {
				siteId: {
					type: 'string',
					description: 'The Local site ID. Optional — defaults to the current site.',
				},
			},
		},
	},
	{
		name: 'site_restart',
		description:
			'Restart a Local site\'s services (PHP, MySQL, web server). ' +
			'If siteId is omitted, operates on the current site.',
		inputSchema: {
			type: 'object' as const,
			properties: {
				siteId: {
					type: 'string',
					description: 'The Local site ID. Optional — defaults to the current site.',
				},
			},
		},
	},
	{
		name: 'site_status',
		description:
			'Get the current status (running, halted, etc.) of a Local site. ' +
			'If siteId is omitted, operates on the current site.',
		inputSchema: {
			type: 'object' as const,
			properties: {
				siteId: {
					type: 'string',
					description: 'The Local site ID. Optional — defaults to the current site.',
				},
			},
		},
	},
	{
		name: 'list_sites',
		description:
			'List all Local sites with their ID, name, domain, path, and current status.',
		inputSchema: {
			type: 'object' as const,
			properties: {},
		},
	},
];

// ── Tool Handler ───────────────────────────────────────────────────────
export async function handleTool(
	name: string,
	args: Record<string, unknown>,
	config: SiteConfig,
	localApi: LocalApi,
): Promise<{ content: Array<{ type: string; text: string }> }> {
	try {
		switch (name) {
			case 'site_start':
				return handleSiteAction('start', args, config, localApi);
			case 'site_stop':
				return handleSiteAction('stop', args, config, localApi);
			case 'site_restart':
				return handleSiteAction('restart', args, config, localApi);
			case 'site_status':
				return handleSiteAction('status', args, config, localApi);
			case 'list_sites':
				return handleListSites(localApi);
			default:
				return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
		}
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return { content: [{ type: 'text', text: `Environment Error: ${msg}` }] };
	}
}

// ── site_start / site_stop / site_restart / site_status ───────────────
async function handleSiteAction(
	action: 'start' | 'stop' | 'restart' | 'status',
	args: Record<string, unknown>,
	config: SiteConfig,
	localApi: LocalApi,
): Promise<{ content: Array<{ type: string; text: string }> }> {
	const siteId = (args.siteId as string) || config.siteId;

	if (!siteId) {
		return {
			content: [{
				type: 'text',
				text: 'Error: No siteId provided and current site ID is not available. ' +
					'Please provide a siteId argument, or use list_sites to find available site IDs.',
			}],
		};
	}

	try {
		let result: any;
		switch (action) {
			case 'start':
				result = await localApi.startSite(siteId);
				break;
			case 'stop':
				result = await localApi.stopSite(siteId);
				break;
			case 'restart':
				result = await localApi.restartSite(siteId);
				break;
			case 'status':
				result = await localApi.getSiteStatus(siteId);
				break;
		}

		return {
			content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
		};
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return {
			content: [{ type: 'text', text: `Failed to ${action} site: ${msg}` }],
		};
	}
}

// ── list_sites ────────────────────────────────────────────────────────
async function handleListSites(
	localApi: LocalApi,
): Promise<{ content: Array<{ type: string; text: string }> }> {
	try {
		const sites = await localApi.listSites();
		return {
			content: [{ type: 'text', text: JSON.stringify(sites, null, 2) }],
		};
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return {
			content: [{ type: 'text', text: `Failed to list sites: ${msg}` }],
		};
	}
}
