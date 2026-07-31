import { defineConfig } from 'vitest/config';

process.env.TZ ??= 'Asia/Shanghai';

export default defineConfig({
  test: {
    include: [
      'apps/**/*.test.{ts,tsx}',
      'packages/**/*.test.{ts,tsx}',
      'operations/**/*.test.{ts,mjs}',
      'engineering/**/*.test.{ts,mjs}',
    ],
    passWithNoTests: true,
  },
});
