/**
 * @module L6.CLI.Claw.Outbox
 * Read and consume Claw outbox messages
 */

import * as fs from 'fs';
import * as path from 'path';
import { getClawDir } from '../../foundation/config/index.js';
import { CliError } from '../errors.js';

export async function outboxCommand(
  name: string,
  options?: { limit?: number }
): Promise<void> {
  // Outbox drain is a pure filesystem operation — we don't require config.yaml.
  // Motion's outbox scanner reports any claw dir containing pending/*.md, so the
  // CLI must be able to drain the same set, including orphan claws that have
  // outbox files but no config (e.g. abandoned or half-created claws).
  const clawDir = getClawDir(name);
  if (!fs.existsSync(clawDir)) {
    throw new CliError(
      `Claw directory not found: ${clawDir}. ` +
      `Expected at {CLAWFORUM_ROOT}/.clawforum/claws/<name>/.`
    );
  }

  const pendingDir = path.join(clawDir, 'outbox', 'pending');
  const doneDir = path.join(clawDir, 'outbox', 'done');

  // Read pending files
  let files: string[] = [];
  try {
    const allFiles = await fs.promises.readdir(pendingDir);
    files = allFiles.filter(f => f.endsWith('.md')).sort();
  } catch {
    console.log('outbox is empty');
    return;
  }

  if (files.length === 0) {
    console.log('outbox is empty');
    return;
  }

  // Limit number of messages read (default 1)
  const limit = options?.limit ?? 1;
  const toRead = files.slice(0, limit);
  const remaining = files.length - toRead.length;

  // Read and output
  const results: string[] = [];
  for (const fileName of toRead) {
    const filePath = path.join(pendingDir, fileName);
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      results.push(content);

      // Move to done/
      try {
        await fs.promises.mkdir(doneDir, { recursive: true });
        await fs.promises.rename(filePath, path.join(doneDir, `${Date.now()}_${fileName}`));
      } catch (err) {
        console.warn(`[outbox] Failed to move ${fileName} to done: ${err instanceof Error ? err.message : String(err)}`);
      }
    } catch {
      // skip on read failure
    }
  }

  // Output
  for (const content of results) {
    console.log(content);
    console.log('---');
  }

  if (remaining > 0) {
    console.log(`(${remaining} more unread message(s))`);
  }
}
