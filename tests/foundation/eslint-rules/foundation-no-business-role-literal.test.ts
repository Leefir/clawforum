import { describe, it } from 'vitest';
import { RuleTester } from 'eslint';
import foundationNoBusinessRoleLiteral from '../../../.config/eslint-rules/foundation-no-business-role-literal.js';

const ruleTester = new RuleTester({
  languageOptions: { parserOptions: { ecmaVersion: 'latest', sourceType: 'module' } },
});

describe('eslint custom rule: foundation-no-business-role-literal (phase 330)', () => {
  ruleTester.run('foundation-no-business-role-literal', foundationNoBusinessRoleLiteral, {
    valid: [
      // out of scope
      { code: 'const x = "motion";', filename: 'src/core/runtime/runtime.ts' },
      // foundation allow-list file
      { code: 'const x = "motion";', filename: 'src/foundation/tools/types.ts' },
      // foundation/audit/ (not foundation/tool-protocol/, not allow-list, but no banned literal)
      { code: 'const x = "hello";', filename: 'src/foundation/audit/events.ts' },
      // foundation/audit/ + non-business word
      { code: 'const x = "audit";', filename: 'src/foundation/audit/events.ts' },
      // tool-protocol/ but export of non-banned
      { code: 'export const Foo = "string";', filename: 'src/foundation/tool-protocol/index.ts' },
    ],
    invalid: [
      // tool-protocol: business role literal
      {
        code: 'const x = "motion";',
        filename: 'src/foundation/tool-protocol/index.ts',
        errors: [{ messageId: 'businessLiteral' }],
      },
      // tool-protocol: declare banned identifier (callerTypeToProfile)
      {
        code: 'export const callerTypeToProfile = (x) => x;',
        filename: 'src/foundation/tool-protocol/index.ts',
        errors: [{ messageId: 'callerTypeReexport' }],
      },
      // foundation/ non-allow-list: claw literal
      {
        code: 'const x = "claw";',
        filename: 'src/foundation/audit/events.ts',
        errors: [{ messageId: 'businessLiteral' }],
      },
      // foundation/ non-allow-list: subagent literal in template
      {
        code: 'const x = `subagent`;',
        filename: 'src/foundation/audit/events.ts',
        errors: [{ messageId: 'businessLiteral' }],
      },
    ],
  });

  it('rule loaded', () => {});
});
