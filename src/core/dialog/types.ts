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
  
  /** Markers for pruned/compressed sections (Phase 3) */
  prunedMarkers: Array<{
    startIndex: number;
    endIndex: number;
    summary: string;
  }>;
}

/**
 * Options for context injection
 */
export interface InjectorOptions {
  /** Include active contract summaries */
  includeContracts?: boolean;
  
  /** Include skill metadata */
  includeSkills?: boolean;
  
  /** Include tool definitions */
  includeTools?: boolean;
}
