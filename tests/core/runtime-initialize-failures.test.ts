/**
 * Runtime.initialize() failure audit tests — phase155B
 *
 * Covers:
 * - sessionManager.save(repaired) failure → precise audit + rethrow
 * - inboxReader.init() failure → precise audit + rethrow
 */

import { describe, it, expect, vi } from 'vitest';
import * as path from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { ClawRuntime } from '../../src/core/runtime.js';
import { NodeFileSystem } from '../../src/foundation/fs/node-fs.js';
import { AuditWriter } from '../../src/foundation/audit/writer.js';
import { SessionManager } from '../../src/foundation/session-store/index.js';
import { Snapshot } from '../../src/foundation/snapshot/index.js';
import { SNAPSHOT_IGNORE_PATTERNS } from '../../src/foundation/snapshot/index.js';
import { InboxReader } from '../../src/foundation/messaging/index.js';
import { OutboxWriter } from '../../src/core/communication/index.js';

describe('Runtime.initialize() failure audits', () => {
  async function makeDeps(clawDir: string, overrides: { sessionManager?: SessionManager; inboxReader?: InboxReader } = {}) {
    const systemFs = new NodeFileSystem({ baseDir: clawDir, enforcePermissions: false });
    const clawFs = new NodeFileSystem({ baseDir: clawDir, enforcePermissions: true });
    const auditWriter = new AuditWriter(systemFs, 'audit.tsv', null);

    const snapshot = new Snapshot(clawDir, systemFs, auditWriter, SNAPSHOT_IGNORE_PATTERNS);
    vi.spyOn(snapshot, 'init').mockResolvedValue({ ok: true } as any);
    vi.spyOn(snapshot, 'commit').mockResolvedValue({ ok: true } as any);

    const sessionManager = overrides.sessionManager ?? new SessionManager(systemFs, 'dialog', auditWriter, 'test-claw');
    const inboxReader = overrides.inboxReader ?? new InboxReader('inbox/pending', 'inbox/done', 'inbox/failed', systemFs, auditWriter);
    const outboxWriter = new OutboxWriter('test-claw', clawDir, systemFs, auditWriter);

    return {
      systemFs, clawFs, auditWriter, snapshot, sessionManager, inboxReader, outboxWriter,
    };
  }

  it('sessionManager.save failure audits module=session_manager phase=session_repair_save and rethrows', async () => {
    const clawDir = path.join(tmpdir(), `runtime-fail-test-${randomUUID()}`, 'claws', 'test');
    await fs.mkdir(clawDir, { recursive: true });

    const deps = await makeDeps(clawDir);
    const auditSpy = vi.spyOn(deps.auditWriter, 'write');

    // Mock sessionManager.load to return a session that needs repair
    vi.spyOn(deps.sessionManager, 'load').mockResolvedValue({
      session: {
        messages: [
          { role: 'assistant', content: 'ok', tool_use: { id: 't1', name: 'test', input: {} } },
        ],
      },
      source: 'current',
    } as any);

    // Mock SessionManager.repair to return toolCount > 0 so save() is triggered
    vi.spyOn(SessionManager, 'repair').mockReturnValue({ repaired: [], toolCount: 1 } as any);

    // Mock sessionManager.save to throw
    const saveError = new Error('ENOSPC: no space left on device');
    vi.spyOn(deps.sessionManager, 'save').mockRejectedValue(saveError);

    const runtime = new ClawRuntime({
      clawId: 'test-claw',
      clawDir,
      llmConfig: { primary: { name: 'mock', apiKey: 'k', model: 'm', maxTokens: 1, temperature: 0, timeoutMs: 1, apiFormat: 'anthropic' }, maxAttempts: 1, retryDelayMs: 0 },
      dependencies: deps as any,
    });

    await expect(runtime.initialize()).rejects.toThrow('ENOSPC: no space left on device');

    const assembleFailedCall = auditSpy.mock.calls.find(c => c[0] === 'assemble_failed');
    expect(assembleFailedCall).toBeDefined();
    expect(assembleFailedCall![1]).toContain('module=session_manager');
    expect(assembleFailedCall![2]).toContain('phase=session_repair_save');
    expect(assembleFailedCall![3]).toContain('ENOSPC');

    // Cleanup
    await fs.rm(path.dirname(path.dirname(clawDir)), { recursive: true, force: true }).catch(() => {});
  });

  it('inboxReader.init failure audits module=inbox_reader phase=init and rethrows', async () => {
    const clawDir = path.join(tmpdir(), `runtime-fail-test-${randomUUID()}`, 'claws', 'test');
    await fs.mkdir(clawDir, { recursive: true });

    const deps = await makeDeps(clawDir);
    const auditSpy = vi.spyOn(deps.auditWriter, 'write');

    // Mock inboxReader.init to throw
    const initError = new Error('ensureDir EACCES');
    vi.spyOn(deps.inboxReader, 'init').mockRejectedValue(initError);

    const runtime = new ClawRuntime({
      clawId: 'test-claw',
      clawDir,
      llmConfig: { primary: { name: 'mock', apiKey: 'k', model: 'm', maxTokens: 1, temperature: 0, timeoutMs: 1, apiFormat: 'anthropic' }, maxAttempts: 1, retryDelayMs: 0 },
      dependencies: deps as any,
    });

    await expect(runtime.initialize()).rejects.toThrow('ensureDir EACCES');

    const assembleFailedCall = auditSpy.mock.calls.find(c => c[0] === 'assemble_failed');
    expect(assembleFailedCall).toBeDefined();
    expect(assembleFailedCall![1]).toContain('module=inbox_reader');
    expect(assembleFailedCall![2]).toContain('phase=init');
    expect(assembleFailedCall![3]).toContain('EACCES');

    // Cleanup
    await fs.rm(path.dirname(path.dirname(clawDir)), { recursive: true, force: true }).catch(() => {});
  });
});
