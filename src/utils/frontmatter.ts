/**
 * YAML frontmatter parser utility
 * 
 * Unified implementation to replace 5 duplicated copies across the codebase.
 * 
 * Features:
 * - Supports `: ` (preferred) and `:` (compatibility)
 * - Strips quotes from values ("value" or 'value' → value)
 * - Returns { meta, body } format
 */

export function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  if (!raw.startsWith('---\n')) return { meta: {}, body: raw };
  const afterOpen = raw.slice(4);
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
  return { meta, body: afterOpen.slice(closeIdx + 5).trim() };
}
