/**
 * Message types - Core messaging data structures
 * Phase 0: Interface definitions only
 */

export type Role = 'user' | 'assistant' | 'system';

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
  signature?: string;
}

export interface UnknownBlock {
  type: string;
  [key: string]: unknown;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | ThinkingBlock | UnknownBlock;

export interface Message {
  role: Role;
  content: ContentBlock[] | string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: JSONSchema7;
}

export interface LLMResponse {
  content: ContentBlock[];
  stop_reason: 'tool_use' | 'end_turn' | 'max_tokens' | string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
  model?: string;
}

// JSON Schema 7 type definitions (simplified)
export interface JSONSchema7 {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null' | string;
  properties?: Record<string, JSONSchema7>;
  required?: string[];
  description?: string;
  enum?: unknown[];
  items?: JSONSchema7;
  additionalProperties?: boolean | JSONSchema7;
  default?: unknown;
  [key: string]: unknown;
}
