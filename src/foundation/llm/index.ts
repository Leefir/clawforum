/**
 * LLM Service module (F2)
 * Phase 0: Anthropic adapter + failover service
 * 
 * Exports: ILLMService interface, LLMService implementation, AnthropicAdapter
 */

// Re-export from central types
export type {
  Message,
  ToolDefinition,
  LLMResponse,
  ContentBlock,
  TextBlock,
  ToolUseBlock,
  ToolResultBlock,
} from '../../types/message.js';

// Internal types
export type {
  ProviderConfig,
  LLMServiceConfig,
  LLMCallOptions,
  StreamChunk,
  IProviderAdapter,
} from './types.js';

// Implementation
export { LLMService } from './service.js';
export { AnthropicAdapter } from './anthropic.js';

/**
 * ILLMService interface
 * 
 * Note: This is kept here for backward compatibility.
 * The LLMService class implements this interface structurally.
 * Import types from './types.js' for the full signature.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ILLMService {
  // Methods are defined in LLMService class
}
