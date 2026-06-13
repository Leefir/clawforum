import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import noInlineError from './eslint-rules/no-inline-error-pattern.js';
import noStringSniffError from './eslint-rules/no-string-sniff-error.js';
import noDirectProcessExitInCli from './eslint-rules/no-direct-process-exit-in-cli.js';
import noDirectErrnoCodeCompare from './eslint-rules/no-direct-errno-code-compare.js';
import noHardcodedInboxPath from './eslint-rules/no-hardcoded-inbox-path.js';
import noDirectFsWriteatomicToInbox from './eslint-rules/no-direct-fs-writeatomic-to-inbox.js';
import noPermManagementInCommandTool from './eslint-rules/no-perm-management-in-command-tool.js';
import noClawdirPathAntiPattern from './eslint-rules/no-clawdir-path-anti-pattern.js';
import noStringAnchorChestnut from './eslint-rules/no-string-anchor-chestnut.js';
import noDeriveChestnutRoot from './eslint-rules/no-derive-chestnut-root.js';
import cronTestMustUseFakeTimers from './eslint-rules/cron-test-must-use-fake-timers.js';
import formatterParityRequireConstants from './eslint-rules/formatter-parity-require-constants.js';
import foundationNoBusinessRoleLiteral from './eslint-rules/foundation-no-business-role-literal.js';
import auditCapConstScope from './eslint-rules/audit-cap-const-scope.js';
import foundationNoCliVerbFact from './eslint-rules/foundation-no-cli-verb-fact.js';

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
          'no-string-sniff-error': noStringSniffError,
          'no-direct-process-exit-in-cli': noDirectProcessExitInCli,
          'no-direct-errno-code-compare': noDirectErrnoCodeCompare,
          'no-hardcoded-inbox-path': noHardcodedInboxPath,
          'no-direct-fs-writeatomic-to-inbox': noDirectFsWriteatomicToInbox,
          'no-perm-management-in-command-tool': noPermManagementInCommandTool,
          'no-clawdir-path-anti-pattern': noClawdirPathAntiPattern,
          'no-string-anchor-chestnut': noStringAnchorChestnut,
          'no-derive-chestnut-root': noDeriveChestnutRoot,
          'formatter-parity-require-constants': formatterParityRequireConstants,
          'foundation-no-business-role-literal': foundationNoBusinessRoleLiteral,
          'audit-cap-const-scope': auditCapConstScope,
          'foundation-no-cli-verb-fact': foundationNoCliVerbFact,
        },
      },
    },
    rules: {
      // Minimal severity baseline: avoid noise during infra phase.
      // Recommended typescript-eslint rules are disabled to keep baseline lint clean.
      // Custom rules are enforced.
      'chestnut-custom/no-inline-error-pattern': 'error',
      'chestnut-custom/no-string-sniff-error': 'error',
      'chestnut-custom/no-direct-process-exit-in-cli': 'error',
      'chestnut-custom/no-direct-errno-code-compare': 'error',
      'chestnut-custom/no-hardcoded-inbox-path': 'error',
      'chestnut-custom/no-direct-fs-writeatomic-to-inbox': 'error',
      'chestnut-custom/no-perm-management-in-command-tool': 'error',
      'chestnut-custom/no-clawdir-path-anti-pattern': 'error',
      'chestnut-custom/no-string-anchor-chestnut': 'error',
      'chestnut-custom/no-derive-chestnut-root': 'error',
      'chestnut-custom/formatter-parity-require-constants': 'error',
      'chestnut-custom/foundation-no-business-role-literal': 'error',
      'chestnut-custom/audit-cap-const-scope': 'error',
      'chestnut-custom/foundation-no-cli-verb-fact': 'error',
    },
  },
  {
    // tests/ block: only test-setup-helper rules enforced (rules targeting test files)
    files: ['tests/**/*.ts'],
    languageOptions: { parser: tsParser },
    plugins: {
      '@typescript-eslint': tsPlugin,  // register so inline `eslint-disable` directives don't error
      'chestnut-custom': {
        rules: {
          'cron-test-must-use-fake-timers': cronTestMustUseFakeTimers,
        },
      },
    },
    rules: {
      // src-rules (inline-error, etc.) are not checked in tests/.
      'chestnut-custom/cron-test-must-use-fake-timers': 'error',
    },
    linterOptions: {
      // tests/ accumulated many inline `eslint-disable` directives for rules not enforced here.
      // Suppress "unused directive" warnings to keep baseline clean.
      reportUnusedDisableDirectives: 'off',
    },
  },
];
