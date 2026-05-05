/**
 * ProcessExec exec tests
 *
 * Covers the exec(command, args, options) entry point:
 * - Direct invocation (no shell)
 * - Args passed verbatim (spaces, quotes, special chars)
 * - Error paths: command not found, non-zero exit, timeout, AbortSignal
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { tmpdir } from 'os';
import * as fs from 'fs';

import { exec } from '../../src/foundation/process-exec/index.js';
import { ProcessExecError } from '../../src/foundation/process-exec/types.js';

describe('ProcessExec exec', () => {
  const workDir = tmpdir();

  // ── basic execution ─────────────────────────────────────────────────────

  it('should execute command with args', async () => {
    const result = await exec('echo', ['hello', 'world'], { cwd: workDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello world');
  });

  it('should return empty stderr on success', async () => {
    const result = await exec('echo', ['ok'], { cwd: workDir });
    expect(result.stderr).toBe('');
  });

  // ── args are verbatim (no shell interpretation) ─────────────────────────

  it('should pass args with spaces without shell splitting', async () => {
    // With shell: echo "hello world" → hello world
    // Without shell: args=['hello world'] → single arg passed to echo
    const result = await exec('echo', ['hello world'], { cwd: workDir });
    expect(result.stdout.trim()).toBe('hello world');
  });

  it('should pass args with special chars verbatim', async () => {
    const result = await exec('echo', ['$', 'HOME', '|', 'grep'], { cwd: workDir });
    // No shell expansion: $ stays literal, | stays literal
    expect(result.stdout.trim()).toBe('$ HOME | grep');
  });

  it('should pass args with single quotes verbatim', async () => {
    const result = await exec('echo', ["it's a test"], { cwd: workDir });
    expect(result.stdout.trim()).toBe("it's a test");
  });

  // ── contrast with exec (shell) ──────────────────────────────────────────

  it('exec does not expand $VAR, sh -c does', async () => {
    const direct = await exec('echo', ['$HOME'], { cwd: workDir });
    expect(direct.stdout.trim()).toBe('$HOME');

    const shell = await exec('sh', ['-c', 'echo $HOME'], { cwd: workDir });
    expect(shell.stdout.trim()).not.toBe('$HOME');
  });

  // ── error paths ─────────────────────────────────────────────────────────

  it('should throw ProcessExecError on non-existent command', async () => {
    await expect(
      exec('nonexistent_command_xyz_12345', [], { cwd: workDir }),
    ).rejects.toThrow(ProcessExecError);
  });

  it('should throw ProcessExecError on non-zero exit code', async () => {
    try {
      await exec('node', ['-e', 'process.exit(42)'], { cwd: workDir });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ProcessExecError);
      expect((err as ProcessExecError).exitCode).toBe(42);
    }
  });

  it('should capture stdout/stderr on non-zero exit', async () => {
    try {
      await exec('node', ['-e', `
        process.stdout.write('out data');
        process.stderr.write('err data');
        process.exit(1);
      `], { cwd: workDir });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ProcessExecError);
      expect((err as ProcessExecError).stdout).toBe('out data');
      expect((err as ProcessExecError).stderr).toBe('err data');
    }
  });

  it('should throw ProcessExecError on timeout', async () => {
    await expect(
      exec('node', ['-e', 'setTimeout(() => {}, 60000)'], {
        cwd: workDir,
        timeout: 1000,
      }),
    ).rejects.toThrow(ProcessExecError);

    try {
      await exec('node', ['-e', 'setTimeout(() => {}, 60000)'], {
        cwd: workDir,
        timeout: 1000,
      });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ProcessExecError);
      expect((err as ProcessExecError).killed).toBe(true);
    }
  });

  it('should throw ProcessExecError when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      exec('echo', ['should-not-run'], { cwd: workDir, signal: controller.signal }),
    ).rejects.toThrow();
  });

  // ── timeout clamping shared with exec ────────────────────────────────────

  it('should clamp timeout to MIN (1000ms)', async () => {
    // Requesting 10ms timeout should be clamped to 1000ms minimum
    // A 100ms sleep should succeed under the clamped timeout
    const result = await exec('node', ['-e', 'setTimeout(() => {}, 100)'], {
      cwd: workDir,
      timeout: 10, // below MIN, will be clamped to 1000
    });
    expect(result.exitCode).toBe(0);
  });

  // ── PATH augmentation shared with exec ───────────────────────────────────

  it('should include node bin dir in PATH', async () => {
    const result = await exec('node', ['-e', 'console.log(process.env.PATH)'], {
      cwd: workDir,
    });
    const nodeBinDir = path.dirname(process.execPath);
    expect(result.stdout).toContain(nodeBinDir);
  });
});
