import { vi } from 'vitest';
import type { LLMOrchestrator } from '../../src/foundation/llm-orchestrator/index.js';
import type { ContractSystem } from '../../src/core/contract/manager.js';
import type { OutboxWriter } from '../../src/foundation/messaging/index.js';
import type { AuditWriter } from '../../src/foundation/audit/writer.js';
import type { FileSystem } from '../../src/foundation/fs/types.js';
import { AsyncTaskSystem, type AsyncTaskSystemOptions } from '../../src/core/async-task-system/system.js';
import { ToolRegistryImpl } from '../../src/foundation/tools/registry.js';

export function makeTestRegistry(): ToolRegistryImpl {
  return new ToolRegistryImpl();
}

export function makeTaskSystemDeps(
  llm?: LLMOrchestrator,
): Pick<AsyncTaskSystemOptions, 'llm' | 'contractManager' | 'outboxWriter' | 'registry'> {
  return {
    llm: llm ?? ({} as unknown as LLMOrchestrator),
    contractManager: {
      loadPaused: vi.fn(),
      resume: vi.fn(),
      setOnNotify: vi.fn(),
    } as unknown as ContractSystem,
    outboxWriter: {
      write: vi.fn().mockResolvedValue(undefined),
    } as unknown as OutboxWriter,
    registry: makeTestRegistry(),
  };
}

export function createTestTaskSystem(
  clawDir: string,
  fs: FileSystem,
  auditWriter: AuditWriter,
  llm?: LLMOrchestrator,
  overrides?: Partial<Omit<AsyncTaskSystemOptions, 'llm' | 'contractManager' | 'outboxWriter' | 'registry'>>,
): AsyncTaskSystem {
  const deps = makeTaskSystemDeps(llm);
  return new AsyncTaskSystem(clawDir, fs, {
    auditWriter,
    ...deps,
    ...overrides,
  });
}
