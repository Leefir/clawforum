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
