/**
 * Tool profiles - define which tools are available in each profile
 */

import type { ToolProfile } from '../../types/config.js';

/**
 * Tool name lists for each profile
 */
export const TOOL_PROFILES: Record<ToolProfile, string[]> = {
  full:     ['read', 'write', 'search', 'ls', 'send', 'done', 'spawn', 'skill', 'exec', 'status'],
  readonly: ['read', 'search', 'ls', 'status'],
  subagent: ['read', 'write', 'search', 'ls', 'exec', 'skill'],
  dream:    ['read', 'search', 'ls'],
};

/**
 * Check if a tool is allowed in a profile
 */
export function isToolAllowed(toolName: string, profile: ToolProfile): boolean {
  return TOOL_PROFILES[profile].includes(toolName);
}
