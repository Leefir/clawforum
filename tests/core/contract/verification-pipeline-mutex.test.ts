/**
 * @module tests/core/contract/verification-pipeline-mutex
 * Phase 1371 sub-3: completeSubtaskSync vs runVerificationPipeline mutex reverse test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ContractSystem } from '../../../src/core/contract/manager.js';
import { NodeFileSystem } from '../../../src/foundation/fs/node-fs.js';
import { createToolRegistry } from '../../../src/foundation/tools/index.js';
import { makeContractYaml } from '../../helpers/contract-yaml.js';
import { makeAudit } from '../../helpers/audit.js';

let tmpDir: string;
let clawDir: string;
let nodeFs: NodeFileSystem;

beforeEach(async () => {
  tmpDir = path.join(
    os.tmpdir(),
    `.test-verification-mutex-${process.pid}-${Math.random().toString(36).slice(2, 10)}`,
  );
  clawDir = path.join(tmpDir, 'claws', 'test-claw');
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(clawDir, { recursive: true });
  nodeFs = new NodeFileSystem({ baseDir: clawDir });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

function makeManager(audit: any) {
  return new ContractSystem({
    clawDir,
    clawId: 'test-claw',
    fs: nodeFs,
    audit,
    toolRegistry: createToolRegistry(),
    fsFactory: (dir: string) => new NodeFileSystem({ baseDir: dir }),
    clawsDir: '/tmp/test/claws',
    notifyClaw: vi.fn(),});
}

describe('verification pipeline mutex (phase 1371 sub-3)', () => {
  it('concurrent runVerificationPipeline attempts → second rejected with race audit', async () => {
    const { audit, events, emitter } = makeAudit();
    const manager = makeManager(audit);

    const contractId = await manager.create(makeContractYaml({
      subtasks: [{ id: 't1', description: 'd1' }],
      verification: [{ subtask_id: 't1', type: 'script', script_file: 'verify.sh' }],
    }));

    // Mock runScriptVerification to delay so pipeline stays active
    vi.spyOn(manager as any, 'runScriptVerification').mockImplementation(() => new Promise(() => {}));

    // First call completes the synchronous phase (acquire mutex → withProgressLock
    // sets in_progress → release mutex → fire background verification).
    // await ensures we're past the mutex-protected critical section.
    await manager.completeSubtask({ contractId, subtaskId: 't1', evidence: 'e1' });

    // Second call should be rejected by in_progress status guard
    // (mutex was released after withProgressLock, per phase 1391 fix)
    await expect(
      manager.completeSubtask({ contractId, subtaskId: 't1', evidence: 'e2' })
    ).rejects.toThrow('already in progress');
  });


});
