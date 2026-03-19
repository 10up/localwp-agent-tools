import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs-extra';
import * as net from 'net';

const PORT_DIR = path.join(os.homedir(), '.local-agent-tools');
const PORT_FILE = path.join(PORT_DIR, 'port');
const DEFAULT_PORT = 24842;

function tryPort(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const server = net.createServer();
		server.once('error', () => resolve(false));
		server.once('listening', () => {
			server.close(() => resolve(true));
		});
		server.listen(port, '127.0.0.1');
	});
}

export async function findAvailablePort(preferred?: number, maxAttempts = 10): Promise<number> {
	// 1. Try reading saved port from previous session
	let savedPort: number | null = null;
	try {
		const content = await fs.readFile(PORT_FILE, 'utf-8');
		savedPort = parseInt(content.trim(), 10);
		if (isNaN(savedPort) || savedPort < 1024 || savedPort > 65535) {
			savedPort = null;
		}
	} catch {
		// No saved port file
	}

	if (savedPort && await tryPort(savedPort)) {
		return savedPort;
	}

	// 2. Try preferred port, then scan upward
	const startPort = preferred || DEFAULT_PORT;
	for (let i = 0; i < maxAttempts; i++) {
		const port = startPort + i;
		if (await tryPort(port)) {
			return port;
		}
	}

	throw new Error(`Could not find an available port after ${maxAttempts} attempts starting from ${startPort}`);
}

export async function savePort(port: number): Promise<void> {
	await fs.ensureDir(PORT_DIR, { mode: 0o700 });
	await fs.writeFile(PORT_FILE, String(port), 'utf-8');
}

export async function removePortFile(): Promise<void> {
	try {
		await fs.remove(PORT_FILE);
	} catch {
		// Best-effort cleanup
	}
}

export function removePortFileSync(): void {
	try {
		fs.removeSync(PORT_FILE);
	} catch {
		// Best-effort cleanup
	}
}
