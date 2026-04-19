/**
 * Test helper: construct a full RuntimeDependencies object for ClawRuntime/MotionRuntime tests.
 *
 * Default: all L1-L2 dependencies are "real but temp-dir based" so that
 * runtime.initialize() can run without mock gaps.
 *
 * Usage:
 *   new ClawRuntime({ ..., dependencies: makeRuntimeDeps() })
 *   new ClawRuntime({ ..., dependencies: makeRuntimeDeps({ llm: mockLLM }) })
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import type { RuntimeDependencies } from '../../../src/core/runtime.js';
import { NodeFileSystem } from '../../../src/foundation/fs/node-fs.js';
import { AuditWriter } from '../../../src/foundation/audit/writer.js';
import { Snapshot } from '../../../src/foundation/snapshot/index.js';
import { SNAPSHOT_IGNORE_PATTERNS } from '../../../src/foundation/snapshot/index.js';
import { SessionManager } from '../../../src/foundation/session-store/index.js';
import { InboxReader } from '../../../src/foundation/messaging/index.js';
import { OutboxWriter } from '../../../src/core/communication/index.js';

const testDirs: string[] = [];

function makeTestDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'runtime-test-'));
  testDirs.push(dir);
  return dir;
}

export function cleanupTestDirs(): void {
  for (const dir of testDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
}

export function makeRuntimeDeps(
  overrides: Partial<RuntimeDependencies> = {},
  opts: { baseDir?: string } = {},
): RuntimeDependencies {
  const baseDir = opts.baseDir ?? makeTestDir();
  const systemFs = new NodeFileSystem({ baseDir, enforcePermissions: false });
  const clawFs = new NodeFileSystem({ baseDir, enforcePermissions: true });
  const auditWriter = new AuditWriter(systemFs, 'audit.tsv', null);

  const snapshot = overrides.snapshot ?? new Snapshot(baseDir, systemFs, auditWriter, SNAPSHOT_IGNORE_PATTERNS);
  const sessionManager = overrides.sessionManager ?? new SessionManager(systemFs, 'dialog', auditWriter, 'test-claw');
  const inboxReader = overrides.inboxReader ?? new InboxReader('inbox/pending', 'inbox/done', 'inbox/failed', systemFs, auditWriter);
  const outboxWriter = overrides.outboxWriter ?? new OutboxWriter('test-claw', baseDir, systemFs, auditWriter);

  return {
    systemFs,
    clawFs,
    auditWriter,
    snapshot,
    sessionManager,
    inboxReader,
    outboxWriter,
    ...overrides,
  };
}
