/**
 * ContractCreator tests
 */

import { describe, it, expect, vi } from 'vitest';
import { ContractCreator } from '../../src/core/contract/creator.js';
import type { ILLMService } from '../../src/foundation/llm/index.js';
import type { LLMResponse } from '../../src/types/message.js';

/**
 * Create mock LLM that returns specified response text
 */
function createMockLLM(responseText: string): ILLMService {
  return {
    call: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: responseText }],
      stopReason: 'end_turn',
    } as LLMResponse),
    stream: vi.fn(),
  } as ILLMService;
}

/**
 * Create complete valid contract JSON
 */
function createValidContractJson() {
  return {
    title: 'Test Contract',
    goal: 'Implement a file search tool',
    deliverables: ['search.js', 'README.md'],
    subtasks: [
      { id: 'design-api', description: 'Design the search API' },
      { id: 'implement-search', description: 'Implement search functionality' },
    ],
    acceptance: [
      { subtask_id: 'design-api', type: 'script', script_file: 'acceptance/design-api.sh' },
      { subtask_id: 'implement-search', type: 'llm', prompt_file: 'acceptance/implement-search.prompt.txt' },
    ],
    escalation: { max_retries: 3 },
    scripts: {
      'design-api': '#!/bin/bash\necho "Checking API design..."',
    },
    prompts: {
      'implement-search': 'Check if {{evidence}} contains working search and {{artifacts}} exist.',
    },
  };
}

