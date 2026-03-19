/**
 * Outbox Scanner - 扫描所有 Claw 的 outbox/pending，
 * 有未读消息时向 motion inbox 写入通知（去重，保留最新一条）
 */

import * as path from 'path';
import * as fsNative from 'fs';
import { randomUUID } from 'crypto';
import { writeInboxMessage } from '../utils/inbox-writer.js';

/**
 * 扫描所有 claw outbox/pending，有未读则写通知到 motion inbox。
 * inbox/pending 中同一时刻只保留最新一条 _claw_outbox_ 通知。
 */
export function scanClawOutboxes(baseDir: string): void {
  try {
    const clawsDir = path.join(baseDir, 'claws');
    if (!fsNative.existsSync(clawsDir)) return;

    const clawIds = fsNative.readdirSync(clawsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    const counts: Record<string, number> = {};
    for (const id of clawIds) {
      const outboxPending = path.join(clawsDir, id, 'outbox', 'pending');
      try {
        const files = fsNative.readdirSync(outboxPending).filter(f => f.endsWith('.md'));
        if (files.length > 0) {
          counts[id] = files.length;
        }
      } catch { /* directory may not exist */ }
    }

    const inboxDir = path.join(baseDir, 'motion', 'inbox', 'pending');
    fsNative.mkdirSync(inboxDir, { recursive: true });

    // 去重：删除已有的 outbox 通知
    try {
      const existing = fsNative.readdirSync(inboxDir);
      for (const f of existing) {
        if (f.includes('_claw_outbox_')) {
          try { fsNative.unlinkSync(path.join(inboxDir, f)); } catch (err) {
            console.warn(`[outbox-scanner] Failed to remove old notification ${f}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
    } catch {}

    if (Object.keys(counts).length === 0) return;

    const summary = Object.entries(counts)
      .map(([id, n]) => `${id}(${n})`)
      .join(', ');

    writeInboxMessage({
      inboxDir,
      type: 'claw_outbox',
      source: 'system',
      priority: 'normal',
      body: `未处理 claw outbox: ${summary}`,
    });
  } catch (error) {
    process.stderr.write(`[OutboxScanner] scan failed: ${error}\n`);
  }
}
