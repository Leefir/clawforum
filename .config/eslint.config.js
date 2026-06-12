import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import noInlineError from './eslint-rules/no-inline-error-pattern.js';

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        project: './tsconfig.json',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'chestnut-custom': {
        rules: {
          'no-inline-error-pattern': noInlineError,
        },
      },
    },
    rules: {
      // Minimal severity baseline: avoid noise during infra phase.
      // Recommended typescript-eslint rules are disabled to keep baseline lint clean.
      // Custom rules are enforced.
      'chestnut-custom/no-inline-error-pattern': 'error',
    },
  },
  {
    files: ['tests/**/*.ts'],
    languageOptions: { parser: tsParser },
    rules: {}, // tests are not checked by the inline-error rule
  },
];
