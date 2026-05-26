/**
 * @module Tests.Design
 * Mechanical invariant: src/foundation/ 0 import from src/core/ (including type-only)
 * phase 1337 sub-4 / cluster N=12 累达 / r138 D fork
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

function findTsFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules') {
      results.push(...findTsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

describe('foundation-no-l3-business-import invariant', () => {
  it('src/foundation/ has 0 import from src/core/ (including type-only)', () => {
    const foundationDir = path.join(process.cwd(), 'src', 'foundation');
    const files = findTsFiles(foundationDir);

    const violations: Array<{ file: string; line: number; text: string }> = [];
    const importRegex = /import\s+.*?\s+from\s+['"]\.{0,2}\/[^'"]*\/core\//;

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (importRegex.test(line)) {
          violations.push({ file: path.relative(process.cwd(), file), line: i + 1, text: line.trim() });
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
