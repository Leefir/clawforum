import { describe, it, expect, vi } from 'vitest';
import { resolveHandoffMarker } from '../../../src/core/l4_context_manager/handoff.js';
import { HANDOFF_MARKER_NOT_FOUND } from '../../../src/core/l4_context_manager/audit-events.js';

describe('evolution retro handoff marker integration', () => {
  it('resolveHandoffMarker emits not_found audit when marker missing', () => {
    const auditWriter = { write: vi.fn() , preview: vi.fn((s: string) => s), message: vi.fn((s: string) => s), summary: vi.fn((s: string) => s)};
    const result = resolveHandoffMarker('missing-id', auditWriter);

    expect(result).toBeNull();
    expect(auditWriter.write).toHaveBeenCalledWith(
      HANDOFF_MARKER_NOT_FOUND,
      expect.stringContaining('missing-id'),
    );
  });

  it('resolveHandoffMarker without auditWriter does not throw', () => {
    expect(() => resolveHandoffMarker('any-id')).not.toThrow();
    expect(resolveHandoffMarker('any-id')).toBeNull();
  });
});
