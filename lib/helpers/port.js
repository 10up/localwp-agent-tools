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
exports.findAvailablePort = findAvailablePort;
exports.savePort = savePort;
exports.removePortFile = removePortFile;
exports.removePortFileSync = removePortFileSync;
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const fs = __importStar(require("fs-extra"));
const net = __importStar(require("net"));
const PORT_DIR = path.join(os.homedir(), '.local-agent-tools');
const PORT_FILE = path.join(PORT_DIR, 'port');
const DEFAULT_PORT = 24842;
function tryPort(port) {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => {
            server.close(() => resolve(true));
        });
        server.listen(port, '127.0.0.1');
    });
}
function findAvailablePort(preferred_1) {
    return __awaiter(this, arguments, void 0, function* (preferred, maxAttempts = 10) {
        // 1. Try reading saved port from previous session
        let savedPort = null;
        try {
            const content = yield fs.readFile(PORT_FILE, 'utf-8');
            savedPort = parseInt(content.trim(), 10);
            if (isNaN(savedPort) || savedPort < 1024 || savedPort > 65535) {
                savedPort = null;
            }
        }
        catch (_a) {
            // No saved port file
        }
        if (savedPort && (yield tryPort(savedPort))) {
            return savedPort;
        }
        // 2. Try preferred port, then scan upward
        const startPort = preferred || DEFAULT_PORT;
        for (let i = 0; i < maxAttempts; i++) {
            const port = startPort + i;
            if (yield tryPort(port)) {
                return port;
            }
        }
        throw new Error(`Could not find an available port after ${maxAttempts} attempts starting from ${startPort}`);
    });
}
function savePort(port) {
    return __awaiter(this, void 0, void 0, function* () {
        yield fs.ensureDir(PORT_DIR, { mode: 0o700 });
        yield fs.writeFile(PORT_FILE, String(port), 'utf-8');
    });
}
function removePortFile() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield fs.remove(PORT_FILE);
        }
        catch (_a) {
            // Best-effort cleanup
        }
    });
}
function removePortFileSync() {
    try {
        fs.removeSync(PORT_FILE);
    }
    catch (_a) {
        // Best-effort cleanup
    }
}
//# sourceMappingURL=port.js.map