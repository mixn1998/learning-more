// @ts-check
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    '.git/**',
    '.corepack/**',
    '.pnpm-home/**',
    '.npm-cache/**',
    '.superpowers/**',
    'coverage/**',
    'dist/**',
    'docs/**',
    'node_modules/**',
    'playwright-report/**',
    'test-results/**',
  ]),
  {
    files: ['**/*.{js,cjs,mjs}'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
);
