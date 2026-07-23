import { defineConfig } from 'vitest/config';

process.env.TZ ??= 'Asia/Shanghai';

export default defineConfig({
  test: {
    include: [
      'apps/**/*.test.{ts,tsx}',
      'packages/**/*.test.{ts,tsx}',
      'tools/**/*.test.{ts,mjs}',
      'tests/**/*.test.{ts,tsx}',
    ],
    passWithNoTests: true,
  },
});
