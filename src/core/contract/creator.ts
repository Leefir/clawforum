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
Your job is to decompose a high-level goal into clear subtasks and write acceptance criteria that verifies each one.

## Output format (JSON)

\`\`\`json
{
  "title": "Short contract title (max 50 chars)",
  "goal": "Restated goal in one sentence",
  "deliverables": ["clawspace/output-file.md", "..."],
  "subtasks": [
    {
      "id": "kebab-case-id",
      "description": "Action verb + what to do + exact output path. Example: Collect 5 meeting minutes templates and save to clawspace/templates.md"
    }
  ],
  "acceptance": [
    { "subtask_id": "kebab-case-id", "type": "script", "script_file": "acceptance/<id>.sh" },
    { "subtask_id": "kebab-case-id", "type": "llm", "prompt_file": "acceptance/<id>.prompt.txt" }
  ],
  "escalation": { "max_retries": 3 },
  "scripts": {
    "<id>": "#!/bin/bash\\n# exit 0 = pass, exit 1 = fail\\n..."
  },
  "prompts": {
    "<id>": "Evaluation prompt with {{evidence}} and {{artifacts}} placeholders"
  }
}
\`\`\`

## Rules

### Subtasks
1. IDs must be kebab-case (e.g., "collect-data", "write-report")
2. Each subtask must be independently executable and verifiable
3. **Description must state the exact output path**: include "save to clawspace/<filename>" so the executing agent knows precisely where to write output. The acceptance script must check the same path.
4. Keep to 3-7 subtasks per contract

### Acceptance criteria
5. Field binding (STRICT — wrong field = silent failure):
   - type "script" → field "script_file": "acceptance/<id>.sh"  (never "prompt_file")
   - type "llm"    → field "prompt_file": "acceptance/<id>.prompt.txt"  (never "script_file")
6. Use "script" for file existence / content checks; use "llm" for quality / correctness evaluation
7. LLM prompts must contain both {{evidence}} and {{artifacts}} placeholders

### Script conventions
8. Scripts run from clawDir (claw root directory, NOT the contract subdirectory)
9. Check output files with the clawspace/ prefix: \`if [ -f "clawspace/<filename>" ]\`
10. Check the **exact filename** stated in the subtask description — do not guess or use wildcards unless the subtask explicitly allows multiple filenames
11. Never hardcode absolute paths

Respond with valid JSON only (optionally wrapped in a \`\`\`json block).`;

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

    // 提前提取 scripts/prompts，供下方校验使用
    const scripts = (result.scripts as Record<string, string>) || {};
    const prompts = (result.prompts as Record<string, string>) || {};

    // 验证每个 acceptance 有 type 字段及配套字段
    if (Array.isArray(result.acceptance)) {
      for (const ac of result.acceptance as Array<Record<string, unknown>>) {
        if (!ac.type || typeof ac.type !== 'string') {
          throw new Error('LLM response acceptance entry missing required field: type');
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
