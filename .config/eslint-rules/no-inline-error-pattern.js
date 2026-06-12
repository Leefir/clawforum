/**
 * Custom ESLint rule: no-inline-error-pattern
 *
 * 应然：caller 必经 formatErr canonical helper (foundation/utils/format)、
 * 不退化为 inline error 处理模式 `e instanceof Error ? e.message : String(e)` /
 * `.message [||/??] String()`.
 *
 * phase 309 cluster C-typed-discriminator 前置 infra / B 类编译期/lint 期强 enforce
 * 替代 grep ratchet (phase 17 historical anchor)
 */

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: '禁止 caller 写 inline error 处理模式、必经 formatErr canonical helper',
      category: 'Best Practices',
    },
    schema: [],
    messages: {
      inlineError: 'Inline error pattern detected. Use formatErr from foundation/utils/format instead. Found: {{snippet}}',
    },
  },

  create(context) {
    return {
      // pattern 1: `e instanceof Error ? e.message : String(e)`
      ConditionalExpression(node) {
        const test = node.test;
        if (
          test.type === 'BinaryExpression' &&
          test.operator === 'instanceof' &&
          test.right.type === 'Identifier' &&
          test.right.name === 'Error'
        ) {
          const consequent = node.consequent;
          const alternate = node.alternate;
          if (
            consequent.type === 'MemberExpression' &&
            consequent.property.type === 'Identifier' &&
            consequent.property.name === 'message' &&
            alternate.type === 'CallExpression' &&
            alternate.callee.type === 'Identifier' &&
            alternate.callee.name === 'String'
          ) {
            context.report({
              node,
              messageId: 'inlineError',
              data: { snippet: 'instanceof Error ? .message : String()' },
            });
          }
        }
      },

      // pattern 2: `e.message || String(e)` / `e.message ?? String(e)`
      LogicalExpression(node) {
        if (node.operator !== '||' && node.operator !== '??') return;
        const left = node.left;
        const right = node.right;
        if (
          left.type === 'MemberExpression' &&
          left.property.type === 'Identifier' &&
          left.property.name === 'message' &&
          right.type === 'CallExpression' &&
          right.callee.type === 'Identifier' &&
          right.callee.name === 'String'
        ) {
          context.report({
            node,
            messageId: 'inlineError',
            data: { snippet: `.message ${node.operator} String()` },
          });
        }
      },
    };
  },
};
