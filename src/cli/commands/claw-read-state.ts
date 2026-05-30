/**
 * @module L6.CLI.Claw.ReadState
 * Inspect a Claw's overwrite-gate state (phase 1452 / F-NEXT.1).
 *
 * Reads `<clawDir>/read-state.json` (written by FileStateManager helpers per phase 1443)
 * and renders entries human-readable or JSON. Surfaces:
 *   - which files the agent has "seen" (hash + mtime + isFullRead)
 *   - whether the agent could overwrite each file (isFullRead=true)
 *   - presence/absence of disk file (audit visibility for daemon restart vs first-run vs cleared-by-regime-switch)
 */

import {
  loadGlobalConfig, clawExists, getClawDir,
} from '../../foundation/config/index.js';
import { CONFIG_DEFAULTS } from '../../assembly/index.js';
import { CliError } from '../errors.js';
import { READ_STATE_FILE } from '../../foundation/file-tool/file-state-persist.js';
import type { FileState } from '../../foundation/tools/types.js';
import type { FileSystem } from '../../foundation/fs/types.js';

interface PersistFormatV1 {
  version: 1;
  updated_at: string;
  entries: Record<string, FileState>;
}

interface ReadStateReport {
  claw: string;
  exists: boolean;
  version?: number;
  updated_at?: string;
  entry_count: number;
  entries: Array<{
    path: string;
    hash_short: string;
    timestamp_ms: number;
    timestamp_iso: string;
    is_full_read: boolean;
    overwritable: boolean;  // semantic alias of is_full_read for end-user clarity
  }>;
  notes?: string[];
}

function buildReport(name: string, fs: FileSystem): ReadStateReport {
  let raw: string;
  try {
    raw = fs.readSync(READ_STATE_FILE);
  } catch (err) {
    if ((err as { code?: string })?.code === 'ENOENT' || (err as { code?: string })?.code === 'FS_NOT_FOUND') {
      return { claw: name, exists: false, entry_count: 0, entries: [],
        notes: ['No read-state.json found. Reasons: daemon never ran, regime switch cleared it, or claw never used read tool.'] };
    }
    throw err;
  }

  let parsed: PersistFormatV1;
  try {
    parsed = JSON.parse(raw) as PersistFormatV1;
  } catch (err) {
    // silent: parse failure surfaced as structured report `notes` field (CLI inspect tool's contract is informational, not transactional — user reads result, decides if action needed; throwing would break --json piping).
    return { claw: name, exists: true, entry_count: 0, entries: [],
      notes: [`read-state.json present but parse failed: ${err instanceof Error ? err.message : String(err)}. File is corrupt; Runtime would treat as empty state.`] };
  }

  if (parsed.version !== 1) {
    return { claw: name, exists: true, version: parsed.version, entry_count: 0, entries: [],
      notes: [`Unknown version ${parsed.version}; expected 1. Runtime would treat as empty state.`] };
  }

  const entries = Object.entries(parsed.entries ?? {}).map(([p, s]) => ({
    path: p,
    hash_short: s.hash.slice(0, 12),
    timestamp_ms: s.timestamp,
    timestamp_iso: new Date(s.timestamp).toISOString(),
    is_full_read: s.isFullRead,
    overwritable: s.isFullRead,
  }));

  return {
    claw: name,
    exists: true,
    version: parsed.version,
    updated_at: parsed.updated_at,
    entry_count: entries.length,
    entries,
    notes: entries.length === 0 ? ['File present but no entries (likely cleared by regime switch).'] : undefined,
  };
}

function renderText(r: ReadStateReport): string {
  const lines: string[] = [];
  lines.push(`Claw: ${r.claw}`);
  if (!r.exists) {
    lines.push('Read state file: ABSENT');
    if (r.notes) for (const n of r.notes) lines.push(`  ${n}`);
    return lines.join('\n');
  }
  lines.push(`Read state file: ${READ_STATE_FILE}`);
  lines.push(`Version: ${r.version}`);
  if (r.updated_at) lines.push(`Updated at: ${r.updated_at}`);
  lines.push(`Entries: ${r.entry_count}`);
  if (r.notes) for (const n of r.notes) lines.push(`  ${n}`);

  if (r.entries.length > 0) {
    lines.push('');
    lines.push('  path                                                  hash         mtime                    overwritable');
    lines.push('  ----                                                  ----         -----                    ------------');
    for (const e of r.entries) {
      const pathCol = e.path.length > 50 ? '...' + e.path.slice(-47) : e.path.padEnd(50);
      const hashCol = e.hash_short.padEnd(12);
      const mtimeCol = e.timestamp_iso.padEnd(24);
      const owCol = e.overwritable ? 'yes' : 'no (not full-read)';
      lines.push(`  ${pathCol}  ${hashCol}  ${mtimeCol}  ${owCol}`);
    }
  }

  return lines.join('\n');
}

export async function readStateCommand(
  deps: { fsFactory: (baseDir: string) => FileSystem },
  name: string,
  opts?: { json?: boolean },
): Promise<void> {
  loadGlobalConfig(deps, CONFIG_DEFAULTS);

  if (!clawExists(deps, name)) {
    throw new CliError(`Claw "${name}" does not exist`);
  }

  const clawDir = getClawDir(name);
  const clawFs = deps.fsFactory(clawDir);

  const report = buildReport(name, clawFs);

  if (opts?.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return;
  }
  process.stdout.write(renderText(report) + '\n');
}

// Re-export path const for typedoc visibility
export { READ_STATE_FILE };
