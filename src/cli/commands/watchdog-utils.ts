/**
 * Watchdog utility functions — extracted for testability
 */

import * as fs from 'fs';
import * as path from 'path';

// Parse stream.jsonl, return the timestamp of the last event and the last error message
export interface ClawActivityInfo {
  lastEventMs: number | null;  // most recent ts from any LLM output event
  lastError: string | null;    // error message when the last terminal event was turn_error
                               // only cleared by turn_end
}

// Only count direct LLM output events (excludes infrastructure events like llm_start/tool_result)
export const LLM_OUTPUT_EVENTS = new Set(['thinking_delta', 'text_delta', 'tool_call']);

export function getClawActivityInfo(clawDir: string): ClawActivityInfo {
  const streamFile = path.join(clawDir, 'stream.jsonl');
  try {
    const content = fs.readFileSync(streamFile, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    let lastEventMs: number | null = null;
    let lastError: string | null = null;

    for (const line of lines) {
      try {
        const event = JSON.parse(line) as { type: string; ts?: number; error?: string };
        const ts = typeof event.ts === 'number' ? event.ts : null;
        if (!ts) continue;

        // Direct LLM output counts as activity; turn_interrupted also counts
        // (claw was running but got interrupted — still an active state, not idle)
        if ((LLM_OUTPUT_EVENTS.has(event.type) || event.type === 'turn_interrupted') &&
            (lastEventMs === null || ts > lastEventMs)) {
          lastEventMs = ts;
        }

        // Only track terminal events to determine error state
        if (event.type === 'turn_end') {
          lastError = null;         // turn properly completed, clear error
        } else if (event.type === 'turn_error') {
          lastError = event.error ?? 'unknown error';
        }
        // turn_interrupted: neither clear nor set error
      } catch { /* skip */ }
    }

    return { lastEventMs, lastError };
  } catch {
    return { lastEventMs: null, lastError: null };
  }
}

// Check if a claw has an active or paused contract
export function clawHasContract(clawDir: string): boolean {
  for (const sub of ['active', 'paused']) {
    try {
      const entries = fs.readdirSync(path.join(clawDir, 'contract', sub), { withFileTypes: true });
      if (entries.some(e => e.isDirectory())) return true;
    } catch { /* skip */ }
  }
  return false;
}

// ---- Phase 18: gatherClawSnapshot ----

export interface ClawSnapshot {
  status: 'running' | 'stopped';
  contract: string;       // 'active:<id>' | 'paused:<id>' | 'none'
  inboxPending: number;
  outboxPending: number;
}

/** Duck-typed subset of ProcessManager used by gatherClawSnapshot */
export interface ProcessLiveness {
  isAlive(id: string): boolean;
}

export function gatherClawSnapshot(clawDir: string, pm: ProcessLiveness, clawId: string): ClawSnapshot {
  const status = pm.isAlive(clawId) ? 'running' : 'stopped';

  let contract = 'none';
  for (const sub of ['active', 'paused']) {
    try {
      const entries = fs.readdirSync(path.join(clawDir, 'contract', sub), { withFileTypes: true });
      const dir = entries.find(e => e.isDirectory());
      if (dir) { contract = `${sub}:${dir.name}`; break; }
    } catch { /* skip */ }
  }

  const countMd = (dir: string) => {
    try { return fs.readdirSync(dir).filter(f => f.endsWith('.md')).length; } catch { return 0; }
  };
  const inboxPending = countMd(path.join(clawDir, 'inbox', 'pending'));
  const outboxPending = countMd(path.join(clawDir, 'outbox', 'pending'));

  return { status, contract, inboxPending, outboxPending };
}

// ---- Phase 18: inactivity backoff pure helpers ----

/** Returns effective notification interval (3x after first 2 notifications) */
export function getEffectiveInterval(notifyCount: number, timeoutMs: number): number {
  return notifyCount >= 2 ? timeoutMs * 3 : timeoutMs;
}

/** Returns true if claw made new progress that should reset the notify counter */
export function shouldResetNotifyCount(
  lastEventMs: number | null,
  lastNotified: number,
): boolean {
  return lastEventMs !== null && lastEventMs > lastNotified;
}
