import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs-extra';
import * as path from 'path';

const execFileAsync = promisify(execFile);

interface CopyTreeOptions {
	exclude?: string[];
	intoExisting?: boolean;
}

export async function copyTree(
	src: string,
	dest: string,
	opts: CopyTreeOptions = {},
): Promise<{ method: 'clonefile' | 'copy' }> {
	const exclude = new Set(['.DS_Store', ...(opts.exclude || [])]);

	if (process.platform === 'darwin' && (!opts.exclude || opts.exclude.length === 0)) {
		try {
			const copySource = opts.intoExisting ? `${src}${path.sep}.` : src;
			await execFileAsync('/bin/cp', ['-Rc', copySource, dest]);
			return { method: 'clonefile' };
		} catch {
			// Fall through when clonefile is unavailable, including cross-volume copies.
		}
	}

	await fs.copy(src, dest, {
		filter: (source) => !exclude.has(path.basename(source)),
	});

	return { method: 'copy' };
}

/**
 * Re-point absolute symlinks that still target the source tree a copy was made
 * from (e.g. Query Monitor's wp-content/db.php) at the equivalent path inside
 * the copy. Relative symlinks already resolve within the copy and are left alone.
 */
export async function retargetSymlinks(root: string, fromPrefix: string, toPrefix: string): Promise<number> {
	const skip = new Set(['node_modules', '.git']);
	let retargeted = 0;

	async function walk(dir: string): Promise<void> {
		let entries;
		try {
			entries = await fs.readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);
			if (entry.isSymbolicLink()) {
				try {
					const target = await fs.readlink(fullPath);
					if (target.startsWith(fromPrefix)) {
						const newTarget = toPrefix + target.slice(fromPrefix.length);
						await fs.remove(fullPath);
						await fs.symlink(newTarget, fullPath);
						retargeted += 1;
					}
				} catch {
					// Leave unreadable/broken links alone
				}
			} else if (entry.isDirectory() && !skip.has(entry.name)) {
				await walk(fullPath);
			}
		}
	}

	await walk(root);
	return retargeted;
}
