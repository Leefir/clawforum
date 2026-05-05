/**
 * @module L6.CLI.Claw.Send
 * Send an inbox message to a Claw
 */

import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  loadGlobalConfig, clawExists, getGlobalConfigPath,
} from '../../foundation/config/index.js';
import { CliError } from '../errors.js';
import { NodeFileSystem } from '../../foundation/fs/node-fs.js';
import { InboxWriter } from '../../foundation/messaging/index.js';
import { createSystemAudit } from '../../foundation/audit/index.js';

export async function sendCommand(
  name: string, 
  message: string, 
  options?: { priority?: 'critical' | 'high' | 'normal' | 'low' }
): Promise<void> {
  loadGlobalConfig();
  
  if (!clawExists(name)) {
    throw new CliError(`Claw "${name}" does not exist`);
  }

  const globalConfigPath = getGlobalConfigPath();
  const baseDir = path.dirname(globalConfigPath);
  const clawDir = path.join(baseDir, 'claws', name);
  const inboxPending = path.join(clawDir, 'inbox', 'pending');
  const fs = new NodeFileSystem({ baseDir: '/' });
  const audit = createSystemAudit(fs, clawDir);

  await new InboxWriter(fs, inboxPending, audit).write({
    id: randomUUID(),
    type: 'user_inbox_message',
    from: 'user',
    to: name,
    content: message,
    priority: options?.priority ?? 'normal',
    timestamp: new Date().toISOString(),
  });

  console.log(`Message sent to "${name}"`);
}
