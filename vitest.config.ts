import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['tests/**/*.test.ts'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json-summary', 'json'],
			reportOnFailure: true,
			include: ['src/**/*.ts'],
			exclude: [
				'src/renderer.tsx',
				'src/main.ts',
				'src/helpers/port.ts',
				'src/tools/environment.ts',
				'src/tools/site.ts',
			],
			thresholds: {
				lines: 40,
				functions: 40,
				branches: 25,
				statements: 40,
			},
		},
	},
});
