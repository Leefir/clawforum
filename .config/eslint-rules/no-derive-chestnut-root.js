/**
 * Custom ESLint rule: no-derive-chestnut-root
 *
 * 应然 (phase 1389 B): `deriveChestnutRoot` helper 已撤、caller 必经
 *   - `getChestnutRoot()` env-based
 *   - `ctx.chestnutRoot` injected
 *
 * 防 future caller 重立 helper (typo / re-implementation)。
 *
 * phase 327 cluster A-path-branded close 替代 grep ratchet
 */

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'No deriveChestnutRoot helper identifier (已撤 helper, phase 1389 B)',
      category: 'Best Practices',
    },
    schema: [],
    messages: {
      deriveHelper:
        'Anti-pattern: deriveChestnutRoot helper. Use getChestnutRoot() env-based or ctx.chestnutRoot injection.',
    },
  },

  create(context) {
    return {
      Identifier(node) {
        if (node.name === 'deriveChestnutRoot') {
          context.report({ node, messageId: 'deriveHelper' });
        }
      },
    };
  },
};
