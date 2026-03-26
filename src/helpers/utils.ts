import * as path from 'path';
import { SiteConfig } from './site-config';
import { getPhpEnvironment } from './paths';

/**
 * Escapes special regex characters in a string so it can be used
 * as a literal pattern in a RegExp constructor.
 */
export function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build an env object for WP-CLI calls that includes MySQL binaries
 * and DB connection vars.
 */
export function buildWpCliEnv(config: SiteConfig): NodeJS.ProcessEnv {
	const mysqlBinDir = config.mysqlBin ? path.dirname(config.mysqlBin) : '';
	return {
		...process.env,
		...getPhpEnvironment(config.phpBin),
		...(config.phpIniDir ? { PHPRC: config.phpIniDir } : {}),
		PHP: config.phpBin,
		PATH: mysqlBinDir ? `${mysqlBinDir}${path.delimiter}${process.env.PATH || ''}` : process.env.PATH,
		// DB connection vars — used by native MySQL tools (mysql, mysqldump, mysqlcheck)
		...(config.dbSocket ? { MYSQL_UNIX_PORT: config.dbSocket } : {}),
		...(config.dbHost ? { MYSQL_HOST: config.dbHost } : {}),
		...(config.dbPort ? { MYSQL_TCP_PORT: String(config.dbPort) } : {}),
		MYSQL_PWD: config.dbPassword || '',
		DB_HOST: config.dbHost || 'localhost',
		DB_USER: config.dbUser || 'root',
		DB_PASSWORD: config.dbPassword || 'root',
		DB_NAME: config.dbName || 'local',
		...(config.dbSocket ? { DB_SOCKET: config.dbSocket } : {}),
		...(config.dbPort ? { DB_PORT: String(config.dbPort) } : {}),
	};
}
