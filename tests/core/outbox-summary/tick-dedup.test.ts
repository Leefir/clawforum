/**
 * phase 1476: tick orchestration + dedup integration tests.
 *
 * Covers:
 *  - 0 unread → clear motion inbox summary
 *  - first tick with unread → write new summary
 *  - re-tick same state → skip (pending hit dedup)
 *  - re-tick after motion CLI consumed (mv done) → skip (done hit dedup within 24h)
 *  - re-tick after done file aged > 24h → write new (mtime window expired)
 *  - state change (new msg) → clear old pending + write new
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fsAsync from 'fs/promises';
import * as path from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { runOutboxSummaryTick } from '../../../src/core/outbox-summary/tick.js';
import { SUMMARY_FILENAME_PATTERN, DEDUP_DONE_WINDOW_MS } from '../../../src/core/outbox-summary/dedup.js';
import { NodeFileSystem } from '../../../src/foundation/fs/node-fs.js';
import { makeChestnutRoot } from '../../../src/foundation/identity/index.js';

function makeAudit() {
  const events: Array<[string, ...(string | number)[]]> = [];
  const audit = {
    write: (type: string, ...cols: (string | number)[]) => { events.push([type, ...cols]); },
  };
  return { audit, events };
}

async function listSummaries(root: string, sub: 'pending' | 'done'): Promise<string[]> {
  try {
    const all = await fsAsync.readdir(path.join(root, 'motion/inbox', sub));
    return all.filter(n => SUMMARY_FILENAME_PATTERN.test(n));
  } catch { return []; }
}

describe('phase 1476: runOutboxSummaryTick orchestration', () => {
  let root: string;
  let fs: NodeFileSystem;
  let audit: ReturnType<typeof makeAudit>['audit'];
  let events: ReturnType<typeof makeAudit>['events'];

  beforeEach(async () => {
    root = path.join(tmpdir(), `outbox-summary-tick-${randomUUID()}`);
    await fsAsync.mkdir(path.join(root, 'claws'), { recursive: true });
    await fsAsync.mkdir(path.join(root, 'motion/inbox/pending'), { recursive: true });
    await fsAsync.mkdir(path.join(root, 'motion/inbox/done'), { recursive: true });
    fs = new NodeFileSystem({ baseDir: root });
    ({ audit, events } = makeAudit());
  });

  afterEach(async () => {
    await fsAsync.rm(root, { recursive: true, force: true }).catch(() => {});
  });

  it('0 unread + no existing summary → no write, no audit', async () => {
    await runOutboxSummaryTick({ chestnutRoot: makeChestnutRoot(root), fs, audit });
    expect(await listSummaries(root, 'pending')).toEqual([]);
    expect(events.filter(e => String(e[0]).startsWith('cron_outbox_summary')).length).toBe(0);
  });

  it('first tick with unread → writes new summary + emits WRITTEN', async () => {
    await fsAsync.mkdir(path.join(root, 'claws/clawA/outbox/pending'), { recursive: true });
    await fsAsync.writeFile(path.join(root, 'claws/clawA/outbox/pending/m1.md'), 'x');
    await runOutboxSummaryTick({ chestnutRoot: makeChestnutRoot(root), fs, audit });
    const summaries = await listSummaries(root, 'pending');
    expect(summaries.length).toBe(1);
    expect(events.some(e => e[0] === 'cron_outbox_summary_written')).toBe(true);
  });

  it('re-tick same state → SKIPPED (pending hit)', async () => {
    await fsAsync.mkdir(path.join(root, 'claws/clawA/outbox/pending'), { recursive: true });
    await fsAsync.writeFile(path.join(root, 'claws/clawA/outbox/pending/m1.md'), 'x');
    await runOutboxSummaryTick({ chestnutRoot: makeChestnutRoot(root), fs, audit });
    const firstSummary = (await listSummaries(root, 'pending'))[0];
    events.length = 0;
    await runOutboxSummaryTick({ chestnutRoot: makeChestnutRoot(root), fs, audit });
    expect((await listSummaries(root, 'pending'))[0]).toBe(firstSummary);
    expect(events.some(e => e[0] === 'cron_outbox_summary_skipped' && e.includes('reason=pending'))).toBe(true);
  });

  it('after motion CLI consumed (mv done) re-tick → SKIPPED (done hit within 24h)', async () => {
    await fsAsync.mkdir(path.join(root, 'claws/clawA/outbox/pending'), { recursive: true });
    await fsAsync.writeFile(path.join(root, 'claws/clawA/outbox/pending/m1.md'), 'x');
    await runOutboxSummaryTick({ chestnutRoot: makeChestnutRoot(root), fs, audit });
    const summary = (await listSummaries(root, 'pending'))[0];
    // simulate motion CLI consumption
    await fsAsync.rename(
      path.join(root, 'motion/inbox/pending', summary),
      path.join(root, 'motion/inbox/done', summary),
    );
    events.length = 0;
    await runOutboxSummaryTick({ chestnutRoot: makeChestnutRoot(root), fs, audit });
    expect(await listSummaries(root, 'pending')).toEqual([]);
    expect(events.some(e => e[0] === 'cron_outbox_summary_skipped' && e.includes('reason=done'))).toBe(true);
  });

  it('done file aged > 24h → write new (mtime window expired)', async () => {
    await fsAsync.mkdir(path.join(root, 'claws/clawA/outbox/pending'), { recursive: true });
    await fsAsync.writeFile(path.join(root, 'claws/clawA/outbox/pending/m1.md'), 'x');
    await runOutboxSummaryTick({ chestnutRoot: makeChestnutRoot(root), fs, audit });
    const summary = (await listSummaries(root, 'pending'))[0];
    await fsAsync.rename(
      path.join(root, 'motion/inbox/pending', summary),
      path.join(root, 'motion/inbox/done', summary),
    );
    // backdate mtime > 24h
    const old = Date.now() - DEDUP_DONE_WINDOW_MS - 60_000;
    await fsAsync.utimes(path.join(root, 'motion/inbox/done', summary), old / 1000, old / 1000);
    events.length = 0;
    await runOutboxSummaryTick({ chestnutRoot: makeChestnutRoot(root), fs, audit });
    expect((await listSummaries(root, 'pending')).length).toBe(1);
    expect(events.some(e => e[0] === 'cron_outbox_summary_written')).toBe(true);
  });

  it('state change → archive old pending to done + write new (DP 不丢弃)', async () => {
    await fsAsync.mkdir(path.join(root, 'claws/clawA/outbox/pending'), { recursive: true });
    await fsAsync.writeFile(path.join(root, 'claws/clawA/outbox/pending/m1.md'), 'x');
    await runOutboxSummaryTick({ chestnutRoot: makeChestnutRoot(root), fs, audit });
    const firstSummary = (await listSummaries(root, 'pending'))[0];

    // add new msg → different hash
    await fsAsync.writeFile(path.join(root, 'claws/clawA/outbox/pending/m2.md'), 'y');
    events.length = 0;
    await runOutboxSummaryTick({ chestnutRoot: makeChestnutRoot(root), fs, audit });
    const summaries = await listSummaries(root, 'pending');
    expect(summaries.length).toBe(1);
    expect(summaries[0]).not.toBe(firstSummary);
    // 旧 summary 必须在 done 内（archive 语义、不 delete）
    expect(await listSummaries(root, 'done')).toContain(firstSummary);
    expect(events.some(e => e[0] === 'cron_outbox_summary_written')).toBe(true);
  });

  it('all unread消费 + new tick → CLEARED (archive 旧 pending summary to done / DP 不丢弃)', async () => {
    await fsAsync.mkdir(path.join(root, 'claws/clawA/outbox/pending'), { recursive: true });
    await fsAsync.writeFile(path.join(root, 'claws/clawA/outbox/pending/m1.md'), 'x');
    await runOutboxSummaryTick({ chestnutRoot: makeChestnutRoot(root), fs, audit });
    const summary = (await listSummaries(root, 'pending'))[0];
    // simulate motion consumed all outbox via CLI
    await fsAsync.rm(path.join(root, 'claws/clawA/outbox/pending/m1.md'));
    events.length = 0;
    await runOutboxSummaryTick({ chestnutRoot: makeChestnutRoot(root), fs, audit });
    expect(await listSummaries(root, 'pending')).toEqual([]);
    // 旧 summary 必须在 done 内（archive、不 delete）
    expect(await listSummaries(root, 'done')).toContain(summary);
    expect(events.some(e => e[0] === 'cron_outbox_summary_cleared')).toBe(true);
  });
});
