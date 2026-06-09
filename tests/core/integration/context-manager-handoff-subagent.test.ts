import { describe, it, expect, vi } from 'vitest';
import { createHandoffMarker } from '../../../src/core/l4_context_manager/handoff.js';
import { HANDOFF_MARKER_CREATED } from '../../../src/core/l4_context_manager/audit-events.js';

describe('subagent handoff marker integration', () => {
  it('createHandoffMarker emits audit via auditWriter', () => {
    const auditWriter = { write: vi.fn() , preview: vi.fn((s: string) => s), message: vi.fn((s: string) => s), summary: vi.fn((s: string) => s)};
    const marker = createHandoffMarker('parent-round-123', auditWriter);

    expect(marker.parentRound).toBe('parent-round-123');
    expect(typeof marker.id).toBe('string');
    expect(auditWriter.write).toHaveBeenCalledWith(
      HANDOFF_MARKER_CREATED,
      expect.stringContaining('id='),
      expect.stringContaining('parent=parent-round-123'),
    );
  });

  it('marker id is unique per call', () => {
    const auditWriter = { write: vi.fn() , preview: vi.fn((s: string) => s), message: vi.fn((s: string) => s), summary: vi.fn((s: string) => s)};
    const a = createHandoffMarker('r1', auditWriter);
    const b = createHandoffMarker('r1', auditWriter);
    expect(a.id).not.toBe(b.id);
  });
});