describe('ContractCreator', () => {
  describe('generate', () => {
    it('should generate contract from valid JSON response', async () => {
      const contractJson = createValidContractJson();
      const mockLLM = createMockLLM(JSON.stringify(contractJson));
      const creator = new ContractCreator(mockLLM);

      const result = await creator.generate('Build a file search tool');

      // Verify yaml structure
      expect(result.yaml.title).toBe('Test Contract');
      expect(result.yaml.goal).toBe('Implement a file search tool');
      expect(result.yaml.subtasks).toHaveLength(2);
      expect(result.yaml.subtasks[0].id).toBe('design-api');
      expect(result.yaml.subtasks[1].description).toBe('Implement search functionality');

      // Verify acceptance criteria
      expect(result.yaml.acceptance).toHaveLength(2);
      expect(result.yaml.acceptance[0].type).toBe('script');
      expect(result.yaml.acceptance[0].script_file).toBe('acceptance/design-api.sh');
      expect(result.yaml.acceptance[1].type).toBe('llm');
      expect(result.yaml.acceptance[1].prompt_file).toBe('acceptance/implement-search.prompt.txt');

      // Verify scripts and prompts extracted
      expect(result.scripts).toHaveProperty('design-api');
      expect(result.scripts['design-api']).toContain('#!/bin/bash');
      expect(result.prompts).toHaveProperty('implement-search');
      expect(result.prompts['implement-search']).toContain('{{evidence}}');
    });

    it('should parse JSON wrapped in markdown code block', async () => {
      const contractJson = createValidContractJson();
      const markdownResponse = `\`\`\`json\n${JSON.stringify(contractJson)}\n\`\`\``;
      const mockLLM = createMockLLM(markdownResponse);
      const creator = new ContractCreator(mockLLM);

      const result = await creator.generate('Build a file search tool');

      expect(result.yaml.title).toBe('Test Contract');
      expect(result.yaml.subtasks).toHaveLength(2);
      expect(result.scripts).toHaveProperty('design-api');
      expect(result.prompts).toHaveProperty('implement-search');
    });

    it('should throw error when JSON parsing fails', async () => {
      const mockLLM = createMockLLM('This is not valid JSON {{broken');
      const creator = new ContractCreator(mockLLM);

      await expect(creator.generate('Some goal')).rejects.toThrow(/JSON|parse/i);
    });

    it('should throw error when missing required field: title', async () => {
      const incompleteJson = { goal: 'Some goal', subtasks: [{ id: 'x', description: 'y' }] };
      const mockLLM = createMockLLM(JSON.stringify(incompleteJson));
      const creator = new ContractCreator(mockLLM);

      await expect(creator.generate('Some goal')).rejects.toThrow(/missing.*title|title.*required/i);
    });

    it('should throw error when missing required field: goal', async () => {
      const incompleteJson = { title: 'Some title', subtasks: [{ id: 'x', description: 'y' }] };
      const mockLLM = createMockLLM(JSON.stringify(incompleteJson));
      const creator = new ContractCreator(mockLLM);

      await expect(creator.generate('Some goal')).rejects.toThrow(/missing.*goal|goal.*required/i);
    });

    it('should throw error when missing required field: subtasks', async () => {
      const incompleteJson = { title: 'Some title', goal: 'Some goal' };
      const mockLLM = createMockLLM(JSON.stringify(incompleteJson));
      const creator = new ContractCreator(mockLLM);

      await expect(creator.generate('Some goal')).rejects.toThrow(/missing.*subtasks|subtasks.*required|empty.*subtasks/i);
    });

    it('should throw error when subtasks is empty array', async () => {
      const incompleteJson = { title: 'Some title', goal: 'Some goal', subtasks: [] };
      const mockLLM = createMockLLM(JSON.stringify(incompleteJson));
      const creator = new ContractCreator(mockLLM);

      await expect(creator.generate('Some goal')).rejects.toThrow(/missing.*subtasks|subtasks.*required|empty.*subtasks/i);
    });

    it('should handle response without scripts/prompts', async () => {
      const minimalJson = {
        title: 'Minimal Contract',
        goal: 'Do something simple',
        subtasks: [{ id: 'simple-task', description: 'A simple task' }],
      };
      const mockLLM = createMockLLM(JSON.stringify(minimalJson));
      const creator = new ContractCreator(mockLLM);

      const result = await creator.generate('Simple goal');

      expect(result.yaml.title).toBe('Minimal Contract');
      expect(result.scripts).toEqual({});
      expect(result.prompts).toEqual({});
    });

    it('should parse JSON from generic markdown block', async () => {
      const contractJson = createValidContractJson();
      const markdownResponse = `Some text before\n\`\`\`\n${JSON.stringify(contractJson)}\n\`\`\`\nSome text after`;
      const mockLLM = createMockLLM(markdownResponse);
      const creator = new ContractCreator(mockLLM);

      const result = await creator.generate('Build a file search tool');

      expect(result.yaml.title).toBe('Test Contract');
      expect(result.yaml.subtasks).toHaveLength(2);
    });

    it('should propagate error when llm.call throws', async () => {
      const mockLLM = {
        call: vi.fn().mockRejectedValue(new Error('Network error')),
        stream: vi.fn(),
      } as unknown as ILLMService;
      const creator = new ContractCreator(mockLLM);

      await expect(creator.generate('Some goal')).rejects.toThrow('Network error');
    });

    it('should throw error when LLM response has no text content', async () => {
      const mockLLM = {
        call: vi.fn().mockResolvedValue({
          content: [],  // 空内容
          stopReason: 'end_turn',
        }),
        stream: vi.fn(),
      } as unknown as ILLMService;
      const creator = new ContractCreator(mockLLM);

      await expect(creator.generate('Some goal')).rejects.toThrow();
    });

    it('should throw when subtask is missing id field', async () => {
      const mockLLM = createMockLLM(JSON.stringify({
        title: 'Test',
        goal: 'Test goal',
        subtasks: [{ description: 'No ID here' }],  // 缺 id
      }));
      const creator = new ContractCreator(mockLLM);
      await expect(creator.generate('test')).rejects.toThrow('subtask missing required field: id');
    });

    it('should throw when subtask is missing description field', async () => {
      const mockLLM = createMockLLM(JSON.stringify({
        title: 'Test',
        goal: 'Test goal',
        subtasks: [{ id: 'task-1' }],  // 缺 description
      }));
      const creator = new ContractCreator(mockLLM);
      await expect(creator.generate('test')).rejects.toThrow('subtask missing required field: description');
    });
  });
});
