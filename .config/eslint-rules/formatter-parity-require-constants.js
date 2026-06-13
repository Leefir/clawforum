/**
 * Custom ESLint rule: formatter-parity-require-constants
 *
 * 应然 (phase 1274): 双 formatter path 必引用同套 guard audit constants
 * 防 future caller fork formatter without parity audit emit。
 *
 * Required constants per file:
 *   - src/foundation/llm-provider/base-anthropic.ts: TOOL_RESULT_MISSING_ID +
 *     TOOL_RESULT_ORPHAN_ID + ASSISTANT_EMPTY_CONTENT_SKIPPED
 *   - src/foundation/llm-provider/openai-message-formatter.ts: TOOL_RESULT_MISSING_ID +
 *     TOOL_RESULT_ORPHAN_ID
 *
 * phase 329 cluster formatter-parity close 替代 phase 1274 grep ratchet
 * 共享 phase 309 ESLint infra / phase 312/315/322/327/328 模板
 */

const REQUIREMENTS = [
  {
    suffix: 'foundation/llm-provider/base-anthropic.ts',
    required: ['TOOL_RESULT_MISSING_ID', 'TOOL_RESULT_ORPHAN_ID', 'ASSISTANT_EMPTY_CONTENT_SKIPPED'],
  },
  {
    suffix: 'foundation/llm-provider/openai-message-formatter.ts',
    required: ['TOOL_RESULT_MISSING_ID', 'TOOL_RESULT_ORPHAN_ID'],
  },
];

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Formatter parity: both Anthropic + OpenAI formatter paths must reference same guard audit constants (phase 1274)',
      category: 'Best Practices',
    },
    schema: [],
    messages: {
      missingConstant:
        'Formatter parity violation: {{file}} must reference {{name}} guard audit constant. Both formatter paths must emit the same guards (phase 1274).',
    },
  },

  create(context) {
    const filename = context.filename || '';
    const match = REQUIREMENTS.find(r => filename.endsWith(r.suffix));
    if (!match) return {};

    const seen = new Set();

    return {
      Identifier(node) {
        if (match.required.includes(node.name)) {
          seen.add(node.name);
        }
      },

      'Program:exit'(node) {
        for (const name of match.required) {
          if (!seen.has(name)) {
            context.report({
              node,
              messageId: 'missingConstant',
              data: { file: match.suffix, name },
            });
          }
        }
      },
    };
  },
};
