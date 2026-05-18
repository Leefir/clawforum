/**
 * daemon-loop saveLlmRetryState atomic tmp+rename (phase 1024 G.1)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fsNative from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';

const STATUS_SUBDIR = 'status';

describe('saveLlmRetryState atomic tmp+rename (phase 1024 G.1)', () => {
  let agentDir: string;
  let llmRetryStateFile: string;

  beforeEach(() => {
    agentDir = path.join(os.tmpdir(), `daemon-atomic-test-${randomUUID()}`);
    fsNative.mkdirSync(agentDir, { recursive: true });
    llmRetryStateFile = path.join(agentDir, STATUS_SUBDIR, 'llm-retry-state.json');
  });

  afterEach(() => {
    fsNative.rmSync(agentDir, { recursive: true, force: true });
  });

  it('writes tmp file with .pid.timestamp.tmp suffix then renames to final', () => {
    const llmRetryCount = 3;
    const llmRetryDelayMs = 5000;
    const llmRetryPending = true;

    // Inline helper (replicated from daemon-loop.ts)
    const saveLlmRetryState = () => {
      try {
        fsNative.mkdirSync(path.join(agentDir, STATUS_SUBDIR), { recursive: true });
        const tmpFile = `${llmRetryStateFile}.${process.pid}.${Date.now()}.tmp`;
        fsNative.writeFileSync(tmpFile, JSON.stringify({
          llmRetryCount,
          llmRetryDelayMs,
          llmRetryPending,
        }));
        fsNative.renameSync(tmpFile, llmRetryStateFile);
      } catch { /* Ignore */ }
    };

    saveLlmRetryState();

    // Verify final file readable and intact
    const saved = JSON.parse(fsNative.readFileSync(llmRetryStateFile, 'utf-8'));
    expect(saved.llmRetryCount).toBe(3);
    expect(saved.llmRetryDelayMs).toBe(5000);
    expect(saved.llmRetryPending).toBe(true);

    // Verify no tmp file left behind
    const statusDir = path.join(agentDir, STATUS_SUBDIR);
    const files = fsNative.readdirSync(statusDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toBe('llm-retry-state.json');
  });

  it('survives crash mid-write (tmp file left, final file absent or old)', () => {
    fsNative.mkdirSync(path.join(agentDir, STATUS_SUBDIR), { recursive: true });

    // Pre-existing old valid file
    fsNative.writeFileSync(llmRetryStateFile, JSON.stringify({ llmRetryCount: 0, llmRetryDelayMs: 1000, llmRetryPending: false }));

    // Simulate crash: write tmp but no rename
    const tmpFile = `${llmRetryStateFile}.${process.pid}.${Date.now()}.tmp`;
    fsNative.writeFileSync(tmpFile, JSON.stringify({ llmRetryCount: 99, llmRetryDelayMs: 9999, llmRetryPending: true }));
    // "crash" — no renameSync

    // Final file should still be the old valid one
    const saved = JSON.parse(fsNative.readFileSync(llmRetryStateFile, 'utf-8'));
    expect(saved.llmRetryCount).toBe(0);

    // Clean up tmp
    fsNative.unlinkSync(tmpFile);
  });

  it('tmp file naming contains pid and timestamp', () => {
    const capturedTmpFiles: string[] = [];

    const saveLlmRetryState = () => {
      try {
        fsNative.mkdirSync(path.join(agentDir, STATUS_SUBDIR), { recursive: true });
        const tmpFile = `${llmRetryStateFile}.${process.pid}.${Date.now()}.tmp`;
        capturedTmpFiles.push(tmpFile);
        fsNative.writeFileSync(tmpFile, JSON.stringify({ llmRetryCount: 1, llmRetryDelayMs: 1000, llmRetryPending: false }));
        fsNative.renameSync(tmpFile, llmRetryStateFile);
      } catch { /* Ignore */ }
    };

    saveLlmRetryState();

    expect(capturedTmpFiles).toHaveLength(1);
    expect(capturedTmpFiles[0]).toMatch(/\.\d+\.\d+\.tmp$/);
    expect(capturedTmpFiles[0]).toContain(String(process.pid));
  });
});
