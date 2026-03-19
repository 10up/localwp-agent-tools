/**
 * Escapes special regex characters in a string so it can be used
 * as a literal pattern in a RegExp constructor.
 */
export function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
