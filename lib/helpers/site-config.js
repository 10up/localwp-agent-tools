"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SiteConfigRegistry = void 0;
/**
 * In-memory registry of SiteConfigs for all sites that have Agent Tools enabled
 * and are currently running (or were running when configs were last built).
 */
class SiteConfigRegistry {
    constructor() {
        this.configs = new Map();
    }
    register(config) {
        this.configs.set(config.siteId, config);
    }
    unregister(siteId) {
        this.configs.delete(siteId);
    }
    get(siteId) {
        return this.configs.get(siteId);
    }
    has(siteId) {
        return this.configs.has(siteId);
    }
    getAll() {
        return Array.from(this.configs.values());
    }
    getAllIds() {
        return Array.from(this.configs.keys());
    }
}
exports.SiteConfigRegistry = SiteConfigRegistry;
//# sourceMappingURL=site-config.js.map