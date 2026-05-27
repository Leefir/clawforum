// src/foundation/audit/audit-events.ts
// Phase 1380: audit fallback drop observability event const

export const AUDIT_FALLBACK_DROPPED = 'audit_fallback_dropped' as const;

export const AUDIT_FALLBACK_DROP_EVENTS = {
  AUDIT_FALLBACK_DROPPED: 'audit_fallback_dropped',
} as const;
