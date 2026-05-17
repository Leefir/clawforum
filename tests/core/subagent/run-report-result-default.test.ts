/**
 * run.ts default resultTool by-name string (phase 995 r121 N)
 * Reverse test: verify run.ts uses 'report_result' string literal (0 L3→L4 import)
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/core/subagent/agent.js', () => ({
  SubAgent: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue('test result'),
  })),
}));

vi.mock('../../../src/foundation/audit/index.js', () => ({
  createAuditWriter: vi.fn().mockReturnValue({ write: vi.fn() }),
}));

vi.mock('../../../src/foundation/dialog-store/index.js', () => ({
  createDialogStore: vi.fn().mockReturnValue({ save: vi.fn().mockResolvedValue(undefined) }),
}));

import { runSubagent } from '../../../src/core/subagent/run.js';

describe('run.ts default resultTool by-name string (phase 995 r121 N)', () => {
  it('opts.resultTool undefined → registry.get called with "report_result" (by-name string, no L3→L4 import)', async () => {
    const mockRegistry = {
      getAll: vi.fn().mockReturnValue([]),
      formatForLLM: vi.fn().mockReturnValue([]),
      get: vi.fn().mockReturnValue({ capturedResult: 'mock-result' }),
    };

    const mockFs = {
      ensureDir: vi.fn().mockResolvedValue(undefined),
      appendSync: vi.fn(),
    };

    const result = await runSubagent({
      agentId: 'test-agent',
      callerClawId: 'claw-test',
      clawDir: '/tmp/test',
      fs: mockFs as any,
      llm: {} as any,
      registry: mockRegistry as any,
      prompt: 'test',
      systemPrompt: 'system',
      resultDir: '/tmp/test/result',
      maxSteps: 5,
    });

    // Verify default fallback uses 'report_result' string literal
    expect(mockRegistry.get).toHaveBeenCalledWith('report_result');
    expect(result.capturedResult).toBe('mock-result');
  });

  it('opts.resultTool provided → registry.get called with provided value', async () => {
    const mockRegistry = {
      getAll: vi.fn().mockReturnValue([]),
      formatForLLM: vi.fn().mockReturnValue([]),
      get: vi.fn().mockReturnValue({ capturedResult: 'custom-result' }),
    };

    const mockFs = {
      ensureDir: vi.fn().mockResolvedValue(undefined),
      appendSync: vi.fn(),
    };

    const result = await runSubagent({
      agentId: 'test-agent',
      callerClawId: 'claw-test',
      clawDir: '/tmp/test',
      fs: mockFs as any,
      llm: {} as any,
      registry: mockRegistry as any,
      prompt: 'test',
      systemPrompt: 'system',
      resultDir: '/tmp/test/result',
      maxSteps: 5,
      resultTool: 'custom_tool',
    });

    expect(mockRegistry.get).toHaveBeenCalledWith('custom_tool');
    expect(result.capturedResult).toBe('custom-result');
  });

  it('反向 grep verify: run.ts NOT import from ../contract/', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const runSrc = fs.readFileSync(
      path.resolve(__dirname, '../../../src/core/subagent/run.ts'),
      'utf8'
    );
    expect(runSrc).not.toMatch(/from\s+['"]\.\.\/contract\//);
    expect(runSrc).not.toContain('REPORT_RESULT_TOOL_NAME');
  });
});
