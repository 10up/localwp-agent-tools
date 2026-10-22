import { randomUUID } from 'crypto';

export type Destination = 'herdr' | 'ghostty' | 'custom';

export type EnvVar = { name: string; value: string };

export type Instance = {
	id: string;
	name: string;
	binary: string;
	configDir: string;
	args: string;
	env: EnvVar[];
};

/** 'shell' or an instance id. */
export type OpenChoice = string;

/** 'default', 'shell' or an instance id. */
export type SiteOverride = string;

export type Settings = {
	destination: Destination;
	customCommand: string;
	defaultOpen: OpenChoice;
	instances: Instance[];
};

export const DESTINATIONS: readonly Destination[] = ['herdr', 'ghostty', 'custom'];

/** Claude Code with its own default configuration (CLAUDE_CONFIG_DIR unset, so ~/.claude). */
const CLAUDE_INSTANCE: Instance = { id: 'claude', name: 'Claude', binary: 'claude', configDir: '', args: '', env: [] };

export const DEFAULT_SETTINGS: Settings = {
	destination: 'herdr',
	customCommand: '',
	defaultOpen: CLAUDE_INSTANCE.id,
	instances: [CLAUDE_INSTANCE],
};

/**
 * Turns stored or user-submitted settings into a complete, valid Settings
 * object. Settings that were never saved have no instances list and start
 * with the default Claude instance; a saved empty list stays empty.
 */
export function normalizeSettings(raw: unknown): Settings {
	const source = isRecord(raw) ? raw : {};
	const destination = DESTINATIONS.find((value) => value === source.destination) ?? DEFAULT_SETTINGS.destination;
	const instances = Array.isArray(source.instances)
		? source.instances.flatMap(normalizeInstance)
		: DEFAULT_SETTINGS.instances.map((instance) => ({ ...instance, env: [...instance.env] }));

	return {
		destination,
		customCommand: stringOr(source.customCommand, DEFAULT_SETTINGS.customCommand),
		defaultOpen: stringOr(source.defaultOpen, DEFAULT_SETTINGS.defaultOpen),
		instances,
	};
}

/**
 * Picks what the button opens for a site: the site's override, else the
 * global default. Returns null for the shell. An override or default naming
 * a deleted instance falls back to the default, then to the shell.
 */
export function resolveOpen(settings: Settings, override: SiteOverride | undefined): Instance | null {
	const choice = override === undefined || override === 'default' ? settings.defaultOpen : override;
	if (choice === 'shell') return null;

	const chosen = findInstance(settings, choice);
	if (chosen) return chosen;

	return findInstance(settings, settings.defaultOpen);
}

/** The name shown for an instance in lists, menus and tab labels. */
export function instanceLabel(instance: Instance): string {
	const name = instance.name.trim();
	return name === '' ? 'Unnamed instance' : name;
}

export function newInstanceId(): string {
	return randomUUID();
}

export function sitesUsing(instanceId: string, overrides: Array<SiteOverride | undefined>): number {
	return overrides.filter((override) => override === instanceId).length;
}

function findInstance(settings: Settings, id: string): Instance | null {
	return settings.instances.find((instance) => instance.id === id) ?? null;
}

function normalizeInstance(raw: unknown): Instance[] {
	if (!isRecord(raw)) return [];
	if (typeof raw.id !== 'string' || typeof raw.name !== 'string') return [];

	const env = Array.isArray(raw.env) ? raw.env.flatMap(normalizeEnvVar) : [];

	return [
		{
			id: raw.id,
			name: raw.name,
			binary: stringOr(raw.binary, 'claude'),
			configDir: stringOr(raw.configDir, ''),
			args: stringOr(raw.args, ''),
			env,
		},
	];
}

function normalizeEnvVar(raw: unknown): EnvVar[] {
	if (!isRecord(raw)) return [];
	if (typeof raw.name !== 'string' || raw.name === '') return [];

	return [{ name: raw.name, value: stringOr(raw.value, '') }];
}

function stringOr(value: unknown, fallback: string): string {
	return typeof value === 'string' ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
