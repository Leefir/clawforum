import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('phase 1390 + 1427: file-tool 6 工具不再含 cwd schema field（search.cwd 由 phase 1427 删）', () => {
  const ROOT = path.resolve(__dirname, '../..');
  // phase 1390: 5 tool / phase 1427: search 加入
  const TOOLS = ['read', 'write', 'ls', 'edit', 'multi_edit', 'search'];

  it('6 file tool schema 0 cwd field', () => {
    for (const tool of TOOLS) {
      const file = readFileSync(`${ROOT}/src/foundation/file-tool/${tool}.ts`, 'utf-8');
      // match a property declaration `  cwd: {` at line start with indent
      expect(file).not.toMatch(/^\s+cwd:\s*\{/m);
    }
  });

  it('6 file tool execute 0 cwdArg 解构', () => {
    for (const tool of TOOLS) {
      const file = readFileSync(`${ROOT}/src/foundation/file-tool/${tool}.ts`, 'utf-8');
      expect(file).not.toMatch(/args\.cwd\s+as\s+string/);
      expect(file).not.toMatch(/const\s+cwdArg\s*=/);
    }
  });

  it('exec 仍含 cwd schema (sanity / regression-guard — exec.cwd 独立 shell-WD 语义、本 file-tool invariant 不约束)', () => {
    const exec = readFileSync(`${ROOT}/src/foundation/command-tool/exec.ts`, 'utf-8');
    expect(exec).toMatch(/^\s+cwd:\s*\{/m);
  });

  it('反向自检 — sample 含 cwd field 应被命中', () => {
    const sample = `  schema: {\n    properties: {\n      cwd: { type: 'string' },\n      path: ...\n    }\n  }`;
    expect(/^\s+cwd:\s*\{/m.test(sample)).toBe(true);
  });
});
