"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.toolDefinitions = void 0;
exports.handleTool = handleTool;
const promises_1 = require("fs/promises");
const fs_1 = require("fs");
const path = __importStar(require("path"));
// ── Tool Definitions ───────────────────────────────────────────────────
exports.toolDefinitions = [
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
function handleTool(name, args, config) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            switch (name) {
                case 'read_wp_config':
                    return handleReadWpConfig(args, config);
                case 'edit_wp_config':
                    return handleEditWpConfig(args, config);
                default:
                    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
            }
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text', text: `Error: ${msg}` }] };
        }
    });
}
// ── read_wp_config ─────────────────────────────────────────────────────
function handleReadWpConfig(args, config) {
    return __awaiter(this, void 0, void 0, function* () {
        const configPath = path.join(config.wpPath, 'wp-config.php');
        if (!(0, fs_1.existsSync)(configPath)) {
            return {
                content: [{ type: 'text', text: `wp-config.php not found at: ${configPath}` }],
            };
        }
        const content = yield (0, promises_1.readFile)(configPath, 'utf-8');
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
    });
}
// ── edit_wp_config ─────────────────────────────────────────────────────
function handleEditWpConfig(args, config) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const constantName = String((_a = args.name) !== null && _a !== void 0 ? _a : '').trim();
        const constantValue = String((_b = args.value) !== null && _b !== void 0 ? _b : '').trim();
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
        if (!(0, fs_1.existsSync)(configPath)) {
            return {
                content: [{ type: 'text', text: `wp-config.php not found at: ${configPath}` }],
            };
        }
        const backupPath = `${configPath}.bak`;
        yield (0, promises_1.copyFile)(configPath, backupPath);
        let fileContent = yield (0, promises_1.readFile)(configPath, 'utf-8');
        const regex = new RegExp(`(define\\s*\\(\\s*['"]${escapeRegex(constantName)}['"]\\s*,\\s*)([^)]+?)(\\s*\\)\\s*;)`);
        if (regex.test(fileContent)) {
            fileContent = fileContent.replace(regex, `$1${constantValue}$3`);
        }
        else {
            const insertLine = `define( '${constantName}', ${constantValue} );\n`;
            const marker = /\/\*.*?That's all.*?\*\//i;
            if (marker.test(fileContent)) {
                fileContent = fileContent.replace(marker, `${insertLine}$&`);
            }
            else {
                const settingsLine = /require_once.*wp-settings\.php/;
                if (settingsLine.test(fileContent)) {
                    fileContent = fileContent.replace(settingsLine, `${insertLine}$&`);
                }
                else {
                    fileContent += `\n${insertLine}`;
                }
            }
        }
        yield (0, promises_1.writeFile)(configPath, fileContent, 'utf-8');
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
    });
}
// ── Helpers ────────────────────────────────────────────────────────────
function parseDefineConstants(content) {
    const constants = {};
    const regex = /define\s*\(\s*['"]([^'"]+)['"]\s*,\s*([^)]+?)\s*\)\s*;/g;
    let match;
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
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
//# sourceMappingURL=config.js.map