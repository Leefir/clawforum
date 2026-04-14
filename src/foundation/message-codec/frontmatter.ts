/**
 * YAML frontmatter parser utility
 *
 * Unified implementation to replace 5 duplicated copies across the codebase.
 *
 * Features:
 * - Supports `: ` (preferred) and `:` (compatibility)
 * - Strips quotes from values ("value" or 'value' → value)
 * - Returns { meta, body } format
 *
 * Safety: body content containing `\n---\n` cannot confuse this parser because:
 * 1. All frontmatter values are single-line (encodeInbox uses yamlQuote for strings)
 * 2. indexOf('\n---\n') finds the FIRST match, which is always the closing delimiter
 * 3. Body content appears after the first match and is never scanned for delimiters
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
