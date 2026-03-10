import { readFile, writeFile, copyFile } from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import { SiteConfig } from '../helpers/site-config';

// ── Tool Definitions ───────────────────────────────────────────────────
export const toolDefinitions = [
	{
		name: 'read_wp_config',
		description:
			'Read and parse wp-config.php, extracting all define() constants and their values. Also shows the database table prefix.',
		inputSchema: {
			type: 'object' as const,
			properties: {
				raw: {
					type: 'boolean',
					description: 'If true, return the raw file content instead of parsed constants. Default false.',
					default: false,
				},
			},
		},
	},
	{
		name: 'edit_wp_config',
		description:
			'Add or modify a PHP constant in wp-config.php. If the constant already exists, its value is replaced. If not, it is added before the "That\'s all, stop editing!" comment. A backup is created before any modification.',
		inputSchema: {
			type: 'object' as const,
			properties: {
				name: {
					type: 'string',
					description: 'The constant name (e.g., "WP_DEBUG", "WP_MEMORY_LIMIT").',
				},
				value: {
					type: 'string',
					description:
						'The value to set. Use PHP literal syntax: true, false, "string", or 123. Strings must include quotes.',
				},
			},
			required: ['name', 'value'],
		},
	},
];

// ── Tool Handler ───────────────────────────────────────────────────────
export async function handleTool(
	name: string,
	args: Record<string, unknown>,
	config: SiteConfig,
): Promise<{ content: Array<{ type: string; text: string }> }> {
	try {
		switch (name) {
			case 'read_wp_config':
				return handleReadWpConfig(args, config);
			case 'edit_wp_config':
				return handleEditWpConfig(args, config);
			default:
				return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
		}
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return { content: [{ type: 'text', text: `Error: ${msg}` }] };
	}
}

// ── read_wp_config ─────────────────────────────────────────────────────
async function handleReadWpConfig(
	args: Record<string, unknown>,
	config: SiteConfig,
): Promise<{ content: Array<{ type: string; text: string }> }> {
	const configPath = path.join(config.wpPath, 'wp-config.php');

	if (!existsSync(configPath)) {
		return {
			content: [{ type: 'text', text: `wp-config.php not found at: ${configPath}` }],
		};
	}

	const content = await readFile(configPath, 'utf-8');

	if (args.raw) {
		return { content: [{ type: 'text', text: content }] };
	}

	const constants = parseDefineConstants(content);

	const prefixMatch = content.match(/\$table_prefix\s*=\s*['"]([^'"]+)['"]/);
	const tablePrefix = prefixMatch ? prefixMatch[1] : null;

	return {
		content: [
			{
				type: 'text',
				text: JSON.stringify({ file: configPath, tablePrefix, constants }, null, 2),
			},
		],
	};
}

// ── edit_wp_config ─────────────────────────────────────────────────────
async function handleEditWpConfig(
	args: Record<string, unknown>,
	config: SiteConfig,
): Promise<{ content: Array<{ type: string; text: string }> }> {
	const constantName = String(args.name ?? '').trim();
	const constantValue = String(args.value ?? '').trim();

	if (!constantName) {
		return { content: [{ type: 'text', text: 'Error: name parameter is required.' }] };
	}
	if (!constantValue) {
		return { content: [{ type: 'text', text: 'Error: value parameter is required.' }] };
	}

	if (!/^[A-Z_][A-Z0-9_]*$/i.test(constantName)) {
		return {
			content: [{ type: 'text', text: 'Error: Invalid constant name. Only letters, digits, and underscores are allowed.' }],
		};
	}

	if (!/^(true|false|null|'[^'\\]*'|"[^"\\]*"|-?\d+(\.\d+)?)$/i.test(constantValue)) {
		return {
			content: [{
				type: 'text',
				text: 'Error: Invalid constant value. Must be a PHP literal: true, false, null, a number, or a quoted string (e.g. \'my-value\').',
			}],
		};
	}

	const configPath = path.join(config.wpPath, 'wp-config.php');

	if (!existsSync(configPath)) {
		return {
			content: [{ type: 'text', text: `wp-config.php not found at: ${configPath}` }],
		};
	}

	const backupPath = `${configPath}.bak`;
	await copyFile(configPath, backupPath);

	let fileContent = await readFile(configPath, 'utf-8');

	const regex = new RegExp(
		`(define\\s*\\(\\s*['"]${escapeRegex(constantName)}['"]\\s*,\\s*)([^)]+?)(\\s*\\)\\s*;)`,
	);

	if (regex.test(fileContent)) {
		fileContent = fileContent.replace(regex, `$1${constantValue}$3`);
	} else {
		const insertLine = `define( '${constantName}', ${constantValue} );\n`;
		const marker = /\/\*.*?That's all.*?\*\//i;
		if (marker.test(fileContent)) {
			fileContent = fileContent.replace(marker, `${insertLine}$&`);
		} else {
			const settingsLine = /require_once.*wp-settings\.php/;
			if (settingsLine.test(fileContent)) {
				fileContent = fileContent.replace(settingsLine, `${insertLine}$&`);
			} else {
				fileContent += `\n${insertLine}`;
			}
		}
	}

	await writeFile(configPath, fileContent, 'utf-8');

	return {
		content: [
			{
				type: 'text',
				text: [
					`Updated ${configPath}:`,
					`  define( '${constantName}', ${constantValue} );`,
					``,
					`Backup saved to: ${backupPath}`,
				].join('\n'),
			},
		],
	};
}

// ── Helpers ────────────────────────────────────────────────────────────

function parseDefineConstants(content: string): Record<string, string> {
	const constants: Record<string, string> = {};
	const regex = /define\s*\(\s*['"]([^'"]+)['"]\s*,\s*([^)]+?)\s*\)\s*;/g;
	let match: RegExpExecArray | null;

	while ((match = regex.exec(content)) !== null) {
		const name = match[1];
		let value = match[2].trim();

		if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
			value = value.slice(1, -1);
		}

		constants[name] = value;
	}

	return constants;
}

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
