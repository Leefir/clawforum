/**
 * Contract types - Task management and orchestration
 * Phase 0: Interface definitions only
 */

export type ContractStatus = 
  | 'pending'    // Waiting to be picked up
  | 'running'    // Currently being executed
  | 'paused'     // Temporarily suspended
  | 'completed'  // Successfully finished
  | 'failed'     // Execution failed
  | 'cancelled'; // Manually cancelled

export type Priority = 'low' | 'normal' | 'high' | 'critical';

/**
 * Priority values for sorting (higher = more important)
 */
export const PRIORITY_VALUES: Record<Priority, number> = {
  critical: 4,
  high: 3,
  normal: 2,
  low: 1,
};

export interface SubTask {
  id: string;
  description: string;
  status: ContractStatus;
  assignee?: string;  // Claw ID
  result?: string;
  error?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

export interface Contract {
  id: string;
  title: string;
  description: string;
  status: ContractStatus;
  priority: Priority;
  
  // Creator and assignee
  creator: string;     // Motion ID or Claw ID that created this
  assignee?: string;   // Claw ID assigned to execute
  
  // Task structure
  goal: string;
  deliverables: string[];
  subtasks: SubTask[];
  
  // Context
  context_files?: string[];
  skills?: string[];   // Required skills
  
  // Auth level for actions
  auth_level: 'auto' | 'notify' | 'confirm';
  
  // Timestamps
  created_at: string;
  updated_at: string;
  started_at?: string;
  completed_at?: string;
  deadline?: string;
  
  // Results
  result_summary?: string;
  output_files?: string[];
  error_message?: string;
}

export interface InboxMessage {
  id: string;
  type: 'contract' | 'command' | 'message'
      | 'crash_recovery' | 'stall_nudge' | 'outbox_notify' | 'crash_notification';
  from: string;        // Sender Claw/Motion ID
  to: string;          // Recipient Claw ID
  content: string;
  priority: Priority;
  timestamp: string;
  contract_id?: string;
  reply_to?: string;   // For threading
}

export interface OutboxMessage {
  id: string;
  type: 'response' | 'contract_update' | 'status_report';
  from: string;        // Sender Claw ID
  to: string;          // Recipient Claw/Motion ID
  content: string;
  timestamp: string;
  contract_id?: string;
  in_reply_to?: string;
}

export interface HeartbeatEntry {
  claw_id: string;
  timestamp: string;
  status: 'idle' | 'working' | 'error';
  current_contract?: string;
  message_count: number;
  memory_usage?: number;
}
