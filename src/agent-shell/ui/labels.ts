import { instanceLabel, type Settings } from '../settings';

export const SHELL_LABEL = 'None (plain shell)';

/** Options for choosing an agent: the plain shell and each Claude instance, keyed by 'shell' or instance id. */
export function agentOptions(settings: Settings): Record<string, string> {
	const options: Record<string, string> = { shell: SHELL_LABEL };
	for (const instance of settings.instances) {
		options[instance.id] = instanceLabel(instance);
	}
	return options;
}

export function agentLabel(settings: Settings, choice: string): string {
	const options = agentOptions(settings);
	return options[choice] ?? SHELL_LABEL;
}
