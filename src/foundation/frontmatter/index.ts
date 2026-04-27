/**
 * @module L1.Frontmatter
 * Frontmatter module (L1)
 *
 * Pure YAML frontmatter parser utility. No I/O, no side effects.
 * No runtime dependencies. No type dependencies on higher layers.
 *
 * Originally extracted from L1.MessageCodec (phase 361) to dissolve the
 * L1→L2 reverse predict violation: message-codec/inbox.ts imported
 * InboxMessage (L2 business type), forcing the entire module to span
 * pure parsing (L1 OK) and business encoding (L2). Inbox/outbox codec
 * relocated to L2 Messaging; this module retains only the pure parser.
 */

export function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  // Normalize CRLF to LF for consistent parsing
  const normalized = raw.replace(/\r\n/g, '\n');

  if (!normalized.startsWith('---\n')) return { meta: {}, body: raw };
  const afterOpen = normalized.slice(4);
  const closeIdx = afterOpen.indexOf('\n---\n');
  if (closeIdx < 0) {
    throw new Error('Malformed frontmatter: missing closing ---');
  }

  const meta: Record<string, string> = {};
  for (const line of afterOpen.slice(0, closeIdx).split('\n')) {
    const ci = line.indexOf(':');
    if (ci <= 0) continue;
    const key = line.slice(0, ci).trim();
    const value = line.slice(ci + 1).trim().replace(/^["']|["']$/g, '');
    meta[key] = value;
  }

  // Everything after the closing --- is the body
  return { meta, body: afterOpen.slice(closeIdx + 5).trim() };
}
