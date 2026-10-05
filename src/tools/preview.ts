import { SiteConfig } from '../helpers/site-config';
import { LocalApi } from './environment';

// ── Tool Definitions ───────────────────────────────────────────────────
export const toolDefinitions = [
	{
		name: 'preview_start',
		description:
			'Clone a Local site (default: the current site) into a disposable preview site with its own database, PHP/MySQL processes, domain, and logs. ' +
			"Returns the preview's own MCP endpoint URL and is intended for isolated agent work (for example, a git worktree). " +
			'Cloning copies the full database and wp-content and may take a while on large sites.\n\n' +
			'Always pass a "label" describing the purpose of the preview (the task, branch, or ticket — e.g. "Polylang Fix", ' +
			'"player-v3", "PROJ-123"). The site is named "<Parent Name> - <label>" so a human can scan Local\'s sidebar and ' +
			'know what each preview is for. Never reuse a label that is still in use.',
		inputSchema: {
			type: 'object' as const,
			properties: {
				siteId: {
					type: 'string',
					description: 'The Local site ID of the site to clone. Optional — defaults to the current site.',
				},
				label: {
					type: 'string',
					description:
						'Short purpose label for this preview — what work it is for, not the word "preview" (e.g. ' +
						'"Polylang Fix", "player-v3", a branch or ticket id). Names the site "<Parent Name> - <label>". ' +
						'Omitting it falls back to a random suffix, which humans cannot tell apart — always provide one.',
				},
			},
		},
	},
	{
		name: 'preview_list',
		description: 'List all disposable preview sites and their MCP endpoint URLs.',
		inputSchema: {
			type: 'object' as const,
			properties: {},
		},
	},
	{
		name: 'preview_destroy',
		description:
			'Permanently delete a preview site, with its files moved to trash. ' +
			'ONLY works on sites created by preview_start and refuses to delete regular sites.',
		inputSchema: {
			type: 'object' as const,
			properties: {
				siteId: {
					type: 'string',
					description: 'The Local site ID of the preview to delete.',
				},
			},
			required: ['siteId'],
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
		let result: unknown;

		switch (name) {
			case 'preview_start':
				result = await localApi.createPreview(
					(args.siteId as string) || config.siteId,
					args.label as string | undefined,
				);
				break;
			case 'preview_list':
				result = await localApi.listPreviews();
				break;
			case 'preview_destroy':
				result = await localApi.destroyPreview(args.siteId as string);
				break;
			default:
				return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
		}

		return {
			content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
		};
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return { content: [{ type: 'text', text: `Preview Error: ${msg}` }] };
	}
}
