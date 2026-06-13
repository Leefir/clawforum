/**
 * Custom ESLint rule: no-perm-management-in-command-tool
 *
 * 应然 (phase 1280 r136 B fork、2026-05-25 user ratify、REFRAMED-OUT by-design):
 *   command-tool L2 基础设施不持权限管理业务语义 (M#3 + M#5)。
 *   权限管理归 permissions module own (phase 1406+)。
 *
 * 3 invariant:
 *   (1) ban `allowList` identifier in src/foundation/command-tool/
 *   (2) ban `denyList` identifier in src/foundation/command-tool/
 *   (3) ban `command_tool_command_rejected` audit event literal anywhere in src/
 *
 * phase 322 cluster module-boundary-enforce close (替代 phase 1280 grep ratchet)
 * 共享 phase 309 ESLint infra / phase 312/315 模板复用
 */

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'command-tool 不含 permission management (M#3 + M#5、phase 1280 r136 B fork)',
      category: 'Best Practices',
    },
    schema: [],
    messages: {
      permIdentifier:
        'Permission management identifier "{{name}}" detected in command-tool. Permission management belongs to permissions module (M#3 + M#5).',
      rejectedEvent:
        'Audit event literal "command_tool_command_rejected" detected. This event is reframed-out by-design (phase 1280 r136 B fork, 2026-05-25 user ratify).',
    },
  },

  create(context) {
    const filename = context.filename;
    const isCommandToolFile = filename.includes('foundation/command-tool/');

    return {
      // (1)(2) ban allowList / denyList identifier in command-tool/
      Identifier(node) {
        if (!isCommandToolFile) return;
        if (node.name === 'allowList' || node.name === 'denyList') {
          context.report({
            node,
            messageId: 'permIdentifier',
            data: { name: node.name },
          });
        }
      },

      // (3) ban 'command_tool_command_rejected' string literal anywhere in src/
      Literal(node) {
        if (
          typeof node.value === 'string' &&
          node.value === 'command_tool_command_rejected'
        ) {
          context.report({
            node,
            messageId: 'rejectedEvent',
            data: { name: node.value },
          });
        }
      },
    };
  },
};
