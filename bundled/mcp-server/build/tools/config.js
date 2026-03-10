import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
// ── Environment ────────────────────────────────────────────────────────
const WP_PATH = process.env.WP_PATH || '';
// ── Tool Definitions ───────────────────────────────────────────────────
export const toolDefinitions = [
    {
        name: 'read_wp_config',
        description: 'Read and parse wp-config.php, extracting all define() constants and their values. Also shows the database table prefix.',
        inputSchema: {
            type: 'object',
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
        description: 'Add or modify a PHP constant in wp-config.php. If the constant already exists, its value is replaced. If not, it is added before the "That\'s all, stop editing!" comment. A backup is created before any modification.',
        inputSchema: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: 'The constant name (e.g., "WP_DEBUG", "WP_MEMORY_LIMIT").',
                },
                value: {
                    type: 'string',
                    description: 'The value to set. Use PHP literal syntax: true, false, "string", or 123. Strings must include quotes.',
                },
            },
            required: ['name', 'value'],
        },
    },
];
// ── Tool Handler ───────────────────────────────────────────────────────
export async function handleTool(name, args) {
    try {
        switch (name) {
            case 'read_wp_config':
                return handleReadWpConfig(args);
            case 'edit_wp_config':
                return handleEditWpConfig(args);
            default:
                return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
        }
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error: ${msg}` }] };
    }
}
// ── read_wp_config ─────────────────────────────────────────────────────
async function handleReadWpConfig(args) {
    const configPath = path.join(WP_PATH, 'wp-config.php');
    if (!existsSync(configPath)) {
        return {
            content: [{ type: 'text', text: `wp-config.php not found at: ${configPath}` }],
        };
    }
    const content = await readFile(configPath, 'utf-8');
    if (args.raw) {
        return { content: [{ type: 'text', text: content }] };
    }
    // Parse all define() calls
    const constants = parseDefineConstants(content);
    // Parse table prefix
    const prefixMatch = content.match(/\$table_prefix\s*=\s*['"]([^'"]+)['"]/);
    const tablePrefix = prefixMatch ? prefixMatch[1] : null;
    return {
        content: [
            {
                type: 'text',
                text: JSON.stringify({
                    file: configPath,
                    tablePrefix,
                    constants,
                }, null, 2),
            },
        ],
    };
}
// ── edit_wp_config ─────────────────────────────────────────────────────
async function handleEditWpConfig(args) {
    const constantName = String(args.name ?? '').trim();
    const constantValue = String(args.value ?? '').trim();
    if (!constantName) {
        return { content: [{ type: 'text', text: 'Error: name parameter is required.' }] };
    }
    if (!constantValue) {
        return { content: [{ type: 'text', text: 'Error: value parameter is required.' }] };
    }
    // Validate constant name — only allow standard PHP constant names
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(constantName)) {
        return {
            content: [{ type: 'text', text: 'Error: Invalid constant name. Only letters, digits, and underscores are allowed.' }],
        };
    }
    // Validate constant value — only allow valid PHP literals
    if (!/^(true|false|null|'[^'\\]*'|"[^"\\]*"|-?\d+(\.\d+)?)$/i.test(constantValue)) {
        return {
            content: [{
                    type: 'text',
                    text: 'Error: Invalid constant value. Must be a PHP literal: true, false, null, a number, or a quoted string (e.g. \'my-value\').',
                }],
        };
    }
    const configPath = path.join(WP_PATH, 'wp-config.php');
    if (!existsSync(configPath)) {
        return {
            content: [{ type: 'text', text: `wp-config.php not found at: ${configPath}` }],
        };
    }
    // Create backup
    const backupPath = `${configPath}.bak`;
    await copyFile(configPath, backupPath);
    let config = await readFile(configPath, 'utf-8');
    // Check if the constant already exists
    const regex = new RegExp(`(define\\s*\\(\\s*['"]${escapeRegex(constantName)}['"]\\s*,\\s*)([^)]+?)(\\s*\\)\\s*;)`);
    if (regex.test(config)) {
        // Replace existing value
        config = config.replace(regex, `$1${constantValue}$3`);
    }
    else {
        // Insert new constant before "That's all" comment
        const insertLine = `define( '${constantName}', ${constantValue} );\n`;
        const marker = /\/\*.*?That's all.*?\*\//i;
        if (marker.test(config)) {
            config = config.replace(marker, `${insertLine}$&`);
        }
        else {
            // Fallback: insert before require_once wp-settings.php
            const settingsLine = /require_once.*wp-settings\.php/;
            if (settingsLine.test(config)) {
                config = config.replace(settingsLine, `${insertLine}$&`);
            }
            else {
                // Last resort: append near the end
                config += `\n${insertLine}`;
            }
        }
    }
    await writeFile(configPath, config, 'utf-8');
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
/**
 * Parse all define('CONSTANT', value) calls from wp-config.php content.
 */
function parseDefineConstants(content) {
    const constants = {};
    // Match define( 'NAME', value ); patterns
    const regex = /define\s*\(\s*['"]([^'"]+)['"]\s*,\s*([^)]+?)\s*\)\s*;/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
        const name = match[1];
        let value = match[2].trim();
        // Clean up the value for presentation
        // Remove surrounding quotes from string values
        if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
            value = value.slice(1, -1);
        }
        constants[name] = value;
    }
    return constants;
}
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
//# sourceMappingURL=config.js.map