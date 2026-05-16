/**
 * CLI parseInt NaN guard — F3.1 outbox --limit + F3.2 contract events --since
 *
 * Verifies user input boundary parseInt results trigger CliError
 * when non-numeric strings are passed via CLI flags.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

const CLI_ENTRY = path.resolve(process.cwd(), 'src/cli/index.ts');

function runCli(args: string[], env: Record<string, string> = {}): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', CLI_ENTRY, ...args], {
      env: { ...process.env, ...env },
      cwd: process.cwd(),
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => { stdout += data.toString(); });
    child.stderr?.on('data', (data) => { stderr += data.toString(); });

    child.on('error', reject);
    child.on('close', (exitCode) => {
      resolve({ stdout, stderr, exitCode });
    });
  });
}

function makeTempRoot(): string {
  const dir = path.join(tmpdir(), `phase841-nan-guard-${randomUUID()}`);
  fs.mkdirSync(path.join(dir, '.clawforum', 'claws', 'test-claw', 'outbox', 'pending'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.clawforum', 'config.yaml'),
    'llm:\n  primary:\n    api_key: test\n'
  );
  return dir;
}

describe('CLI parseInt NaN guard', () => {
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

  it('outbox --limit abc → CliError with clear message + exit code 1', async () => {
    const { stderr, exitCode } = await runCli(
      ['claw', 'outbox', 'test-claw', '--limit', 'abc'],
      { CLAWFORUM_ROOT: root }
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain('--limit must be a non-negative integer');
    expect(stderr).toContain('got: abc');
  });

  it('outbox --limit 10 → no NaN error, normal execution', async () => {
    const { stderr, exitCode } = await runCli(
      ['claw', 'outbox', 'test-claw', '--limit', '10'],
      { CLAWFORUM_ROOT: root }
    );
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain('--limit must be a non-negative integer');
  });

  it('contract events --since xyz → CliError with clear message + exit code 1', async () => {
    const { stderr, exitCode } = await runCli(
      ['contract', 'events', 'test-claw', '--since', 'xyz'],
      { CLAWFORUM_ROOT: root }
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain('--since must be a Unix timestamp in milliseconds');
    expect(stderr).toContain('got: xyz');
  });

  it('contract events --since 1704067200000 → no NaN error, normal execution', async () => {
    const { stderr, exitCode } = await runCli(
      ['contract', 'events', 'test-claw', '--since', '1704067200000'],
      { CLAWFORUM_ROOT: root }
    );
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain('--since must be a Unix timestamp in milliseconds');
  });
});
