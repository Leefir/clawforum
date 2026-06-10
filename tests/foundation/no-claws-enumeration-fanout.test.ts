import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';

describe('no claws enumeration fanout', () => {
  it('only foundation/claw-paths.ts uses fs.listSync(clawsDir, {includeDirs:true}) pattern', () => {
    let out: string;
    try {
      out = execSync(
        `grep -rnE "fs\\.listSync\\([^)]*[Cc]laws.*includeDirs" src/ | grep -v 'src/foundation/claw-paths.ts'`,
        { cwd: process.cwd(), encoding: 'utf-8' },
      ).trim();
    } catch (err: any) {
      // grep returns exit code 1 when no matches found — that's the desired state
      if (err.status === 1) {
        out = '';
      } else {
        throw err;
      }
    }
    expect(out, `Unexpected callers: ${out}`).toBe('');
  });
});
