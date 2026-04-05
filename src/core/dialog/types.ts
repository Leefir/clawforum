/**
 * Dialog module internal types
 */

import type { Message } from '../../types/message.js';

/**
 * Session data structure stored in current.json
 */
export interface SessionData {
  /** Version for migration handling */
  version: number;
  
  /** Claw identifier */
  clawId: string;
  
  /** Session creation time */
  createdAt: string;
  
  /** Last update time */
  updatedAt: string;
  
  /** Conversation messages */
  messages: Message[];
}
