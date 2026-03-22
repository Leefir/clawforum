/**
 * Tool profiles - define which tools are available in each profile
 */

import type { ToolProfile } from '../../types/config.js';

/**
 * Tool name lists for each profile
 */
export const TOOL_PROFILES: Record<ToolProfile, string[]> = {
  full:     ['read', 'write', 'search', 'ls', 'send', 'done', 'spawn', 'dispatch', 'skill', 'exec', 'status', 'memory_search'],
  readonly: ['read', 'search', 'ls', 'status', 'memory_search'],
  subagent: ['read', 'write', 'search', 'ls', 'exec', 'skill', 'status', 'memory_search'],
  dream:    ['read', 'search', 'ls', 'memory_search'],
};

/**
 * Check if a tool is allowed in a profile
 */
export function isToolAllowed(toolName: string, profile: ToolProfile): boolean {
  return TOOL_PROFILES[profile].includes(toolName);
}
