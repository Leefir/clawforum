/**
 * Custom ESLint rule: foundation-no-business-role-literal
 *
 * 应然 (M#5 + phase 1395): foundation/ 不持 quoted business caller role literal
 * (motion / claw / subagent / verifier / shadow / miner)。
 *
 * Strict scope:
 *   - src/foundation/tool-protocol/ 0 tolerance (no business literal nor caller-type re-export)
 *
 * Allow-list scope:
 *   - src/foundation/ 其他文件如 allow-list 内 (16 file pre-existing tech debt) → 允许
 *   - src/foundation/ 其他文件不在 allow-list → 0 tolerance
 *
 * phase 330 cluster mixed-case-T3.5 close 替代 phase 1395 grep ratchet
 * 共享 phase 309 ESLint infra
 */

const BUSINESS_ROLES = ['motion', 'claw', 'subagent', 'verifier', 'shadow', 'miner'];

const ALLOW_LIST_SUFFIXES = [
  'src/foundation/command-tool/exec.ts',
  'src/foundation/config/schemas.ts',
  'src/foundation/file-tool/edit.ts',
  'src/foundation/file-tool/ls.ts',
  'src/foundation/file-tool/multi_edit.ts',
  'src/foundation/file-tool/read.ts',
  'src/foundation/file-tool/search.ts',
  'src/foundation/file-tool/write.ts',
  'src/foundation/messaging/tools/notify-claw.ts',
  'src/foundation/messaging/tools/send.ts',
  'src/foundation/process-manager/agent-factory.ts',
  'src/foundation/process-manager/types.ts',
  'src/foundation/skill-system/tools/skill.ts',
  'src/foundation/tools/context.ts',
  'src/foundation/tools/executor.ts',
  'src/foundation/tools/types.ts',
];

const BANNED_REEXPORTS = ['CallerType', 'DispatchCallerType', 'callerTypeToProfile'];

const ROLE_SET = new Set(BUSINESS_ROLES);

function isFoundation(filename) {
  return filename.includes('src/foundation/');
}

function isToolProtocol(filename) {
  return filename.includes('src/foundation/tool-protocol/');
}

function isAllowListed(filename) {
  return ALLOW_LIST_SUFFIXES.some(s => filename.endsWith(s));
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'foundation/ does not hold quoted business caller role literal (M#5 + phase 1395)',
      category: 'Best Practices',
    },
    schema: [],
    messages: {
      businessLiteral:
        'Business role literal "{{role}}" detected in foundation/{{kind}}. foundation/ is L1/L2 infra, must not preset L4 business roles (M#5).',
      callerTypeReexport:
        'foundation/tool-protocol/index.ts must not re-export "{{name}}" (CallerType is L4 business concept, M#5).',
    },
  },

  create(context) {
    const filename = context.filename || '';
    if (!isFoundation(filename)) return {};

    const strictTp = isToolProtocol(filename);
    const allowed = isAllowListed(filename);

    return {
      Literal(node) {
        if (typeof node.value !== 'string') return;
        if (!ROLE_SET.has(node.value)) return;

        // tool-protocol/ : strict, always report
        if (strictTp) {
          context.report({
            node,
            messageId: 'businessLiteral',
            data: { role: node.value, kind: 'tool-protocol' },
          });
          return;
        }

        // foundation/ allow-list: skip
        if (allowed) return;

        // foundation/ not allow-listed: report
        context.report({
          node,
          messageId: 'businessLiteral',
          data: { role: node.value, kind: filename.split('src/foundation/')[1] || 'unknown' },
        });
      },

      TemplateElement(node) {
        const v = node.value && node.value.cooked;
        if (typeof v !== 'string') return;
        if (!ROLE_SET.has(v)) return;
        if (strictTp) {
          context.report({
            node,
            messageId: 'businessLiteral',
            data: { role: v, kind: 'tool-protocol' },
          });
          return;
        }
        if (allowed) return;
        context.report({
          node,
          messageId: 'businessLiteral',
          data: { role: v, kind: filename.split('src/foundation/')[1] || 'unknown' },
        });
      },

      // tool-protocol/index.ts must not re-export CallerType etc.
      ExportSpecifier(node) {
        if (!strictTp) return;
        const exported = node.exported && node.exported.name;
        if (BANNED_REEXPORTS.includes(exported)) {
          context.report({ node, messageId: 'callerTypeReexport', data: { name: exported } });
        }
      },
      ExportNamedDeclaration(node) {
        if (!strictTp) return;
        if (!node.declaration) return;
        // export type T = ... / export const T = ... / export function T(...) {}
        const decl = node.declaration;
        if (decl.type === 'TSTypeAliasDeclaration' || decl.type === 'VariableDeclaration' || decl.type === 'FunctionDeclaration') {
          const ids = decl.type === 'VariableDeclaration'
            ? decl.declarations.map(d => d.id && d.id.name).filter(Boolean)
            : [decl.id && decl.id.name].filter(Boolean);
          for (const id of ids) {
            if (BANNED_REEXPORTS.includes(id)) {
              context.report({ node, messageId: 'callerTypeReexport', data: { name: id } });
            }
          }
        }
      },
    };
  },
};
