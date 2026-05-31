/**
 * phase 1476: claw-outbox-summary composer unit test (γ2 first real composer).
 */

import { describe, it, expect } from 'vitest';
import { composer } from '../../../src/assembly/guidance/composers/claw-outbox-summary.js';

describe('phase 1476: claw-outbox-summary composer', () => {
  it('returns non-null guidance with subject-first CLI', () => {
    const result = composer({
      hash: 'abc123def456',
      total_claws: '2',
      total_msgs: '4',
      counts: JSON.stringify({ clawA: 3, clawB: 1 }),
    });
    expect(result).not.toBeNull();
    expect(result!.text).toContain('chestnut claw <claw-id> outbox');
    expect(result!.text).toContain('--limit 4');
  });

  it('safe limit fallback if total_msgs is malformed', () => {
    const result = composer({
      hash: 'aaaaaaaaaaaa',
      total_claws: '1',
      total_msgs: 'NaN',
      counts: '{}',
    });
    expect(result!.text).toContain('--limit 10');
  });

  it('total_msgs = 0 still returns guidance (caller decides to call or not)', () => {
    // composer is pure / doesn't second-guess scheduler — tick handler guards 0-unread case
    const result = composer({
      hash: 'aaaaaaaaaaaa',
      total_claws: '0',
      total_msgs: '0',
      counts: '{}',
    });
    expect(result).not.toBeNull();
    expect(result!.text).toContain('--limit 10'); // fallback when limit <= 0
  });
});
