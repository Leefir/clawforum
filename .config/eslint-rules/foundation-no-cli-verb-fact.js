/**
 * Custom ESLint rule: foundation-no-cli-verb-fact
 *
 * 应然 (M#5 + phase 1479): foundation/ L1/L2 不预设 L6 CLI verb / args /
 * examples 这些上层概念。phase 1477 错放 src/foundation/cli-help/、phase 1479
 * 挪 src/cli/help/ 后立 invariant 防回归。
 *
 * Check:
 *   - filename contains 'cli-help' or endsWith 'verb-facts.ts' in foundation/
 *   - Identifier CLAW_VERB_FACTS / CLAW_VERB_NAMES / VerbFact in foundation/
 *
 * phase 330 cluster mixed-case-T3.5 close 替代 phase 1479 grep ratchet
 * 共享 phase 309 ESLint infra
 */

const BANNED_SYMBOLS = new Set(['CLAW_VERB_FACTS', 'CLAW_VERB_NAMES', 'VerbFact']);

function isFoundation(filename) {
  return filename.includes('src/foundation/');
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'foundation/ does not hold CLI verb fact schema (M#5 + phase 1479)',
      category: 'Best Practices',
    },
    schema: [],
    messages: {
      cliHelpPath:
        'foundation/ must not contain cli-help/* or verb-facts.ts file (M#5 — foundation L1/L2 not L6 concept). Move to src/cli/help/.',
      verbFactSymbol:
        'foundation/ must not reference CLI verb fact symbol "{{name}}" (M#5 — these are L6 CLI concepts).',
    },
  },

  create(context) {
    const filename = context.filename || '';
    if (!isFoundation(filename)) return {};

    // path check: filename in cli-help or verb-facts.ts
    if (filename.includes('cli-help') || filename.endsWith('verb-facts.ts')) {
      return {
        Program(node) {
          context.report({ node, messageId: 'cliHelpPath' });
        },
      };
    }

    return {
      Identifier(node) {
        if (BANNED_SYMBOLS.has(node.name)) {
          context.report({ node, messageId: 'verbFactSymbol', data: { name: node.name } });
        }
      },
    };
  },
};
