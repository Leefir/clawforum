import type { OutboxMessage } from '../../types/messaging.js';

/**
 * Encode OutboxMessage to markdown string.
 * Pure function: no I/O, no side effects.
 */
export function encodeOutbox(msg: OutboxMessage): string {
  const lines = [
    `# ${msg.type.toUpperCase()}`,
    '',
    `**From:** ${msg.from}`,
    `**To:** ${msg.to}`,
    `**Time:** ${msg.timestamp}`,
    msg.contract_id ? `**Contract:** ${msg.contract_id}` : null,
    '',
    '---',
    '',
    msg.content,
  ];

  return lines.filter(l => l !== null).join('\n');
}
