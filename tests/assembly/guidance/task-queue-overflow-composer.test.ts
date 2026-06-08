/**
 * phase 7 γ7: task-queue-overflow real composer unit test.
 */

import { describe, it, expect } from 'vitest';
import { composer } from '../../../src/assembly/guidance/composers/task-queue-overflow.js';

describe('task-queue-overflow composer (phase 7)', () => {
  it('returns escalation guidance pointing to user', () => {
    const r = composer({ cap: '1000', queue_length: '1000' });
    expect(r.text).toContain('system-level overload');
    expect(r.text).toContain('Surface to the user');
    expect(r.text).toContain('developer');
    expect(r.text).toContain('Do not retry');
  });

  it('returns same guidance regardless of state fields', () => {
    const r1 = composer({});
    const r2 = composer({ cap: '500', queue_length: '500' });
    expect(r1.text).toBe(r2.text);
  });
});
