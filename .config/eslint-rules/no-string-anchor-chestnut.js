/**
 * Custom ESLint rule: no-string-anchor-chestnut
 *
 * 应然 (phase 1389 B): caller 不用 `.indexOf('.chestnut')` 字符串 anchor
 * 启发式 derive chestnutRoot。必经 helper SoT:
 *   - `getChestnutRoot()` env-based
 *   - `ctx.chestnutRoot` injected
 *
 * phase 327 cluster A-path-branded close 替代 grep ratchet
 */

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'No string-anchor heuristic .indexOf(".chestnut") for chestnutRoot derivation (M#3 + M#9 + phase 1389 B)',
      category: 'Best Practices',
    },
    schema: [],
    messages: {
      stringAnchor:
        'Anti-pattern: .indexOf(".chestnut") string-anchor heuristic. Use getChestnutRoot() env-based or ctx.chestnutRoot injection.',
    },
  },

  create(context) {
    return {
      CallExpression(node) {
        // <expr>.indexOf('.chestnut') 或 ".chestnut"
        const callee = node.callee;
        if (callee.type !== 'MemberExpression') return;
        if (callee.property.type !== 'Identifier' || callee.property.name !== 'indexOf') return;

        const args = node.arguments;
        if (args.length === 0) return;
        const arg = args[0];
        if (arg.type === 'Literal' && arg.value === '.chestnut') {
          context.report({ node, messageId: 'stringAnchor' });
        }
      },
    };
  },
};
