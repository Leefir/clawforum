/**
 * Caller type definitions
 * 
 * Centralized type definitions for all caller types to ensure consistency
 * across the codebase. New dispatch modes only need to be added here.
 */

export type DispatchCallerType = 'dispatcher' | 'describer' | 'miner';
export type CallerType = 'claw' | 'subagent' | DispatchCallerType;

/**
 * Check if a caller type is a dispatch-related caller
 * (dispatcher, describer, or miner)
 */
export function isDispatchCaller(t?: string): t is DispatchCallerType {
  return t === 'dispatcher' || t === 'describer' || t === 'miner';
}
