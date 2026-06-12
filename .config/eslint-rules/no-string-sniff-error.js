/**
 * Custom ESLint rule: no-string-sniff-error
 *
 * 应然：caller 必经 `instanceof TypedError` 判别（M#9）/ 不退化为 `err.message.includes(...)` /
 * `err.message.match(...)` 字符串 sniff。
 *
 * phase 312 cluster C close 第 1 rule（替代 phase 1397 grep ratchet）
 */

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: '禁止 caller 用 err.message.includes() / .match() string sniff 替代 typed error class instanceof check',
      category: 'Best Practices',
    },
    schema: [],
    messages: {
      stringSniff: 'String sniff error.message detected: {{snippet}}. Use instanceof TypedError instead.',
    },
  },

  create(context) {
    return {
      // pattern: `<expr>.message.includes(<string-arg>)` / `<expr>.message.match(<regex-arg>)`
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression') return;
        if (callee.property.type !== 'Identifier') return;
        if (callee.property.name !== 'includes' && callee.property.name !== 'match') return;

        // callee.object 应是 MemberExpression `<expr>.message`
        const obj = callee.object;
        if (obj.type !== 'MemberExpression') return;
        if (obj.property.type !== 'Identifier') return;
        if (obj.property.name !== 'message') return;

        context.report({
          node,
          messageId: 'stringSniff',
          data: {
            snippet: `.message.${callee.property.name}(...)`,
          },
        });
      },
    };
  },
};
