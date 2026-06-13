import { describe, it } from 'vitest';
import { RuleTester } from 'eslint';
import cronTestMustUseFakeTimers from '../../../.config/eslint-rules/cron-test-must-use-fake-timers.js';

const ruleTester = new RuleTester({
  languageOptions: { parserOptions: { ecmaVersion: 'latest', sourceType: 'module' } },
});

describe('eslint custom rule: cron-test-must-use-fake-timers (phase 328)', () => {
  ruleTester.run('cron-test-must-use-fake-timers', cronTestMustUseFakeTimers, {
    valid: [
      // out of scope (not cron test)
      { code: 'describe("foo", () => {});', filename: 'tests/core/contract/foo.test.ts' },
      { code: 'describe("foo", () => {});', filename: 'tests/foundation/file-tool/read.test.ts' },
      // out of scope (cron but not runner/handler-)
      { code: 'describe("parse", () => {});', filename: 'tests/core/cron/parse-schedule-unit.test.ts' },
      // in scope + uses vi.useFakeTimers
      {
        code: 'import { vi, beforeEach } from "vitest"; beforeEach(() => { vi.useFakeTimers(); });',
        filename: 'tests/core/cron/runner-abort-signal.test.ts',
      },
      {
        code: 'import { vi } from "vitest"; vi.useFakeTimers();',
        filename: 'tests/core/cron/handler-sync-throw.test.ts',
      },
      // exception
      {
        code: 'describe("lint grep", () => {});',
        filename: 'tests/core/cron/handler-signal-cascade-invariant.test.ts',
      },
    ],
    invalid: [
      // runner test missing vi.useFakeTimers
      {
        code: 'import { describe } from "vitest"; describe("foo", () => {});',
        filename: 'tests/core/cron/runner-abort-signal.test.ts',
        errors: [{ messageId: 'missingFakeTimers' }],
      },
      // handler- test missing vi.useFakeTimers
      {
        code: 'import { describe } from "vitest"; describe("foo", () => {});',
        filename: 'tests/core/cron/handler-sync-throw.test.ts',
        errors: [{ messageId: 'missingFakeTimers' }],
      },
      // vi.useRealTimers but not useFakeTimers
      {
        code: 'import { vi } from "vitest"; vi.useRealTimers();',
        filename: 'tests/core/cron/runner-timeout.test.ts',
        errors: [{ messageId: 'missingFakeTimers' }],
      },
    ],
  });

  it('rule loaded', () => {});
});
