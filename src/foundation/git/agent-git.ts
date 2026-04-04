/**
 * Agent Git - Git version control for agent directories
 * 
 * Each agent directory has its own git repo:
 * - initAgentGit: Idempotent git init with .gitignore
 * - commitAgentDir: Auto-commit working tree changes
 * 
 * All git operations are best-effort; failures are logged but don't block business logic.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { writeFile } from 'fs/promises';
import { existsSync } from 'fs';

const execFileAsync = promisify(execFile);

const GITIGNORE_CONTENT = `stream.jsonl
audit.tsv
logs/
tasks/results/
*.tmp
`;

async function git(dir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd: dir });
  return stdout.trim();
}

/**
 * Idempotent: skip if .git already exists.
 * Write .gitignore → git init → set local user config → empty commit to ensure HEAD exists.
 */
export async function initAgentGit(dir: string): Promise<void> {
  if (existsSync(path.join(dir, '.git'))) return;
  try {
    await writeFile(path.join(dir, '.gitignore'), GITIGNORE_CONTENT, 'utf-8');
    await git(dir, ['init']);
    await git(dir, ['config', 'user.name', 'clawforum']);
    await git(dir, ['config', 'user.email', 'clawforum@local']);
    await git(dir, ['add', '.']);
    await git(dir, ['commit', '--allow-empty', '-m', 'init']);
  } catch (err) {
    console.warn('[git] initAgentGit failed:', err instanceof Error ? err.message : String(err));
  }
}

/**
 * If there are uncommitted changes, execute git add . && git commit. No-op when no changes.
 */
export async function commitAgentDir(dir: string, message: string): Promise<void> {
  try {
    const status = await git(dir, ['status', '--porcelain']);
    if (!status) return;
    await git(dir, ['add', '.']);
    await git(dir, ['commit', '-m', message]);
  } catch (err) {
    console.warn('[git] commitAgentDir failed:', err instanceof Error ? err.message : String(err));
  }
}
