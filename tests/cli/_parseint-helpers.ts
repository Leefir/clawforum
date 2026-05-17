import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

export const CLI_ENTRY = path.resolve(process.cwd(), 'src/cli/index.ts');

export function runCli(args: string[], env: Record<string, string> = {}): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
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
    child.on('close', (exitCode) => { resolve({ stdout, stderr, exitCode }); });
  });
}

export function makeTempRoot(): string {
  const dir = path.join(tmpdir(), `phase841-nan-guard-${randomUUID()}`);
  fs.mkdirSync(path.join(dir, '.clawforum', 'claws', 'test-claw', 'outbox', 'pending'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.clawforum', 'config.yaml'),
    'llm:\n  primary:\n    api_key: test\n'
  );
  return dir;
}
