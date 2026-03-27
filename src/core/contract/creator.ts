/**
 * ContractCreator - LLM-based contract generation
 *
 * Generates complete contract structure from a goal description using a single LLM call.
 */

import type { ILLMService } from '../../foundation/llm/index.js';
import type { ContractYaml } from './manager.js';
import type { IFileSystem } from '../../foundation/fs/types.js';
import { CONTRACT_CREATOR_SYSTEM_PROMPT, buildContractCreatorUserMessage } from '../../prompts/index.js';

export class ContractCreator {
  constructor(
    private llm: ILLMService,
    private fs?: IFileSystem,
  ) {}

  async generate(
    goal: string,
    clawContextDir?: string,
  ): Promise<{
    yaml: ContractYaml;
    scripts: Record<string, string>;
    prompts: Record<string, string>;
  }> {
    // Use system prompt from prompts module
    const systemPrompt = CONTRACT_CREATOR_SYSTEM_PROMPT;

    // Build user message with optional context
    let dirContext: string | undefined;
    if (clawContextDir && this.fs) {
      try {
        const entries = await this.fs.list('.', { recursive: false });
        const files = entries
          .filter(e => e.isFile)
          .map(e => e.name)
          .slice(0, 20); // Limit to 20 files
        if (files.length > 0) {
          dirContext = files.join(', ');
        }
      } catch {
        // Best-effort: ignore context gathering errors
      }
    }
    const userMessage = buildContractCreatorUserMessage(goal, dirContext);

    // Call LLM
    const response = await this.llm.call({
      messages: [{ role: 'user', content: userMessage }],
      system: systemPrompt,
      maxTokens: 4096,
    });

    // Extract text content from response
    const textContent = response.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map(b => b.text)
      .join('');

    // Extract and parse JSON
    let parsed: unknown;
    try {
      parsed = extractJson(textContent);
    } catch (err) {
      throw new Error(
        `Failed to parse LLM response as JSON: ${err instanceof Error ? err.message : String(err)}\n\nResponse:\n${textContent.slice(0, 500)}`,
      );
    }

    // Validate required fields
    const result = parsed as Record<string, unknown>;
    if (!result.title || typeof result.title !== 'string') {
      throw new Error('LLM response missing required field: title');
    }
    if (!result.goal || typeof result.goal !== 'string') {
      throw new Error('LLM response missing required field: goal');
    }
    if (!Array.isArray(result.subtasks) || result.subtasks.length === 0) {
      throw new Error('LLM response missing or empty required field: subtasks');
    }
    // 验证每个 subtask 有 id 和 description
    for (const st of result.subtasks as Array<Record<string, unknown>>) {
      if (!st.id || typeof st.id !== 'string') {
        throw new Error('LLM response subtask missing required field: id');
      }
      if (!st.description || typeof st.description !== 'string') {
        throw new Error('LLM response subtask missing required field: description');
      }
    }

    // 提前提取 scripts/prompts，供下方校验使用
    const scripts = (result.scripts as Record<string, string>) || {};
    const prompts = (result.prompts as Record<string, string>) || {};

    // 验证每个 acceptance 有 type 字段及配套字段
    if (Array.isArray(result.acceptance)) {
      for (const ac of result.acceptance as Array<Record<string, unknown>>) {
        if (!ac.type || typeof ac.type !== 'string') {
          throw new Error('LLM response acceptance entry missing required field: type');
        }
        if (!ac.subtask_id || typeof ac.subtask_id !== 'string') {
          throw new Error('LLM response acceptance entry missing required field: subtask_id');
        }
        if (ac.type === 'script' && !ac.script_file) {
          throw new Error('LLM response acceptance entry type=script missing script_file');
        }
        if (ac.type === 'llm' && !ac.prompt_file) {
          throw new Error('LLM response acceptance entry type=llm missing prompt_file');
        }
        // 验证 prompts 字典有对应内容
        if (ac.type === 'llm' && ac.prompt_file) {
          const id = ac.subtask_id as string;
          if (!prompts[id] || typeof prompts[id] !== 'string') {
            throw new Error(
              `LLM response acceptance entry "${id}": type=llm but missing or empty entry in prompts dict`
            );
          }
        }
        // 验证 scripts 字典有对应内容
        if (ac.type === 'script' && ac.script_file) {
          const id = ac.subtask_id as string;
          if (!scripts[id] || typeof scripts[id] !== 'string') {
            throw new Error(
              `LLM response acceptance entry "${id}": type=script but missing or empty entry in scripts dict`
            );
          }
        }
      }
    }

    // Construct ContractYaml
    const yaml: ContractYaml = {
      schema_version: 1,
      title: result.title,
      goal: result.goal,
      deliverables: Array.isArray(result.deliverables) ? result.deliverables : [],
      subtasks: result.subtasks as Array<{ id: string; description: string }>,
      acceptance: Array.isArray(result.acceptance) ? result.acceptance : [],
      auth_level: 'auto',
      escalation: result.escalation as { max_retries?: number } | undefined,
    };

    return { yaml, scripts, prompts };
  }
}

/**
 * Extract JSON from LLM response text
 * Supports markdown code blocks or raw JSON
 */
function extractJson(text: string): unknown {
  // Try markdown code block first
  const match = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (match) {
    return JSON.parse(match[1]);
  }
  // Try generic code block
  const genericMatch = text.match(/```\s*([\s\S]*?)\s*```/);
  if (genericMatch) {
    return JSON.parse(genericMatch[1]);
  }
  // Fallback: parse the whole text
  return JSON.parse(text.trim());
}
