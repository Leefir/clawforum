/**
 * Types module - Unified exports
 * Phase 0: All type definitions
 */

// Message types
export type {
  Role,
  TextBlock,
  ToolUseBlock,
  ToolResultBlock,
  ContentBlock,
  Message,
  ToolDefinition,
  LLMResponse,
  JSONSchema7,
} from './message.js';

// Contract types
export type {
  ContractStatus,
  Priority,
  SubTask,
  Contract,
  InboxMessage,
  OutboxMessage,
  HeartbeatEntry,
} from './contract.js';

// Config types
export type { ToolProfile } from './config.js';

// Error types
export type {
  ErrorCode,
  ErrorDetails,
} from './errors.js';

export {
  ClawError,
  PermissionError,
  PathNotInClawSpaceError,
  WriteOperationForbiddenError,
  ToolError,
  ToolNotFoundError,
  ToolInvalidInputError,
  ToolTimeoutError,
  LLMError,
  LLMRateLimitError,
  LLMTimeoutError,
  LLMInvalidResponseError,
  LLMAllProvidersFailedError,
  ContractError,
  ContractNotFoundError,
  ContractValidationError,
  SubTaskNotFoundError,
  FileSystemError,
  FileNotFoundError,
  FileAlreadyExistsError,
  MaxStepsExceededError,
  ConfigInvalidError,
  SubAgentFailedError,
} from './errors.js';
