/**
 * SiteConfig — all the information a tool handler needs about a site.
 * Built from Local.Site data in main.ts, passed through to tool handlers.
 */
export interface SiteConfig {
	siteId: string;
	sitePath: string;
	wpPath: string;
	phpBin: string;
	phpIniDir: string | null;
	wpCliBin: string;
	mysqlBin: string;
	dbName: string;
	dbUser: string;
	dbPassword: string;
	dbSocket: string | null;
	dbPort: number;
	dbHost: string;
	siteDomain: string;
	siteUrl: string;
	logPath: string;
}

/**
 * In-memory registry of SiteConfigs for all sites that have Agent Tools enabled
 * and are currently running (or were running when configs were last built).
 */
export class SiteConfigRegistry {
	private configs = new Map<string, SiteConfig>();

	register(config: SiteConfig): void {
		this.configs.set(config.siteId, config);
	}

	unregister(siteId: string): void {
		this.configs.delete(siteId);
	}

	get(siteId: string): SiteConfig | undefined {
		return this.configs.get(siteId);
	}

	has(siteId: string): boolean {
		return this.configs.has(siteId);
	}

	getAll(): SiteConfig[] {
		return Array.from(this.configs.values());
	}

	getAllIds(): string[] {
		return Array.from(this.configs.keys());
	}
}
