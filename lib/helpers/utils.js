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
Object.defineProperty(exports, "__esModule", { value: true });
exports.escapeRegex = escapeRegex;
exports.buildWpCliEnv = buildWpCliEnv;
const path = __importStar(require("path"));
const paths_1 = require("./paths");
/**
 * Escapes special regex characters in a string so it can be used
 * as a literal pattern in a RegExp constructor.
 */
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/**
 * Build an env object for WP-CLI calls that includes MySQL binaries
 * and DB connection vars.
 */
function buildWpCliEnv(config) {
    const mysqlBinDir = config.mysqlBin ? path.dirname(config.mysqlBin) : '';
    return Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({}, process.env), (0, paths_1.getPhpEnvironment)(config.phpBin)), { PHP: config.phpBin, PATH: mysqlBinDir ? `${mysqlBinDir}${path.delimiter}${process.env.PATH || ''}` : process.env.PATH }), (config.dbSocket ? { MYSQL_UNIX_PORT: config.dbSocket } : {})), (config.dbHost ? { MYSQL_HOST: config.dbHost } : {})), (config.dbPort ? { MYSQL_TCP_PORT: String(config.dbPort) } : {})), { MYSQL_PWD: config.dbPassword || '', DB_HOST: config.dbHost || 'localhost', DB_USER: config.dbUser || 'root', DB_PASSWORD: config.dbPassword || 'root', DB_NAME: config.dbName || 'local' }), (config.dbSocket ? { DB_SOCKET: config.dbSocket } : {})), (config.dbPort ? { DB_PORT: String(config.dbPort) } : {}));
}
//# sourceMappingURL=utils.js.map