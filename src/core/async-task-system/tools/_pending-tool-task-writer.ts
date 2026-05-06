/**
 * Pending tool task file writer (phase432).
 *
 * Direct file-based scheduling primitive for async tool tasks.
 * Watcher (AsyncTaskSystem._ingestPendingFile) consumes the file asynchronously.
 */
import { randomUUID } from 'crypto';
import { TASKS_PENDING_DIR } from '../../../types/paths.js';
import type { FileSystem } from '../../../foundation/fs/types.js';
import type { AuditLog } from '../../../foundation/audit/index.js';
import type { AsyncToolTaskArgs } from '../../../foundation/tools/async-dispatch.js';

/**
 * Write a pending tool task file. Watcher will pick it up.
 * @returns The generated taskId.
 */
export async function writePendingToolTaskFile(
  fs: FileSystem,
  audit: AuditLog | undefined,
  args: AsyncToolTaskArgs,
): Promise<string> {
  const taskId = randomUUID();
  const task = {
    kind: 'tool',
    id: taskId,
    createdAt: new Date().toISOString(),
    ...args,
  };
  await fs.writeAtomic(
    `${TASKS_PENDING_DIR}/${taskId}.json`,
    JSON.stringify(task, null, 2),
  );
  audit?.write('task_scheduled', taskId, 'kind=tool', `parent=${args.parentClawId}`, `tool=${args.toolName}`);
  return taskId;
}
