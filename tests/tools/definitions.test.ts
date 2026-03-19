import { describe, it, expect } from 'vitest';
import { allToolDefinitions } from '../../src/tools/index';

describe('Tool definitions snapshot', () => {
	it('matches the expected tool API surface', () => {
		// Snapshot the tool names and schemas to detect accidental API changes.
		// Run `vitest -u` to update when changes are intentional.
		const surface = allToolDefinitions.map((t) => ({
			name: t.name,
			inputSchema: t.inputSchema,
		}));
		expect(surface).toMatchSnapshot();
	});

	it('tool descriptions match snapshot', () => {
		const descriptions = allToolDefinitions.map((t) => ({
			name: t.name,
			description: t.description,
		}));
		expect(descriptions).toMatchSnapshot();
	});
});
