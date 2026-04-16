/**
 * Inbox message validation utilities
 * Message field validation for MessageCodec
 */

import type { InboxMessage } from '../../types/index.js';
import type { Priority } from '../../types/contract.js';

export const VALID_PRIORITIES: Priority[] = ['critical', 'high', 'normal', 'low'];
export const VALID_TYPES = [
  'message', 'user_chat', 'user_inbox_message',
  'crash_notification', 'heartbeat', 'claw_outbox',
];

export function validatePriority(value: unknown): Priority {
  if (typeof value === 'string' && VALID_PRIORITIES.includes(value as Priority)) {
    return value as Priority;
  }
  return 'normal';
}

export function validateType(value: unknown): InboxMessage['type'] {
  if (typeof value !== 'string') return 'message';
  return value;
}
