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
exports.getLocalDataPath = getLocalDataPath;
exports.getLightningServicesPath = getLightningServicesPath;
exports.getRunPath = getRunPath;
exports.findPhpBinary = findPhpBinary;
exports.findMysqlBinary = findMysqlBinary;
exports.findMysqlSocket = findMysqlSocket;
exports.findWpCli = findWpCli;
exports.resolveSitePath = resolveSitePath;
exports.getLocalAppResourcesPath = getLocalAppResourcesPath;
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const fs = __importStar(require("fs-extra"));
/**
 * Returns the platform-specific path to the Local WP data directory.
 *
 * macOS:   ~/Library/Application Support/Local/
 * Windows: %APPDATA%\Local\
 * Linux:   ~/.config/Local/
 */
function getLocalDataPath() {
    switch (process.platform) {
        case 'darwin':
            return path.join(os.homedir(), 'Library', 'Application Support', 'Local');
        case 'win32':
            // Windows uses APPDATA; fall back to LOCALAPPDATA
            return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Local');
        case 'linux':
            return path.join(os.homedir(), '.config', 'Local');
        default:
            return path.join(os.homedir(), 'Library', 'Application Support', 'Local');
    }
}
/**
 * Returns the path to Local's lightning-services directory.
 *
 * Lightning-services are stored in two possible locations:
 * 1. Inside the Local app bundle (platform-specific, see getLocalAppResourcesPath())
 * 2. In the user data directory: {localDataPath}/lightning-services/
 *
 * The app bundle location is the primary one in modern Local versions.
 */
function getLightningServicesPath() {
    // Check all candidate app resource paths for a bundled lightning-services dir
    const appResourceCandidates = getLocalAppResourcesCandidates();
    for (const candidate of appResourceCandidates) {
        const bundledPath = path.join(candidate, 'lightning-services');
        if (fs.existsSync(bundledPath)) {
            return bundledPath;
        }
    }
    // Fall back to user data directory
    return path.join(getLocalDataPath(), 'lightning-services');
}
/**
 * Returns the path to Local's run directory for a specific site.
 * This directory contains runtime files like MySQL sockets.
 *
 * Structure: {localDataPath}/run/{siteId}/
 *   macOS:   ~/Library/Application Support/Local/run/{siteId}/
 *   Windows: %APPDATA%\Local\run\{siteId}\
 *   Linux:   ~/.config/Local/run/{siteId}/
 */
function getRunPath(siteId) {
    return path.join(getLocalDataPath(), 'run', siteId);
}
/**
 * Returns the platform-specific binary subdirectory name.
 *
 * macOS arm64:   darwin-arm64
 * macOS x86_64:  darwin-x64 (or legacy "darwin")
 * Windows x64:   win64
 * Windows x86:   win32
 * Linux:         linux
 *
 * Falls back to checking the filesystem when the expected directory
 * does not exist, since Local WP naming conventions may vary.
 */
function getBinaryPlatformDir() {
    if (process.platform === 'darwin') {
        return process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
    }
    if (process.platform === 'win32') {
        return process.arch === 'x64' ? 'win64' : 'win32';
    }
    return 'linux';
}
/**
 * Returns an array of candidate binary platform directory names to try,
 * in priority order. This handles variations in Local WP's directory naming.
 */
function getBinaryPlatformDirCandidates() {
    if (process.platform === 'darwin') {
        return process.arch === 'arm64'
            ? ['darwin-arm64', 'darwin']
            : ['darwin-x64', 'darwin'];
    }
    if (process.platform === 'win32') {
        return process.arch === 'x64'
            ? ['win64', 'win32']
            : ['win32'];
    }
    return ['linux'];
}
/**
 * Finds the directory for a lightning-service by name prefix and version.
 *
 * Lightning services are stored as directories named like:
 *   php-8.2.27+1
 *   mysql-8.0.35+4
 *
 * The version from the site config (e.g. "8.2.27") may not include the build
 * number ("+1"), so we need to glob for matching directories.
 *
 * @param serviceName  e.g. "php", "mysql", "mariadb"
 * @param version      e.g. "8.2.27", "8.0.35"
 * @returns The full path to the service directory, or null if not found
 */
