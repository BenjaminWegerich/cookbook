import { defineConfig } from 'vitest/config';

// Test configuration for the core module.
// `dist` must be excluded: the build output is emitted into this directory
// and would otherwise be picked up by Vitest (duplicate test runs).
export default defineConfig({
  test: {
    exclude: ['dist/**', 'node_modules/**'],
  },
});
