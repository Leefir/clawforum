/**
 * ToolRegistry - Manages tool registration and lookup
 * 
 * Implements IToolRegistry interface
 */

import type { ITool } from './executor.js';
import type { ToolProfile } from '../../types/config.js';
import { TOOL_PROFILES } from './profiles.js';

/**
 * Tool registry implementation
 */
export class ToolRegistry {
  private tools: Map<string, ITool> = new Map();

  /**
   * Register a tool
   * Overwrites existing tool with same name
   */
  register(tool: ITool): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Unregister a tool by name
   */
  unregister(name: string): void {
    this.tools.delete(name);
  }

  /**
   * Get a tool by name
   * @returns Tool or undefined if not found
   */
  get(name: string): ITool | undefined {
    return this.tools.get(name);
  }

  /**
   * Check if a tool exists
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get all registered tools
   */
  getAll(): ITool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tools available for a specific profile
   */
  getForProfile(profile: ToolProfile): ITool[] {
    const allowedNames = TOOL_PROFILES[profile];
    return this.getAll().filter(tool => allowedNames.includes(tool.name));
  }

  /**
   * Format tools for LLM API consumption
   * @returns Tool definitions in LLM API format
   */
  formatForLLM(tools: ITool[]): Array<{
    name: string;
    description: string;
    input_schema: unknown;
  }> {
    return tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.schema,
    }));
  }
}
