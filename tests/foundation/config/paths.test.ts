/**
 * Path getters tests
 */
import { describe, it, expect } from 'vitest';
import { getClawDir } from '../../../src/foundation/config/paths.js';

describe('Phase 537 — getClawDir traversal guard', () => {
  it.each([
    ['..'],
    ['../foo'],
    ['foo/bar'],
    ['.'],
    ['.hidden'],
    [''],
  ])('rejects traversal-style claw id %s', (id) => {
    expect(() => getClawDir(id)).toThrow(/Invalid claw id/);
  });

  it('accepts safe identifiers', () => {
    expect(() => getClawDir('claw1')).not.toThrow();
    expect(() => getClawDir('foo-bar_baz')).not.toThrow();
    expect(() => getClawDir('AlphaNumeric123')).not.toThrow();
  });
});
