/**
 * Inbox writer - write messages to inbox/pending/
 *
 * Core write operation for the Messaging module.
 * Uses IFileSystem for async, atomic writes.
 */

import * as path from 'path';
import { randomUUID } from 'crypto';
import type { IFileSystem } from '../fs/types.js';
import type { InboxMessage } from '../../types/contract.js';
import { encodeInbox } from '../message-codec/index.js';

/**
 * Write a message to an inbox/pending/ directory.
 *
 * @param fs - FileSystem instance
 * @param inboxDir - Absolute path to inbox/pending/
 * @param msg - Message to write
 * @param extraFields - Optional extra YAML frontmatter fields
 */
export async function writeInbox(
  fs: IFileSystem,
  inboxDir: string,
  msg: InboxMessage,
  extraFields?: Record<string, string>,
): Promise<void> {
  await fs.ensureDir(inboxDir);

  const timestamp = Date.now();
  const priority = msg.priority ?? 'normal';
  const filename = `${timestamp}_${priority}_${randomUUID().slice(0, 8)}.md`;
  const filePath = path.join(inboxDir, filename);

  await fs.writeAtomic(filePath, encodeInbox(msg, extraFields));
}
