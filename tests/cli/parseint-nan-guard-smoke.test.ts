/**
 * Layer B CLI integration smoke test — Layer B canary.
 * Layer A (parseIntOption validation) tested by parseint-nan-guard.test.ts.
 *
 * Verifies:
 * - npx tsx src/cli/index.ts boots
 * - commander parses --limit + dispatches to outboxCommand
 * - successful exec exits with code 0
 * - parseIntOption integration via helper to commander wiring works
 *
 * Single subprocess smoke test (no sister contention, predictable wall ~10-30s, 120000ms safety).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

const CLI_ENTRY = path.resolve(process.cwd(), 'dist/cli.js');

function runCli(args: string[], env: Record<string, string> = {}): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [CLI_ENTRY, ...args], {
      env: { ...process.env, ...env },
      cwd: process.cwd(),
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (data) => { stdout += data.toString(); });
    child.stderr?.on('data', (data) => { stderr += data.toString(); });
    child.on('error', reject);
    child.on('close', (exitCode) => { resolve({ stdout, stderr, exitCode }); });
  });
}

function makeTempRoot(): string {
  const dir = path.join(tmpdir(), `phase915-smoke-${randomUUID()}`);
  fs.mkdirSync(path.join(dir, '.clawforum', 'claws', 'test-claw', 'outbox', 'pending'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.clawforum', 'config.yaml'),
    'llm:\n  primary:\n    api_key: test\n'
  );
  return dir;
}

describe('CLI smoke - parseInt NaN guard Layer B canary', () => {
  let root: string;
  let prevRoot: string | undefined;

  beforeEach(() => {
    root = makeTempRoot();
    prevRoot = process.env.CLAWFORUM_ROOT;
    process.env.CLAWFORUM_ROOT = root;
  });

  afterEach(() => {
    if (prevRoot === undefined) delete process.env.CLAWFORUM_ROOT;
    else process.env.CLAWFORUM_ROOT = prevRoot;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('outbox --limit 10 → exit 0, no NaN error (Layer B integration canary)', async () => {
    const { stderr, exitCode } = await runCli(
      ['claw', 'outbox', 'test-claw', '--limit', '10'],
      { CLAWFORUM_ROOT: root }
    );
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain('--limit must be a non-negative integer');
  }, 120000);
});
