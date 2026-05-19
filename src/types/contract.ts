/**
 * Contract types - Task management and orchestration
 * Phase 0: Interface definitions only
 */

import type { Priority } from './priority.js';

export type ContractStatus =
  | 'pending'    // Waiting to be picked up
  | 'running'    // Currently being executed
  | 'paused'     // Temporarily suspended
  | 'completed'  // Successfully finished
  | 'failed'     // Execution failed
  | 'cancelled'; // Manually cancelled

export type SubtaskStatus =
  | 'todo'         // Not yet started (within a running contract)
  | 'in_progress'  // Undergoing acceptance verification
  | 'completed'    // Successfully finished
  | 'failed';      // Reserved terminal status; fire-and-forget acceptance 路径不进入（phase 468 / feedback driven）

/**
 * 失败反馈结构化（phase 468 / feedback driven）
 * 三类失败统一转 'todo' + retry_count++ + last_failed_feedback 升级
 * cause 字段帮 agent 区分语义但不引入新 SubtaskStatus 进入路径
 */
export interface LastFailedFeedback {
  feedback: string;
  cause: 'llm_rejected' | 'programming_bug' | 'subagent_timeout' | 'script_failed';
}

/**
 * inbox `acceptance_failed` 通知 payload（onNotify callback）
 * agent 决策上下文完整（cause + retry context）
 */
export interface AcceptanceFailedNotification {
  contract_id: string;
  subtask_id: string;
  cause: 'llm_rejected' | 'programming_bug' | 'subagent_timeout' | 'script_failed';
  feedback: string;
  retry_count: number;
  max_retries: number;
}

export interface SubTask {
  id: string;
  description: string;
  status: SubtaskStatus;
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

  // Creator
  creator: string;     // Motion ID or Claw ID that created this

  // Task structure
  goal: string;
  subtasks: SubTask[];

  // Auth level for actions
  auth_level: 'auto' | 'notify' | 'confirm';

  // Timestamps
  created_at: string;
  updated_at: string;
  started_at?: string;
  completed_at?: string;
}

