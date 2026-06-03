import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import path from 'node:path';

/**
 * phase 17 — inline error pattern invariant
 *
 * 信息丢失 cluster (phase 13-15) 治理后、防回归 lint：
 * 新代码不得引入 `e instanceof Error ? e.message : String(e)` 或
 * `e.message [||/??] String(e)` 等会落 [object Object] 失信形态。
 *
 * canonical owner = `src/foundation/utils/format.ts:formatErr`、调用走
 * `from '<rel>/foundation/utils/index.js'` barrel（phase 1423 invariant）。
 *
 * form 2 `${err.name}: ${err.message}` + form 3 `${err.message}\n${err.stack}`
 * 形态因含 `:` / `?` 字符天然不被 regex 命中、无需 whitelist。
 *
 * 镜像 phase 1423 `no-deep-utils-format-import.test.ts` 模板。
 */
describe('phase 17: inline error pattern invariant', () => {
  const srcRoot = path.resolve(__dirname, '../../src');

  const PATTERNS: ReadonlyArray<{ name: string; regex: string }> = [
    {
      name: 'group 1: instanceof Error ? .message : String()',
      regex: 'instanceof Error\\s*\\?\\s*[^?:]*\\.message\\s*:\\s*String\\(',
    },
    {
      name: 'group 2: .message [||/??] String()',
      regex: '\\.message\\s*(\\|\\||\\?\\?)\\s*String\\(',
    },
  ];

  for (const { name, regex } of PATTERNS) {
    it(`${name} — 0 hits across src/`, () => {
      let hits = '';
      try {
        hits = execSync(`grep -rnE "${regex}" ${srcRoot} --include='*.ts'`, {
          encoding: 'utf8',
        });
      } catch (e: any) {
        if (e.status === 1) return; // grep 0 命中：exit 1 = pass
        throw e;
      }
      if (hits.trim()) {
        const count = hits.split('\n').filter(Boolean).length;
        throw new Error(
          `phase 17 invariant violation: ${count} hit(s) of ${name}:\n${hits}\nUse \`formatErr(e)\` from \`<rel>/foundation/utils/index.js\` instead. See coding plan/phase17/.`,
        );
      }
    });
  }

  it('reverse self-check: group 1 regex 命中 anti-pattern sample', () => {
    const sample = `const x = e instanceof Error ? e.message : String(e);`;
    const re = /instanceof Error\s*\?\s*[^?:]*\.message\s*:\s*String\(/;
    expect(re.test(sample)).toBe(true);
  });

  it('reverse self-check: group 2 regex 命中 .message || String sample', () => {
    const sample = `const x = err?.message || String(err);`;
    const re = /\.message\s*(\|\||\?\?)\s*String\(/;
    expect(re.test(sample)).toBe(true);
  });

  it('reverse self-check: formatErr 调用不被命中', () => {
    const good = `const x = formatErr(e);`;
    const re1 = /instanceof Error\s*\?\s*[^?:]*\.message\s*:\s*String\(/;
    const re2 = /\.message\s*(\|\||\?\?)\s*String\(/;
    expect(re1.test(good)).toBe(false);
    expect(re2.test(good)).toBe(false);
  });

  it('reverse self-check: form 2/3 helper 行天然不被命中', () => {
    const form2 = `const errMsg = err instanceof Error ? \`\${err.name}: \${err.message}\` : String(err);`;
    const form3 = `const errMsg = reason instanceof Error ? \`\${reason.message}\\n\${reason.stack ?? ''}\` : String(reason);`;
    const re1 = /instanceof Error\s*\?\s*[^?:]*\.message\s*:\s*String\(/;
    const re2 = /\.message\s*(\|\||\?\?)\s*String\(/;
    expect(re1.test(form2)).toBe(false); // `:` in ${name}: 截断 [^?:]*
    expect(re1.test(form3)).toBe(false); // `?` in ?? 截断 [^?:]*
    expect(re2.test(form2)).toBe(false); // .message 后跟 `\` 不是 ||/??
    expect(re2.test(form3)).toBe(false); // .message 后跟 \n、不是 ||/??
  });
});
