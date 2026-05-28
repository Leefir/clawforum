import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import path from 'node:path';

function safeGrep(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf8', cwd });
  } catch {
    return '';
  }
}

describe('phase 1388: no path.dirname(*clawDir|agentDir) 反推 clawforumRoot anti-pattern in src/', () => {
  it('grep src/ for buggy dirname reverse-compute pattern returns 0 hit (Motion-only callsite 注释豁免)', () => {
    const srcRoot = path.resolve(__dirname, '../../src');
    const out = safeGrep(
      `grep -rnE "path\\.dirname\\([^)]*\\b(clawDir|agentDir)\\b" ${srcRoot} | grep -v "Motion-only" || true`,
      process.cwd(),
    );
    const lines = out.trim().split('\n').filter(Boolean);
    expect(lines.length).toBe(0);
  });

  it('反向自检 — regex 能命中 Bug A 样例 (无 Motion-only 注释)', () => {
    const sample = `  const clawforumRoot = makeClawforumRoot(path.dirname(agentDir));`;
    const re = /path\.dirname\([^)]*\b(clawDir|agentDir)\b/;
    expect(re.test(sample)).toBe(true);
  });

  it('反向自检 — fix 后样例不命中', () => {
    const sample = `  const clawforumRoot = makeClawforumRoot(getClawforumRoot());`;
    const re = /path\.dirname\([^)]*\b(clawDir|agentDir)\b/;
    expect(re.test(sample)).toBe(false);
  });
});

describe('phase 1389: 扩 anti-pattern 覆盖度 3 类', () => {
  it('grep src/ for path.join(*claw|agentDir, "..") 单层 up 等价 anti-pattern (Motion-only 豁免) returns 0 hit', () => {
    const srcRoot = path.resolve(__dirname, '../../src');
    let hits = '';
    try {
      hits = execSync(
        `grep -rnE "makeClawforumRoot\\(path\\.join\\([^)]*\\b(clawDir|agentDir)\\b[^,]*,\\s*['\\"]\\.\\.['\\"]\\s*\\)\\)" ${srcRoot} | grep -v "Motion-only" || true`,
        { encoding: 'utf8' }
      );
    } catch (e: any) {
      if (e.status === 1) return;
      throw e;
    }
    if (hits.trim()) {
      throw new Error(
        `phase 1389 invariant violation (残留 A 类 / 单层 up): ${hits}\n应改 path.join(clawDir, '..', '..') 双层 up 或 Motion-only callsite 豁免注释。`
      );
    }
  });

  it('grep src/ for .indexOf(".clawforum") 字符串 anchor 启发式 returns 0 hit', () => {
    const srcRoot = path.resolve(__dirname, '../../src');
    let hits = '';
    try {
      hits = execSync(
        `grep -rnE "\\.indexOf\\(['\\"]\\.clawforum['\\"]\\)" ${srcRoot} || true`,
        { encoding: 'utf8' }
      );
    } catch (e: any) {
      if (e.status === 1) return;
      throw e;
    }
    if (hits.trim()) {
      throw new Error(
        `phase 1389 invariant violation (残留 B 类 / string-anchor heuristic): ${hits}\n应改 getClawforumRoot() env-based 或 ctx-injected clawforumRoot。`
      );
    }
  });

  it('grep src/ for deriveClawforumRoot helper returns 0 hit', () => {
    const srcRoot = path.resolve(__dirname, '../../src');
    let hits = '';
    try {
      hits = execSync(
        `grep -rn "deriveClawforumRoot" ${srcRoot} || true`,
        { encoding: 'utf8' }
      );
    } catch (e: any) {
      if (e.status === 1) return;
      throw e;
    }
    if (hits.trim()) {
      throw new Error(
        `phase 1389 invariant violation (残留 B 类 / deriveClawforumRoot helper): ${hits}\n应已撤 helper / 改 getClawforumRoot() 直调。`
      );
    }
  });

  it('反向自检 — 3 类 anti-pattern 样例 regex 命中验证', () => {
    const sample_A = `const x = makeClawforumRoot(path.join(clawDir, '..'));`;
    const re_A = /makeClawforumRoot\(path\.join\([^)]*\b(clawDir|agentDir)\b[^,]*,\s*['"]\.\.['"]\s*\)\)/;
    expect(re_A.test(sample_A)).toBe(true);

    const sample_B = `const idx = parts.indexOf('.clawforum');`;
    const re_B = /\.indexOf\(['"]\.clawforum['"]\)/;
    expect(re_B.test(sample_B)).toBe(true);

    const sample_correct = `const x = makeClawforumRoot(path.join(clawDir, '..', '..'));`;
    expect(re_A.test(sample_correct)).toBe(false);
  });
});
