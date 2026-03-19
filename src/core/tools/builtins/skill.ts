/**
 * skill tool - Load and use skills from SKILL.md files
 * 
 * Skills provide domain-specific knowledge and guidelines to Claws.
 * Loaded on-demand when this tool is called.
 */

import type { ITool, ToolResult, ExecContext } from '../executor.js';
import type { SkillRegistry } from '../../skill/registry.js';

/**
 * Skill tool implementation
 * 
 * Requires skillRegistry to be injected before use.
 */
export const skillTool: ITool & { skillRegistry?: SkillRegistry } = {
  name: 'skill',
  description: 'Load a skill by name. Skills provide domain-specific knowledge and guidelines from SKILL.md files.',
  schema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'The name of the skill to load (e.g., "git-workflow", "code-review")',
      },
    },
    required: ['name'],
  },
  requiredPermissions: ['read'],
  readonly: true,
  idempotent: true,

  async execute(args: Record<string, unknown>, ctx: ExecContext): Promise<ToolResult> {
    const skillRegistry = (ctx as { skillRegistry?: SkillRegistry }).skillRegistry;
    
    if (!skillRegistry) {
      return {
        success: false,
        content: 'SkillRegistry not available. Skill tool requires SkillRegistry to be injected.',
        error: 'SkillRegistry not configured',
      };
    }

    const name = String(args.name);

    try {
      const content = await skillRegistry.loadFull(name);
      return {
        success: true,
        content,
        metadata: { skillName: name },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        content: `Failed to load skill "${name}": ${errorMsg}`,
        error: errorMsg,
      };
    }
  },
};
