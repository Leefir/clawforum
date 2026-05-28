/**
 * @module L6.CLI.ChatViewport.Utils
 * Pure utility helpers for chat-viewport — 0 闭包依赖
 */

import * as path from 'path';
import type { FileSystem } from '../../foundation/fs/types.js';
import { notifyClaw } from '../../foundation/messaging/index.js';
import { makeClawforumRoot } from '../../foundation/identity/index.js';
import { getClawforumRoot } from '../../foundation/paths.js';
import { createDirContext } from '../../foundation/process-manager/factories.js';
/** 写用户输入到 inbox（chat 命令期间用户输入流入 daemon）/ 1:1 保 chat-viewport.ts:78-89 body */
export function writeUserChat(agentDir: string, message: string, fsFactory: (baseDir: string) => FileSystem): void {
  const { fs, audit } = createDirContext({ fsFactory }, agentDir);
  // phase 1388 Bug A fix: dirname 单层在普通 claw 布局错位 (`.clawforum/claws/<id>` → `.clawforum/claws` 而非 `.clawforum`)
  // 改用 env-based getClawforumRoot() single truth source / Motion + 普通 claw 同表达式
  const clawforumRoot = makeClawforumRoot(getClawforumRoot());
  const clawId = path.basename(agentDir);
  notifyClaw(fs, clawforumRoot, clawId, {
    type: 'user_chat',
    source: 'user',
    priority: 'high',
    body: message,
    idPrefix: 'chat',
  }, audit);
}

/** 格式化毫秒为可读时长 / 1:1 保 chat-viewport.ts:90-95 body */
export function fmtDuration(ms: number): string {
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m}m`;
}


