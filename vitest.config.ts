import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/**/*.test.{ts,tsx}', 'packages/**/*.test.{ts,tsx}', 'tools/**/*.test.ts'],
    passWithNoTests: true,
  },
});
