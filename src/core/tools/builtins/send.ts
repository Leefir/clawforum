/**
 * send tool - Send message to outbox
 */

import * as path from 'path';
import { randomUUID } from 'crypto';
import type { ITool, ToolResult, ExecContext } from '../executor.js';

export const sendTool: ITool = {
  name: 'send',
  description: 'Send a message to the outbox for the parent or other claws. Priority: critical|high|normal|low (default: normal).',
  schema: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'Message content',
      },
      type: {
        type: 'string',
        description: 'Message type: report|question|result|error',
        enum: ['report', 'question', 'result', 'error'],
      },
      priority: {
        type: 'string',
        description: 'Message priority: critical|high|normal|low (default: normal)',
        enum: ['critical', 'high', 'normal', 'low'],
        default: 'normal',
      },
    },
    required: ['content', 'type'],
  },
  requiredPermissions: ['send'],
  readonly: false,

  async execute(args: Record<string, unknown>, ctx: ExecContext): Promise<ToolResult> {
    const content = args.content as string;
    const type = args.type as string;
    const priority = (args.priority as string) ?? 'normal';

    // Validate type
    const validTypes = ['report', 'question', 'result', 'error'];
    if (!validTypes.includes(type)) {
      return {
        success: false,
        content: `Invalid message type: ${type}. Must be one of: ${validTypes.join(', ')}`,
      };
    }

    // Validate priority
    const validPriorities = ['critical', 'high', 'normal', 'low'];
    if (!validPriorities.includes(priority)) {
      return {
        success: false,
        content: `Invalid priority: ${priority}. Must be one of: ${validPriorities.join(', ')}`,
      };
    }

    try {
      // Create outbox/pending directory
      const outboxDir = path.join('outbox', 'pending');
      await ctx.fs.ensureDir(outboxDir);

      // Generate filename: {timestamp}_{priority}_{type}_{uuid}.md (MVP aligned)
      const timestamp = Date.now();
      const filename = `${timestamp}_${priority}_${type}_${randomUUID().slice(0, 8)}.md`;
      const filePath = path.join(outboxDir, filename);

      // Write message
      const messageContent = `# ${type.toUpperCase()}\n\n${content}\n\n---\nTimestamp: ${new Date().toISOString()}\n`;
      await ctx.fs.writeAtomic(filePath, messageContent);

      return {
        success: true,
        content: `消息已发送: ${type}`,
      };
    } catch (error) {
      return {
        success: false,
        content: `Error sending message: ${(error as Error).message}`,
      };
    }
  },
};
