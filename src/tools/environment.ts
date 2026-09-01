import { SiteConfig } from '../helpers/site-config';

// ── LocalApi interface ─────────────────────────────────────────────────
// Implemented in main.ts, wrapping Local's SiteProcessManager APIs.

export type MultisiteMode = 'none' | 'subdirectory' | 'subdomain';

/** Agent targets that can be configured on a newly created site. */
export const AGENT_NAMES = ['claude', 'cursor', 'windsurf', 'vscode'] as const;
export type AgentName = (typeof AGENT_NAMES)[number];

export interface CreateSiteOptions {
	name: string;
	domain?: string;
	path?: string;
	phpVersion?: string;
	database?: string;
	webServer?: string;
	multisite?: MultisiteMode;
	wpAdminUsername?: string;
	wpAdminPassword?: string;
	wpAdminEmail?: string;
	siteLanguage?: string;
	xdebugEnabled?: boolean;
	/** Defaults to true. Set false to provision the site without installing WordPress. */
	installWordPress?: boolean;
	enableAgentTools?: boolean;
	agents?: AgentName[];
	/** Await the full provision + WordPress install instead of returning as soon as the site exists. */
	wait?: boolean;
}

export interface CreateSiteResult {
	id: string;
	name: string;
	domain: string;
	path: string;
	url: string;
	status: string;
	phpVersion: string;
	database: string;
	webServer: string;
	multisite: MultisiteMode;
	wpAdminUsername: string;
	wpAdminPassword: string;
	wpAdminEmail: string;
	agentToolsEnabled: boolean;
	/** True when create_site returned before provisioning finished. */
	pending: boolean;
}

export interface ServiceVersion {
	/** Value to pass to create_site, e.g. `8.2.29` for PHP or `mysql-8.4.0` for a database. */
	value: string;
	/** True when the binaries are already on disk; false means Local downloads them first. */
	installed: boolean;
}

export interface ServiceVersions {
	php: ServiceVersion[];
	database: ServiceVersion[];
	webServer: ServiceVersion[];
	/** Explains what omitting a service option does, since Local keeps its preferred versions private. */
	note: string;
}

export interface LocalApi {
	startSite(siteId: string): Promise<{ id: string; name?: string; status: string; message?: string }>;
	stopSite(siteId: string): Promise<{ id: string; name?: string; status: string; message?: string }>;
	restartSite(siteId: string): Promise<{ id: string; name?: string; status: string; message?: string }>;
	getSiteStatus(siteId: string): Promise<{
		id: string;
		name?: string;
		domain?: string;
		status: string;
		/** Set when a create_site call for this site failed during provisioning. */
		creationError?: string;
	}>;
	listSites(): Promise<Array<{ id: string; name: string; domain: string; path: string; status: string }>>;
	createSite(options: CreateSiteOptions): Promise<CreateSiteResult>;
	listServiceVersions(): Promise<ServiceVersions>;
}

