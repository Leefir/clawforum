/**
 * ContextInjector - Injects fixed prefixes into conversation context
 * 
 * Injects (in order):
 * 1. AGENTS.md (system prompt base)
 * 2. MEMORY.md (persistent memory)
 * 3. Active contract summaries (if any)
 * 4. Skill metadata (if any)
 * 5. Tool definitions (via ToolRegistry - Phase 1)
 */

import type { IFileSystem } from '../../foundation/fs/types.js';
import type { Message } from '../../types/message.js';
import type { Contract } from '../../types/contract.js';
import type { SessionData, InjectorOptions } from './types.js';
import type { SkillRegistry } from '../skill/registry.js';
import type { ContractManager } from '../contract/manager.js';

/**
 * Context injector configuration
 */
export interface ContextInjectorOptions {
  /** File system instance */
  fs: IFileSystem;
  /** Skill registry for skill metadata injection */
  skillRegistry?: SkillRegistry;
  /** Contract manager for active contract injection */
  contractManager?: ContractManager;
}

/**
 * Format contract for prompt injection
 * Returns markdown with title, goal, and subtask progress
 */
function formatContractForPrompt(contract: Contract): string {
  const lines = [
    '## Active Contract',
    `**Title:** ${contract.title}`,
    `**Goal:** ${contract.goal}`,
    '',
    '**Subtasks:**',
  ];

  for (const subtask of contract.subtasks) {
    const checkbox = subtask.status === 'completed' ? '[x]' : '[ ]';
    lines.push(`${checkbox} ${subtask.description}`);
  }

  return lines.join('\n');
}

/**
 * Injects context into sessions
 */
export class ContextInjector {
  private fs: IFileSystem;
  private skillRegistry?: SkillRegistry;
  private contractManager?: ContractManager;

  constructor(options: ContextInjectorOptions) {
    this.fs = options.fs;
    this.skillRegistry = options.skillRegistry;
    this.contractManager = options.contractManager;
  }

  /**
   * Build system prompt from AGENTS.md, MEMORY.md, skills, and active contract
   * Gracefully degrades if files don't exist
   */
  async buildSystemPrompt(): Promise<string> {
    const parts: string[] = [];

    // Try to read AGENTS.md
    try {
      const agents = await this.fs.read('AGENTS.md');
      if (agents.trim()) {
        parts.push(agents.trim());
      }
    } catch {
      // AGENTS.md doesn't exist, skip silently
    }

    // Try to read MEMORY.md
    try {
      const memory = await this.fs.read('MEMORY.md');
      if (memory.trim()) {
        parts.push('## Memory');
        parts.push(memory.trim());
      }
    } catch {
      // MEMORY.md doesn't exist, skip
    }

    // Inject skill metadata if available
    if (this.skillRegistry) {
      const skillContext = this.skillRegistry.formatForContext();
      if (skillContext) {
        parts.push(skillContext);
      }
    }

    // Inject active contract if available
    if (this.contractManager) {
      try {
        const contract = await this.contractManager.loadActive();
        if (contract) {
          parts.push(formatContractForPrompt(contract));
        }
      } catch {
        // No active contract or error loading, skip
      }
    }

    return parts.join('\n\n');
  }

  /**
   * Inject fixed prefix into session messages
   * 
   * Adds system message at the beginning containing:
   * - AGENTS.md content
   * - MEMORY.md content
   * - Optional: contract summaries, skill metadata, tool definitions
   */
  async injectFixedPrefix(
    session: SessionData,
    opts: InjectorOptions = {}
  ): Promise<void> {
    const parts: string[] = [];

    // 1. AGENTS.md
    try {
      const agents = await this.fs.read('AGENTS.md');
      if (agents.trim()) {
        parts.push(agents.trim());
      }
    } catch {
      // Skip if not found
    }

    // 2. MEMORY.md
    try {
      const memory = await this.fs.read('MEMORY.md');
      if (memory.trim()) {
        parts.push('## Memory');
        parts.push(memory.trim());
      }
    } catch {
      // Skip if not found
    }

    // 3. Active contracts (Phase 1 extension)
    if (opts.includeContracts && this.contractManager) {
      try {
        const contract = await this.contractManager.loadActive();
        if (contract) {
          parts.push(formatContractForPrompt(contract));
        }
      } catch {
        // No active contract or error loading, skip
      }
    }

    // 4. Skill metadata (Phase 1 extension)
    if (opts.includeSkills && this.skillRegistry) {
      const skillContext = this.skillRegistry.formatForContext();
      if (skillContext) {
        parts.push(skillContext);
      }
    }

    // 5. Tool definitions (Phase 1 extension)
    if (opts.includeTools) {
      // TODO: Inject available tool definitions
      // This will be implemented when ToolRegistry is ready
    }

    // If we have content to inject, add as system message
    if (parts.length > 0) {
      const systemContent = parts.join('\n\n');
      const systemMessage: Message = {
        role: 'system',
        content: systemContent,
      };

      // Insert at beginning
      session.messages.unshift(systemMessage);
    }
  }

  /**
   * Inject tool definitions into system prompt
   * Called by injectFixedPrefix when includeTools is true
   */
  async injectTools(
    _session: SessionData,
    // tools: ToolDefinition[] // Will be added when ToolRegistry is ready
  ): Promise<void> {
    // TODO: Format tools for LLM API
    // This will be implemented when ToolRegistry is ready
    void _session; // Mark as intentionally used
  }
}
