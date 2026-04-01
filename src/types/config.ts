/**
 * Config types - System configuration schemas
 * Phase 0: Zod schemas with TypeScript type inference
 * 
 * NOTE: This file now only exports ToolProfile type.
 * All other config schemas have been moved to cli/config.ts
 * as they are CLI-specific and not used by the core runtime.
 */

// Tool profile for tool permission management
export type ToolProfile = 'full' | 'readonly' | 'subagent' | 'dream' | 'verifier';