// ── Tool Definitions ───────────────────────────────────────────────────
export const toolDefinitions = [
	{
		name: 'site_start',
		description:
			"Start a Local site's services (PHP, MySQL, web server). " +
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
			"Stop a Local site's services (PHP, MySQL, web server). " +
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
			"Restart a Local site's services (PHP, MySQL, web server). " +
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
			'If siteId is omitted, operates on the current site. ' +
			'Use this to poll a site created with create_site; a creationError field appears ' +
			'if provisioning that site failed.',
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
		description: 'List all Local sites with their ID, name, domain, path, and current status.',
		inputSchema: {
			type: 'object' as const,
			properties: {},
		},
	},
	{
		name: 'list_service_versions',
		description:
			'List the PHP, database, and web server versions available for a new Local site. ' +
			'Use this before create_site to pick valid phpVersion / database / webServer values. ' +
			'Versions marked installed:false are downloaded on demand, which makes creation slower.',
		inputSchema: {
			type: 'object' as const,
			properties: {},
		},
	},
	{
		name: 'create_site',
		description:
			'Create a new WordPress site in Local. Provisions the site services and installs WordPress. ' +
			'Returns as soon as the site exists (usually within a second) — provisioning continues in the ' +
			'background and typically takes one to several minutes, longer when service binaries must be ' +
			'downloaded first. Poll site_status with the returned id until it reports "running". ' +
			'Pass wait:true to block until the site is fully ready instead. ' +
			'Note: unless Local is set to localhost router mode, Local will prompt the user for their ' +
			'administrator password to update /etc/hosts partway through.',
		inputSchema: {
			type: 'object' as const,
			properties: {
				name: {
					type: 'string',
					description: 'Display name for the site, e.g. "My Test Site".',
				},
				domain: {
					type: 'string',
					description:
						'Local domain for the site. Optional — defaults to the slugified name plus the ' +
						'configured TLD, e.g. "my-test-site.local".',
				},
				path: {
					type: 'string',
					description:
						'Absolute path for the site folder. Optional — defaults to the slugified name inside ' +
						"Local's configured sites directory. Must not be an existing site folder.",
				},
				phpVersion: {
					type: 'string',
					description: 'PHP version, e.g. "8.2.29". Optional — see list_service_versions.',
				},
				database: {
					type: 'string',
					description:
						'Database service as "<name>-<version>", e.g. "mysql-8.4.0" or "mariadb-10.6.23". ' +
						'Optional — see list_service_versions.',
				},
				webServer: {
					type: 'string',
					description:
						'Web server as "<name>-<version>", e.g. "nginx-1.26.1". Optional — see list_service_versions.',
				},
				multisite: {
					type: 'string',
					enum: ['none', 'subdirectory', 'subdomain'],
					description: 'WordPress multisite mode. Optional — defaults to "none".',
				},
				wpAdminUsername: {
					type: 'string',
					description: 'WordPress admin username. Optional — defaults to "admin".',
				},
				wpAdminPassword: {
					type: 'string',
					description: 'WordPress admin password. Optional — defaults to "admin".',
				},
				wpAdminEmail: {
					type: 'string',
					description: "WordPress admin email. Optional — defaults to Local's configured admin email.",
				},
				siteLanguage: {
					type: 'string',
					description: 'WordPress locale, e.g. "en_US". Optional — defaults to Local\'s configured language.',
				},
				xdebugEnabled: {
					type: 'boolean',
					description: 'Enable Xdebug on the new site. Optional — defaults to false.',
				},
				skipWordPressInstall: {
					type: 'boolean',
					description:
						'Provision the site but skip installing WordPress, leaving an empty web root. ' +
						'Optional — defaults to false.',
				},
				enableAgentTools: {
					type: 'boolean',
					description:
						'Enable Agent Tools on the new site once it is ready, registering it with this MCP ' +
						'server and writing its MCP config and project context files. Optional — defaults to false.',
				},
				agents: {
					type: 'array',
					items: { type: 'string', enum: ['claude', 'cursor', 'windsurf', 'vscode'] },
					description:
						'Which agents to configure when enableAgentTools is true. Optional — defaults to ["claude"].',
				},
				wait: {
					type: 'boolean',
					description:
						'Block until provisioning and the WordPress install finish. Optional — defaults to false. ' +
						'Only set this if your MCP client tolerates multi-minute tool calls.',
				},
			},
			required: ['name'],
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
			case 'list_service_versions':
				return handleListServiceVersions(localApi);
			case 'create_site':
				return handleCreateSite(args, localApi);
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
			content: [
				{
					type: 'text',
					text:
						'Error: No siteId provided and current site ID is not available. ' +
						'Please provide a siteId argument, or use list_sites to find available site IDs.',
				},
			],
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
async function handleListSites(localApi: LocalApi): Promise<{ content: Array<{ type: string; text: string }> }> {
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

// ── list_service_versions ─────────────────────────────────────────────
async function handleListServiceVersions(
	localApi: LocalApi,
): Promise<{ content: Array<{ type: string; text: string }> }> {
	try {
		const versions = await localApi.listServiceVersions();
		return {
			content: [{ type: 'text', text: JSON.stringify(versions, null, 2) }],
		};
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return {
			content: [{ type: 'text', text: `Failed to list service versions: ${msg}` }],
		};
	}
}

// ── create_site ───────────────────────────────────────────────────────

const MULTISITE_MODES: MultisiteMode[] = ['none', 'subdirectory', 'subdomain'];

/**
 * Narrow the loosely typed MCP arguments into CreateSiteOptions, rejecting
 * anything the caller got wrong before we start provisioning.
 */
export function parseCreateSiteArgs(args: Record<string, unknown>): CreateSiteOptions | string {
	const name = args.name;
	if (typeof name !== 'string' || !name.trim()) {
		return 'Error: "name" is required and must be a non-empty string.';
	}

	const options: CreateSiteOptions = { name: name.trim() };

	const stringFields = [
		'domain',
		'path',
		'phpVersion',
		'database',
		'webServer',
		'wpAdminUsername',
		'wpAdminPassword',
		'wpAdminEmail',
		'siteLanguage',
	] as const;

	for (const field of stringFields) {
		const value = args[field];
		if (value === undefined || value === null) continue;
		if (typeof value !== 'string' || !value.trim()) {
			return `Error: "${field}" must be a non-empty string when provided.`;
		}
		options[field] = value.trim();
	}

	const booleanFields = ['xdebugEnabled', 'skipWordPressInstall', 'enableAgentTools', 'wait'] as const;
	const booleans: Record<string, boolean> = {};
	for (const field of booleanFields) {
		const value = args[field];
		if (value === undefined || value === null) continue;
		if (typeof value !== 'boolean') {
			return `Error: "${field}" must be a boolean when provided.`;
		}
		booleans[field] = value;
	}
	options.xdebugEnabled = booleans.xdebugEnabled;
	options.enableAgentTools = booleans.enableAgentTools;
	options.wait = booleans.wait;
	if (booleans.skipWordPressInstall !== undefined) {
		options.installWordPress = !booleans.skipWordPressInstall;
	}

	if (args.multisite !== undefined && args.multisite !== null) {
		if (typeof args.multisite !== 'string' || !MULTISITE_MODES.includes(args.multisite as MultisiteMode)) {
			return `Error: "multisite" must be one of: ${MULTISITE_MODES.join(', ')}.`;
		}
		options.multisite = args.multisite as MultisiteMode;
	}

	if (args.agents !== undefined && args.agents !== null) {
		if (!Array.isArray(args.agents) || args.agents.length === 0) {
			return 'Error: "agents" must be a non-empty array when provided.';
		}
		const invalid = args.agents.filter((a) => typeof a !== 'string' || !AGENT_NAMES.includes(a as AgentName));
		if (invalid.length) {
			return `Error: unknown agent(s): ${invalid.join(', ')}. Valid agents: ${AGENT_NAMES.join(', ')}.`;
		}
		options.agents = args.agents as AgentName[];
	}

	return options;
}

async function handleCreateSite(
	args: Record<string, unknown>,
	localApi: LocalApi,
): Promise<{ content: Array<{ type: string; text: string }> }> {
	const parsed = parseCreateSiteArgs(args);
	if (typeof parsed === 'string') {
		return { content: [{ type: 'text', text: parsed }] };
	}

	try {
		const result = await localApi.createSite(parsed);
		const note = result.pending
			? `\n\nProvisioning is running in the background. Poll site_status with siteId "${result.id}" ` +
				'until it reports "running". Local may prompt the user for their administrator password ' +
				'to update the hosts file before the site becomes reachable.'
			: '';
		return {
			content: [{ type: 'text', text: `${JSON.stringify(result, null, 2)}${note}` }],
		};
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return {
			content: [{ type: 'text', text: `Failed to create site: ${msg}` }],
		};
	}
}
