/**
 * ContractCreator - LLM-based contract generation
 *
 * Generates complete contract structure from a goal description using a single LLM call.
 */

import type { ILLMService } from '../../foundation/llm/index.js';
import type { ContractYaml } from './manager.js';
import type { IFileSystem } from '../../foundation/fs/types.js';

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
    // Build system prompt with JSON schema
    const systemPrompt = `You are a contract designer for an AI task delegation system.

Your task is to break down a high-level goal into actionable subtasks with acceptance criteria.

Output format (JSON):
{
  "title": "Contract title (max 50 chars)",
  "goal": "Restated clear goal",
  "deliverables": ["list of expected outputs"],
  "subtasks": [
    { "id": "kebab-case-id", "description": "Clear, actionable description" }
  ],
  "acceptance": [
    { "subtask_id": "kebab-case-id", "type": "script", "script_file": "acceptance/<id>.sh" },
    { "subtask_id": "kebab-case-id", "type": "llm", "prompt_file": "acceptance/<id>.prompt.txt" }
  ],
  "escalation": { "max_retries": 3 },
  "scripts": {
    "<id>": "#!/bin/bash\\n# Acceptance script content\\n# exit 0 = pass, exit 1 = fail"
  },
  "prompts": {
    "<id>": "LLM acceptance prompt with {{evidence}} and {{artifacts}} placeholders"
  }
}

Rules:
1. Subtask IDs must be kebab-case (e.g., "analyze-data", "write-report")
2. Each subtask should be independently verifiable
3. Script acceptance: write bash scripts that check file existence/content
4. LLM acceptance: write prompts that evaluate quality of evidence
5. All placeholders {{evidence}} and {{artifacts}} must be present in prompts
6. Keep subtasks small (typically 3-7 subtasks per contract)

Path convention for scripts:
- Scripts run from clawDir (not contract directory)
- Check deliverables with: if [ -f "clawspace/<filename>" ]
- Use "clawspace/" prefix, not bare filenames
- Do not use absolute paths

Respond with valid JSON only, wrapped in markdown code block if needed.`;

    // Build user message with optional context
    let userMessage = `Goal: ${goal}`;

    if (clawContextDir && this.fs) {
      try {
        const entries = await this.fs.list('.', { recursive: false });
        const files = entries
          .filter(e => e.isFile)
          .map(e => e.name)
          .slice(0, 20); // Limit to 20 files
        if (files.length > 0) {
          userMessage += `\n\nCurrent directory contains: ${files.join(', ')}`;
        }
      } catch {
        // Best-effort: ignore context gathering errors
      }
    }

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

    // Extract scripts and prompts
    const scripts = (result.scripts as Record<string, string>) || {};
    const prompts = (result.prompts as Record<string, string>) || {};

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
