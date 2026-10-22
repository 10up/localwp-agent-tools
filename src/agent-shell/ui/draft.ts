import type { Settings } from '../settings';

/**
 * Settings being edited in Preferences › Agent Tools. Local calls the pane's
 * onApply without arguments, so the pane keeps its edits here for onApply
 * to save.
 */
let draft: Settings | null = null;

export function getDraft(): Settings | null {
	return draft;
}

export function setDraft(settings: Settings | null): void {
	draft = settings;
}
