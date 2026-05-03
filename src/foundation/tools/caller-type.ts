/**
 * Caller type definitions
 * 
 * Centralized type definitions for all caller types to ensure consistency
 * across the codebase. New dispatch modes only need to be added here.
 */

import type { ToolProfile } from '../../types/config.js';

export type DispatchCallerType = 'dispatcher' | 'describer' | 'miner';
export type CallerType = 'claw' | 'subagent' | DispatchCallerType;

/**
 * Check if a caller type is a dispatch-related caller
 * (dispatcher, describer, or miner)
 */
export function isDispatchCaller(t?: string): t is DispatchCallerType {
  return t === 'dispatcher' || t === 'describer' || t === 'miner';
}

/**
 * Map callerType to the corresponding ToolProfile for registry filtering.
 * Note: Main Claw doesn't use this path (runtime.ts uses 'full' profile directly),
 * so this only covers subagent scenarios.
 */
export function callerTypeToProfile(callerType: string): ToolProfile {
  return callerType === 'miner' ? 'miner' : 'subagent';
}
