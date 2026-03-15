/**
 * Transport interface (F4)
 * Phase 0: Interface definitions only
 * 
 * Design principles:
 * - Abstract communication between Claws and Motion
 * - Local implementation uses file system (inbox/outbox)
 * - Distributed implementation can use message queue / HTTP
 */

import type { InboxMessage, OutboxMessage, Contract, Priority } from '../../types/index.js';

// Re-export types for convenience
export type { InboxMessage, OutboxMessage, Contract, Priority };

/**
 * Transport message envelope
 * Used for both inbox and outbox messages with metadata
 */
export interface TransportMessage<T = unknown> {
  id: string;
  timestamp: string;
  priority: Priority;
  payload: T;
  metadata?: {
    source?: string;
    attempt?: number;
    expiresAt?: string;
  };
}

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
 * 
 * Implementation notes:
 * - Local implementation uses file system directories
 * - Distributed implementation can use Redis/RabbitMQ/HTTP
 * - Messages are persisted until acknowledged
 */
export interface ITransport {
  // ========================================================================
  // Message Operations
  // ========================================================================
  
  /**
   * Send a message to a Claw's inbox
   * @param clawId - Target Claw ID
   * @param message - Message to send
   */
  sendInboxMessage(clawId: string, message: InboxMessage): Promise<void>;
  
  /**
   * Send a message to Motion's inbox
   * @param motionId - Target Motion ID
   * @param message - Message to send
   */
  sendMotionMessage(motionId: string, message: OutboxMessage): Promise<void>;
  
  /**
   * Read messages from a Claw's inbox
   * @param clawId - Claw ID
   * @param options - Read options
   * @returns Messages
   */
  readInbox(clawId: string, options?: {
    limit?: number;
    since?: Date;
    unreadOnly?: boolean;
  }): Promise<InboxMessage[]>;
  
  /**
   * Read messages from a Claw's outbox
   * @param clawId - Claw ID
   * @param options - Read options
   * @returns Messages
   */
  readOutbox(clawId: string, options?: {
    limit?: number;
    since?: Date;
  }): Promise<OutboxMessage[]>;
  
  /**
   * Mark inbox message as read
   * @param clawId - Claw ID
   * @param messageId - Message ID
   */
  markAsRead(clawId: string, messageId: string): Promise<void>;
  
  /**
   * Get inbox status summary
   * @param clawId - Claw ID
   */
  getInboxStatus(clawId: string): Promise<InboxStatus>;
  
  // ========================================================================
  // Contract Operations
  // ========================================================================
  
  /**
   * Dispatch a contract to a Claw
   * @param clawId - Target Claw ID
   * @param contract - Contract to dispatch
   */
  dispatchContract(clawId: string, contract: Contract): Promise<void>;
  
  /**
   * Get contract status
   * @param contractId - Contract ID
   * @returns Contract or null if not found
   */
  getContract(contractId: string): Promise<Contract | null>;
  
  /**
   * Update contract status
   * @param contractId - Contract ID
   * @param updates - Fields to update
   */
  updateContract(
    contractId: string, 
    updates: Partial<Omit<Contract, 'id'>>
  ): Promise<void>;
  
  /**
   * List contracts for a Claw
   * @param clawId - Claw ID
   * @param status - Filter by status
   */
  listContracts(
    clawId: string, 
    status?: Contract['status']
  ): Promise<Contract[]>;
  
  // ========================================================================
  // Health Monitoring
  // ========================================================================
  
  /**
   * Send heartbeat from Claw
   * @param clawId - Claw ID
   * @param status - Current status
   */
  sendHeartbeat(
    clawId: string, 
    status: {
      status: 'idle' | 'working' | 'error';
      currentContract?: string;
      memoryUsage?: number;
    }
  ): Promise<void>;
  
  /**
   * Check if a Claw is alive
   * @param clawId - Claw ID
   * @returns Health status
   */
  isClawAlive(clawId: string): Promise<ClawHealth>;
  
  /**
   * Get all active Claws
   * @param motionId - Motion ID
   */
  getActiveClaws(motionId: string): Promise<string[]>;
  
  /**
   * Watch for messages to a Claw
   * @param clawId - Claw ID
   * @param callback - Called when new message arrives
   */
  watchInbox(
    clawId: string, 
    callback: (message: InboxMessage) => void
  ): Promise<() => Promise<void>>;
  
  // ========================================================================
  // Lifecycle
  // ========================================================================
  
  /**
   * Initialize transport (create directories, connections, etc.)
   */
  initialize(): Promise<void>;
  
  /**
   * Close transport and cleanup resources
   */
  close(): Promise<void>;
}

/**
 * Transport configuration
 */
export interface TransportConfig {
  /** Transport type */
  type: 'local' | 'redis' | 'http';
  
  /** Base directory for local transport */
  baseDir?: string;
  
  /** Redis connection string (for redis type) */
  redisUrl?: string;
  
  /** HTTP endpoint (for http type) */
  httpEndpoint?: string;
  
  /** Message retention time in hours (default: 168 = 7 days) */
  retentionHours?: number;
}