function findServiceDir(serviceName, version) {
    return __awaiter(this, void 0, void 0, function* () {
        // Check both the app bundle AND user data lightning-services directories.
        // The bundled dir may not have newer PHP versions installed via Local's UI.
        const dirsToCheck = new Set();
        const appResourceCandidates = getLocalAppResourcesCandidates();
        for (const candidate of appResourceCandidates) {
            const bundledPath = path.join(candidate, 'lightning-services');
            if (fs.existsSync(bundledPath)) {
                dirsToCheck.add(bundledPath);
            }
        }
        const userDataPath = path.join(getLocalDataPath(), 'lightning-services');
        if (fs.existsSync(userDataPath)) {
            dirsToCheck.add(userDataPath);
        }
        // First pass: exact match across all directories.
        // This ensures an exact match in the user data dir isn't shadowed by a
        // fuzzy match in the bundled dir.
        const prefix = `${serviceName}-${version}`;
        for (const lightningDir of dirsToCheck) {
            try {
                const entries = yield fs.readdir(lightningDir);
                const match = entries.find(entry => entry === prefix || entry.startsWith(prefix + '+'));
                if (match) {
                    return path.join(lightningDir, match);
                }
            }
            catch (err) {
                // Directory doesn't exist or can't be read
            }
        }
        // Second pass: fuzzy match on major.minor version across all directories.
        // e.g. for version "8.2.23", also match "8.2.27+1" if exact match not found
        const majorMinor = version.split('.').slice(0, 2).join('.');
        const fuzzyPrefix = `${serviceName}-${majorMinor}`;
        for (const lightningDir of dirsToCheck) {
            try {
                const entries = yield fs.readdir(lightningDir);
                const fuzzyMatch = entries
                    .filter(entry => entry.startsWith(fuzzyPrefix))
                    .sort()
                    .pop(); // Take the latest version
                if (fuzzyMatch) {
                    return path.join(lightningDir, fuzzyMatch);
                }
            }
            catch (err) {
                // Directory doesn't exist or can't be read
            }
        }
        return null;
    });
}
/**
 * Returns the platform-specific executable name for a binary.
 * On Windows, executables have the .exe extension.
 */
function getExecutableName(baseName) {
    return process.platform === 'win32' ? `${baseName}.exe` : baseName;
}
/**
 * Finds the PHP binary for a given version.
 *
 * Path structure:
 *   lightning-services/php-{version}+{build}/bin/{platform}/bin/php[.exe]
 *
 * @param phpVersion  e.g. "8.2.27"
 * @returns Full path to the PHP binary, or null if not found
 */
function findPhpBinary(phpVersion) {
    return __awaiter(this, void 0, void 0, function* () {
        const serviceDir = yield findServiceDir('php', phpVersion);
        if (!serviceDir)
            return null;
        const phpExe = getExecutableName('php');
        const platformDirs = getBinaryPlatformDirCandidates();
        for (const platformDir of platformDirs) {
            // Standard nested bin/ structure: bin/{platform}/bin/php
            const phpBin = path.join(serviceDir, 'bin', platformDir, 'bin', phpExe);
            if (yield fs.pathExists(phpBin)) {
                return phpBin;
            }
            // Some older versions may not have the nested bin/ structure
            const altPhpBin = path.join(serviceDir, 'bin', platformDir, phpExe);
            if (yield fs.pathExists(altPhpBin)) {
                return altPhpBin;
            }
        }
        return null;
    });
}
/**
 * Finds the MySQL (or MariaDB) binary for a given version.
 *
 * Path structure:
 *   lightning-services/mysql-{version}+{build}/bin/{platform}/bin/mysql[.exe]
 *
 * Also checks for MariaDB if MySQL is not found.
 *
 * @param mysqlVersion  e.g. "8.0.35"
 * @param serviceName   "mysql" or "mariadb" — defaults to "mysql"
 * @returns Full path to the MySQL binary, or null if not found
 */
function findMysqlBinary(mysqlVersion_1) {
    return __awaiter(this, arguments, void 0, function* (mysqlVersion, serviceName = 'mysql') {
        const serviceDir = yield findServiceDir(serviceName, mysqlVersion);
        if (!serviceDir) {
            // If looking for mysql failed, try mariadb (and vice versa)
            if (serviceName === 'mysql') {
                return findMysqlBinary(mysqlVersion, 'mariadb');
            }
            return null;
        }
        const mysqlExe = getExecutableName('mysql');
        const platformDirs = getBinaryPlatformDirCandidates();
        for (const platformDir of platformDirs) {
            const mysqlBin = path.join(serviceDir, 'bin', platformDir, 'bin', mysqlExe);
            if (yield fs.pathExists(mysqlBin)) {
                return mysqlBin;
            }
        }
        return null;
    });
}
/**
 * Returns the MySQL socket path for a given site.
 *
 * Path structure:
 *   macOS:  ~/Library/Application Support/Local/run/{siteId}/mysql/mysqld.sock
 *   Linux:  ~/.config/Local/run/{siteId}/mysql/mysqld.sock
 *
 * Note: On Windows, MySQL uses TCP instead of sockets (127.0.0.1 with port).
 * This function returns null on Windows.
 *
 * @param siteId  The Local WP site ID
 * @returns Full path to the socket, or null on Windows/if not found
 */
function findMysqlSocket(siteId) {
    // Windows doesn't use Unix sockets for MySQL — use TCP (127.0.0.1:port) instead
    if (process.platform === 'win32') {
        return null;
    }
    return path.join(getRunPath(siteId), 'mysql', 'mysqld.sock');
}
/**
 * Tries to find WP-CLI. Checks multiple locations in priority order:
 *
 * 1. Bundled with Local app (platform-specific extraResources path)
 * 2. In the PHP service's bin directory
 * 3. In the user data directory
 * 4. System-wide locations (platform-specific)
 *
 * @param phpVersion  The PHP version to check for a co-located wp-cli.phar
 * @returns Full path to WP-CLI, or null if not found
 */
