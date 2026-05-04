/**
 * @module L2.DialogStore
 * DialogStore module (L2)
 *
 * Messages array persistence. Serves crash-recoverable sessions.
 * Dependency: FileSystem
 */

export { DialogStore, MarkerNotFoundError } from './store.js';
export type { SessionData, LoadResult, DialogMarker, RestoreResult } from './types.js';

import type { FileSystem } from '../fs/types.js';
import type { AuditLog } from '../audit/index.js';
import { DialogStore } from './store.js';

export function createDialogStore(
  fs: FileSystem,
  dialogDir: string,
  audit: AuditLog,
  filename: string,                       // phase 450: 必填
  systemPrompt: string,                   // phase 466: 必填 / 一次性锁定
  clawId?: string,                        // phase 450: 可选
  archiveDir?: string,                    // phase 450: 可选
): DialogStore {
  return new DialogStore(fs, dialogDir, audit, filename, systemPrompt, clawId, archiveDir);
}
