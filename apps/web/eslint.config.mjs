// Flat config (ESLint 9) — replaces .eslintrc.json + deprecated `next lint`
// (removed in Next 16). CR.15 of the 2026-06-09 review.
//
// Two layers:
//   1. next/core-web-vitals via FlatCompat — eslint-config-next still ships
//      eslintrc-style presets.
//   2. @typescript-eslint recommended + recommended-type-checked, scoped to
//      ts/tsx with projectService so typed rules (await-thenable etc.)
//      actually get type information — the old setup crashed on the first
//      file because the root config enabled typed rules with no project.
// Rule overrides mirror the root .eslintrc.json so web code answers to the
// same law as packages/.

import { FlatCompat } from '@eslint/eslintrc';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const baseDirectory = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory });

const typescriptPresets = compat
  .extends(
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-type-checked',
  )
  .map((config) => ({
    ...config,
    files: ['**/*.ts', '**/*.tsx'],
  }));

const config = [
  {
    ignores: ['.next/**', 'out/**', 'node_modules/**', 'next-env.d.ts'],
  },
  ...compat.extends('next/core-web-vitals'),
  ...typescriptPresets,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: baseDirectory,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'react/no-unescaped-entities': 'off',
    },
  },
];

export default config;