function findWpCli(phpVersion) {
    return __awaiter(this, void 0, void 0, function* () {
        // 1. Check Local app bundled WP-CLI (most reliable)
        const appResourceCandidates = getLocalAppResourcesCandidates();
        for (const resourcePath of appResourceCandidates) {
            const wpCliPath = path.join(resourcePath, 'bin', 'wp-cli', 'wp-cli.phar');
            if (yield fs.pathExists(wpCliPath)) {
                return wpCliPath;
            }
        }
        // 2. Check in the PHP service bin directory
        if (phpVersion) {
            const phpServiceDir = yield findServiceDir('php', phpVersion);
            if (phpServiceDir) {
                const platformDirs = getBinaryPlatformDirCandidates();
                for (const platformDir of platformDirs) {
                    const wpCliInPhp = path.join(phpServiceDir, 'bin', platformDir, 'bin', 'wp-cli.phar');
                    if (yield fs.pathExists(wpCliInPhp)) {
                        return wpCliInPhp;
                    }
                    const wpInPhp = path.join(phpServiceDir, 'bin', platformDir, 'bin', 'wp');
                    if (yield fs.pathExists(wpInPhp)) {
                        return wpInPhp;
                    }
                }
            }
        }
        // 3. Check user data directory
        const userDataWpCli = path.join(getLocalDataPath(), 'bin', 'wp-cli', 'wp-cli.phar');
        if (yield fs.pathExists(userDataWpCli)) {
            return userDataWpCli;
        }
        // 4. Check common system locations (platform-specific)
        const systemLocations = getSystemWpCliLocations();
        for (const loc of systemLocations) {
            if (yield fs.pathExists(loc)) {
                return loc;
            }
        }
        return null;
    });
}
/**
 * Returns platform-specific system locations where WP-CLI might be installed.
 */
function getSystemWpCliLocations() {
    const home = os.homedir();
    if (process.platform === 'win32') {
        return [
            path.join(home, '.wp-cli', 'wp-cli.phar'),
            path.join(home, 'bin', 'wp-cli.phar'),
            // Composer global install location
            path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Composer', 'vendor', 'bin', 'wp'),
            // Scoop, Chocolatey, etc.
            'C:\\ProgramData\\chocolatey\\bin\\wp.bat',
        ];
    }
    // macOS and Linux
    return [
        '/usr/local/bin/wp',
        '/opt/homebrew/bin/wp',
        '/usr/bin/wp',
        '/snap/bin/wp',
        path.join(home, '.wp-cli', 'wp-cli.phar'),
        path.join(home, 'bin', 'wp'),
        path.join(home, '.local', 'bin', 'wp'),
        path.join(home, '.composer', 'vendor', 'bin', 'wp'),
    ];
}
/**
 * Resolves the site path, expanding ~ to the home directory if needed.
 * The site.path from Local WP may use ~ (e.g. "~/Local Sites/my-site")
 * but site.longPath should contain the resolved path.
 *
 * @param sitePath  The path from site.path or site.longPath
 * @returns The resolved absolute path
 */
function resolveSitePath(sitePath) {
    if (sitePath.startsWith('~')) {
        return path.join(os.homedir(), sitePath.slice(1));
    }
    return sitePath;
}
/**
 * Returns candidate paths for Local WP's extraResources directory, in priority order.
 * Multiple candidates are returned because the install location varies by platform
 * and installation method.
 *
 * macOS:   /Applications/Local.app/Contents/Resources/extraResources/
 * Windows: C:\Program Files (x86)\Local\resources\extraResources\
 *          %LOCALAPPDATA%\Programs\local\resources\extraResources\
 * Linux:   /opt/Local/resources/extraResources/
 *          ~/.local/share/Local/resources/extraResources/
 */
function getLocalAppResourcesCandidates() {
    const home = os.homedir();
    switch (process.platform) {
        case 'darwin':
            return [
                '/Applications/Local.app/Contents/Resources/extraResources',
            ];
        case 'win32': {
            const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
            return [
                path.join('C:', 'Program Files (x86)', 'Local', 'resources', 'extraResources'),
                path.join('C:', 'Program Files', 'Local', 'resources', 'extraResources'),
                path.join(localAppData, 'Programs', 'local', 'resources', 'extraResources'),
            ];
        }
        case 'linux':
            return [
                path.join('/opt', 'Local', 'resources', 'extraResources'),
                path.join(home, '.local', 'share', 'Local', 'resources', 'extraResources'),
            ];
        default:
            return [];
    }
}
/**
 * Returns the path to the Local app's extraResources directory.
 * Used for finding bundled resources like WP-CLI and lightning-services.
 *
 * @returns Path to the extraResources directory, or null if not found
 */
function getLocalAppResourcesPath() {
    const candidates = getLocalAppResourcesCandidates();
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return null;
}
//# sourceMappingURL=paths.js.map