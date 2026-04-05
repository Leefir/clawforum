/**
 * Transport module (F4)
 * Phase 0: LocalTransport implementation
 * 
 * Exports: ITransport interface, LocalTransport implementation
 */

// Implementation
export { LocalTransport } from './local.js';
export type { LocalTransportOptions } from './local.js';

// Types - defined in this file to avoid re-export conflicts
import type { Priority } from '../../types/index.js';
export type { Priority };

/**
 * Inbox status for a Claw
 */
export interface InboxStatus {
  total: number;
  unread: number;
  highPriority: number;
  oldestMessage?: string;
}

/**
 * Claw health status
 */
export interface ClawHealth {
  alive: boolean;
  lastHeartbeat?: string;
  currentContract?: string;
  status: 'idle' | 'working' | 'error' | 'unknown';
  memoryUsage?: number;
  pid?: number;
}

/**
 * Transport interface - Communication abstraction
 */

import type { InboxMessage } from '../../types/index.js';
export type { InboxMessage };

export interface ITransport {
  // ========================================================================
  // Lifecycle
  // ========================================================================
  initialize(): Promise<void>;
  close(): Promise<void>;

  // ========================================================================
  // Inbox Operations
  // ========================================================================
  sendInboxMessage(clawId: string, msg: InboxMessage): Promise<void>;
  readInbox(clawId: string, options?: {
    limit?: number;
    since?: Date;
    unreadOnly?: boolean;
  }): Promise<InboxMessage[]>;
  markAsRead(clawId: string, messageId: string): Promise<void>;
  getInboxStatus(clawId: string): Promise<InboxStatus>;
  watchInbox(clawId: string, callback: (message: InboxMessage) => void): Promise<() => Promise<void>>;

  // ========================================================================
  // Health Monitoring
  // ========================================================================
  sendHeartbeat(entry: { claw_id: string; timestamp: string; status: 'idle' | 'working' | 'error'; message_count: number; }): Promise<void>;
  isClawAlive(clawId: string): Promise<boolean>;
  getActiveClaws(): Promise<string[]>;
}
