/**
 * Custom ESLint rule: cron-test-must-use-fake-timers
 *
 * 应然 (phase 1238): cron unit test 必含 `vi.useFakeTimers()` 防 wall-clock +
 * computeRunKey block boundary race (phase 1232 dev-time interval:100ms race
 * fix + 5 latent site refactor 同根 cluster)。
 *
 * scope: tests/core/cron/(runner|handler-).+\.test\.ts$
 * exception: tests/core/cron/handler-signal-cascade-invariant.test.ts
 *   (phase 1266: lint grep assemble.ts + jobs type signature, 0 runner runtime)
 *
 * phase 328 cluster test-setup-helper close 替代 phase 1238 grep ratchet
 * 共享 phase 309 ESLint infra / phase 312/315/322/327 模板
 */

const FILENAME_PATTERN = /tests\/core\/cron\/(runner|handler-).+\.test\.ts$/;
const EXCEPTION_SUFFIX = 'tests/core/cron/handler-signal-cascade-invariant.test.ts';

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'cron unit test must call vi.useFakeTimers() (phase 1238 wall-clock race防 invariant)',
      category: 'Best Practices',
    },
    schema: [],
    messages: {
      missingFakeTimers:
        'cron runtime test must call vi.useFakeTimers() (phase 1238 race防). Fix: add `vi.useFakeTimers()` in beforeEach/beforeAll + `vi.useRealTimers()` cleanup. Or add file to EXCEPTION_SUFFIX if pure parser/lint test.',
    },
  },

  create(context) {
    const filename = context.filename || '';

    // scope check: filename match (runner|handler-).+\.test\.ts in tests/core/cron/
    if (!FILENAME_PATTERN.test(filename)) return {};

    // exception
    if (filename.endsWith(EXCEPTION_SUFFIX)) return {};

    let hasUseFakeTimers = false;

    return {
      // pattern: `vi.useFakeTimers(...)` CallExpression
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type === 'MemberExpression' &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'vi' &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'useFakeTimers'
        ) {
          hasUseFakeTimers = true;
        }
      },

      'Program:exit'(node) {
        if (!hasUseFakeTimers) {
          context.report({ node, messageId: 'missingFakeTimers' });
        }
      },
    };
  },
};
