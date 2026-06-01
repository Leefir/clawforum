import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

describe('foundation/config/crud.ts: uses FileSystem for atomic writes', () => {
  it('contains no inline fs.writeFileSync for atomic write pattern', () => {
    const src = readFileSync('src/foundation/config/crud.ts', 'utf-8');
    expect(src).not.toMatch(/fs\.writeFileSync\b/);
  });

  it('contains no Date.now() tmp naming', () => {
    const src = readFileSync('src/foundation/config/crud.ts', 'utf-8');
    expect(src).not.toMatch(/\$\{Date\.now\(\)\}/);
  });

  it('uses writeAtomicSync for config writes', () => {
    const crudSrc = readFileSync('src/foundation/config/crud.ts', 'utf-8');
    const loaderSrc = readFileSync('src/foundation/config/loader.ts', 'utf-8');
    // Phase 10: write logic moved to loader.ts; either file may hold writeAtomicSync
    expect(crudSrc + loaderSrc).toMatch(/writeAtomicSync\(/);
  });
});
