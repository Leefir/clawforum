/**
 * Pending subagent task file writer (phase163 Step 4).
 *
 * Direct file-based scheduling primitive used by spawn / dispatch tools.
 * Eliminates SubagentSystem→TaskSystem runtime business semantic call.
 * Watcher (TaskSystem._ingestPendingFile) consumes the file asynchronously.
 */
import { randomUUID } from 'crypto';
import { TASKS_PENDING_DIR } from '../../../types/paths.js';
import type { FileSystem } from '../../../foundation/fs/types.js';
import type { AuditWriter } from '../../../foundation/audit/writer.js';
import type { SubAgentTask } from '../../task/system.js';

/**
 * Write a pending subagent task file. Watcher will pick it up.
 * @returns The generated taskId.
 */
export async function writePendingSubagentTaskFile(
  fs: FileSystem,
  audit: AuditWriter | undefined,
  args: Omit<SubAgentTask, 'id' | 'createdAt'>,
): Promise<string> {
  const taskId = randomUUID();
  const task: SubAgentTask = {
    ...args,
    id: taskId,
    createdAt: new Date().toISOString(),
  };
  await fs.writeAtomic(
    `${TASKS_PENDING_DIR}/${taskId}.json`,
    JSON.stringify(task, null, 2),
  );
  audit?.write('task_scheduled', taskId, 'kind=subagent', `parent=${task.parentClawId}`);
  return taskId;
}
