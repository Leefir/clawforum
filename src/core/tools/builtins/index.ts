/**
 * Builtin tools - Built-in tool implementations
 */

import type { IToolRegistry } from '../executor.js';
import { readTool } from './read.js';
import { writeTool } from './write.js';
import { lsTool } from './ls.js';
import { searchTool } from './search.js';
import { statusTool } from './status.js';
import { execTool } from './exec.js';
import { sendTool } from './send.js';

// Re-export all tools
export { readTool, writeTool, lsTool, searchTool, statusTool, execTool, sendTool };

/**
 * Register all builtin tools to a registry
 */
export function registerBuiltinTools(registry: IToolRegistry): void {
  registry.register(readTool);
  registry.register(writeTool);
  registry.register(lsTool);
  registry.register(searchTool);
  registry.register(statusTool);
  registry.register(execTool);
  registry.register(sendTool);
}
