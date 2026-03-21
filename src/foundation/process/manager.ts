/**
 * ProcessManager - Claw process manager
 *
 * Manages daemon process startup, shutdown, and status checks
 */

// TODO(phase3): zombie process detection - MVP uses `ps` command to detect zombies, TS only uses kill(0), macOS/Linux behavior differs

import { spawn, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';
import { readFileSync, openSync, mkdirSync, closeSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';

import type { IFileSystem } from '../fs/types.js';
import { 
  PROCESS_SPAWN_CONFIRM_MS,
  SIGTERM_GRACE_MS,
  RESTART_DELAY_MS,
} from '../../constants.js';

export interface ProcessStatus {
  pid: number;
  startedAt: string;
}

export class ProcessManager {
  private fs: IFileSystem;
  private baseDir: string;
  private resolveDir: (id: string) => string;

  constructor(fs: IFileSystem, baseDir: string, dirResolver?: (id: string) => string) {
    this.fs = fs;
    this.baseDir = baseDir;
    this.resolveDir = dirResolver ?? ((id: string) => path.join(baseDir, 'claws', id));
  }

  /**
   * Get the status directory path for a claw
   */
  private getStatusDir(clawId: string): string {
    return path.join(this.resolveDir(clawId), 'status');
  }

  /**
   * Get the pid file path
   */
  private getPidFile(clawId: string): string {
    return path.join(this.getStatusDir(clawId), 'pid');
  }

  /**
   * Ensure the status directory exists
   */
  private async ensureStatusDir(clawId: string): Promise<void> {
    const statusDir = this.getStatusDir(clawId);
    await this.fs.ensureDir(statusDir);
  }

  /**
   * Read the pid file
   */
  private async readPid(clawId: string): Promise<number | null> {
    try {
      const pidFile = this.getPidFile(clawId);
      const content = await this.fs.read(pidFile);
      const pid = parseInt(content.trim(), 10);
      return isNaN(pid) ? null : pid;
    } catch (err: any) {
      // ENOENT/FS_NOT_FOUND is expected (process not running); other errors should be logged
      if (err?.code !== 'ENOENT' && err?.code !== 'FS_NOT_FOUND') {
        console.warn(`[ProcessManager] Failed to read PID for ${clawId}:`, err?.message || err);
      }
      return null;
    }
  }

  /**
   * Write the pid file
   */
  private async writePid(clawId: string, pid: number): Promise<void> {
    await this.ensureStatusDir(clawId);
    const pidFile = this.getPidFile(clawId);
    await this.fs.writeAtomic(pidFile, String(pid));
  }

  /**
   * Delete the pid file
   */
  private async removePid(clawId: string): Promise<void> {
    try {
      const pidFile = this.getPidFile(clawId);
      await this.fs.delete(pidFile);
    } catch (err: any) {
      // Ignore file-not-found (ENOENT or NodeFileSystem's FS_NOT_FOUND)
      if (err.code !== 'ENOENT' && err.code !== 'FS_NOT_FOUND') {
        console.warn(`[ProcessManager] Failed to remove PID file for ${clawId}:`, err);
      }
    }
  }

  /**
   * Check whether the process is alive
   * Uses process.kill(pid, 0) to detect process existence
   */
  isAlive(clawId: string): boolean {
    // Read pid synchronously because async/await can be problematic in some scenarios
    try {
      const pidFile = this.getPidFile(clawId);
      const content = readFileSync(pidFile, 'utf-8');
      const pid = parseInt(content.trim(), 10);
      if (isNaN(pid)) return false;

      try {
        process.kill(pid, 0);
        return true;
      } catch (err: any) {
        // ESRCH = process does not exist
        if (err.code === 'ESRCH') {
          // Clean up stale pid file (async, fire-and-forget)
          this.removePid(clawId).catch(err => {
            console.warn(`[ProcessManager] Failed to clean stale PID for ${clawId}:`, err);
          });
          return false;
        }
        // EPERM = process exists but no permission (typically another user's process)
        if (err.code === 'EPERM') {
          return true;
        }
        return false;
      }
    } catch {
      return false;
    }
  }

  /**
   * Spawn the daemon process
   * @param clawId process ID
   * @param clawDir working directory
   * @param args optional spawn arguments (defaults to starting the claw daemon)
   * @returns process PID
   */
  async spawn(clawId: string, clawDir: string, args?: string[]): Promise<number> {
    // Fast-path: if already running, fail immediately to avoid waiting on pgrep
    if (this.isAlive(clawId)) {
      throw new Error(`Claw "${clawId}" is already running (PID file exists)`);
    }

    // Kill all orphaned daemon processes with the same name (pgrep scan)
    const pattern = `daemon-entry.js ${clawId}`;
    try {
      const output = execSync(`pgrep -f "${pattern}"`, { encoding: 'utf-8' });
      const pids = output.trim().split('\n').map(s => parseInt(s, 10)).filter(p => !isNaN(p) && p !== process.pid);
      for (const pid of pids) {
        try { process.kill(pid, 'SIGTERM'); } catch (err: any) {
          if (err?.code !== 'ESRCH') {
            console.warn(`[process] Failed to SIGTERM PID ${pid}: ${err?.message}`);
          }
        }
      }
      if (pids.length > 0) {
        await new Promise(resolve => setTimeout(resolve, SIGTERM_GRACE_MS));
      }
    } catch { /* pgrep returns exit code 1 when no match found */ }

    // Check and clean up the old daemon's lockfile
    const lockFile = path.join(this.getStatusDir(clawId), 'daemon.lock');
    try {
      const lockContent = readFileSync(lockFile, 'utf-8');
      const lockPid = parseInt(lockContent.trim(), 10);
      if (!isNaN(lockPid)) {
        try {
          process.kill(lockPid, 'SIGTERM');
          // Wait for graceful exit
          await new Promise(resolve => setTimeout(resolve, SIGTERM_GRACE_MS));
        } catch (err: any) {
          if (err?.code !== 'ESRCH') {
            console.warn(`[process] Failed to SIGTERM lock PID ${lockPid}: ${err?.message}`);
          }
        }
      }
      // Clean up stale lockfile
      try { await this.fs.delete(lockFile); } catch (err) {
        console.warn(`[process] Failed to delete lockfile ${lockFile}: ${err instanceof Error ? err.message : String(err)}`);
      }
    } catch { /* lockfile does not exist, this is normal */ }
    
    // Exclusively create the PID file (avoid race conditions)
    const pidFile = this.getPidFile(clawId);
    await this.ensureStatusDir(clawId);
    
    try {
      // 'wx' = write + exclusive, throws EEXIST if the file already exists
      const handle = await fs.open(pidFile, 'wx');
      await handle.close(); // Close the handle; actual PID will be written with writeFile later
    } catch (err: any) {
      if (err.code === 'EEXIST') {
        // Check whether the process is genuinely running or this is a stale PID file
        if (this.isAlive(clawId)) {
          throw new Error(`Claw "${clawId}" is already running (PID file exists)`);
        }
        // 区分：空文件 = spawn 进行中；有 PID 内容 = 陈旧文件
        let existingContent = '';
        try { existingContent = readFileSync(pidFile, 'utf-8').trim(); } catch {}
        if (existingContent === '') {
          // 空文件：可能有并发 spawn，记录警告后继续（接受极小概率重复启动）
          console.warn(`[ProcessManager] Empty PID file for "${clawId}", possible concurrent spawn`);
        }
        // 清理陈旧文件并重建
        await this.removePid(clawId).catch(() => {});
        const handle = await fs.open(pidFile, 'wx');
        await handle.close();
      } else {
        throw err;
      }
    }

    // Spawn the daemon process (using a dedicated entry file)
    const thisDir = path.dirname(fileURLToPath(import.meta.url));
    const bundleEntry = path.join(thisDir, 'daemon-entry.js');
    const daemonEntryPath = existsSync(bundleEntry)
      ? bundleEntry
      : path.resolve(thisDir, '..', '..', '..', 'dist', 'daemon-entry.js');
    const finalArgs = args ?? [daemonEntryPath, clawId];

    // Create the logs directory and log file
    const logsDir = path.join(clawDir, 'logs');
    mkdirSync(logsDir, { recursive: true });
    const logFd = openSync(path.join(logsDir, 'daemon.log'), 'a');

    try {
      const proc = spawn('node', finalArgs, {
        detached: true,
        stdio: ['ignore', logFd, logFd],  // stdout + stderr → daemon.log
        env: { ...process.env },
      });
      
      // Let the child process run independently, without blocking the parent from exiting
      proc.unref();

      const pid = proc.pid;
      if (!pid) {
        throw new Error('Failed to spawn daemon process');
      }

      // Write the pid file
      await fs.writeFile(pidFile, String(pid), 'utf-8');

      // Wait for spawn confirmation (non-blocking)
      await new Promise(resolve => setTimeout(resolve, PROCESS_SPAWN_CONFIRM_MS));

      // Verify that the process is alive
      if (!this.isAlive(clawId)) {
        throw new Error(`Daemon process failed to start. Check logs at: ${path.join(clawDir, 'logs', 'daemon.log')}`);
      }

      return pid;
    } catch (err) {
      // Startup failed — clean up the PID file
      await this.removePid(clawId).catch(() => {});
      throw err;
    } finally {
      // Design doc: ensure logFd is closed in all paths
      closeSync(logFd);
    }
  }

  /**
   * Gracefully stop the process
   * SIGTERM → wait 5 seconds → SIGKILL
   * @returns whether the process was successfully stopped
   */
  async stop(clawId: string): Promise<boolean> {
    const pid = await this.readPid(clawId);
    if (!pid) {
      return false;
    }

    // Check whether the process is still running
    if (!this.isAlive(clawId)) {
      await this.removePid(clawId);
      return true;
    }

    try {
      // Send SIGTERM
      process.kill(pid, 'SIGTERM');

      // Wait for graceful shutdown
      await new Promise(resolve => setTimeout(resolve, SIGTERM_GRACE_MS));

      // Check whether still running
      if (this.isAlive(clawId)) {
        // Force kill
        process.kill(pid, 'SIGKILL');
      }

      await this.removePid(clawId);
      return true;
    } catch (err: any) {
      // Process no longer exists
      if (err.code === 'ESRCH') {
        await this.removePid(clawId);
        return true;
      }
      return false;
    }
  }

  /**
   * Restart the daemon process
   * @param clawId process ID
   * @param clawDir working directory
   * @param args optional spawn arguments
   * @returns new process PID
   */
  async restart(clawId: string, clawDir: string, args?: string[]): Promise<number> {
    await this.stop(clawId);
    // Brief wait to ensure resources such as ports are released
    await new Promise(resolve => setTimeout(resolve, RESTART_DELAY_MS));
    return this.spawn(clawId, clawDir, args);
  }

  /**
   * List all running Claws
   * @returns list of running claw IDs
   */
  async listRunning(): Promise<string[]> {
    try {
      const clawsDir = path.join(this.baseDir, 'claws');
      const entries = await this.fs.list(clawsDir, { includeDirs: true });
      const running: string[] = [];

      for (const entry of entries) {
        if (entry.isDirectory) {
          const clawId = entry.name;
          if (this.isAlive(clawId)) {
            running.push(clawId);
          }
        }
      }

      return running;
    } catch (err) {
      console.warn('[process] listRunning failed:', err);
      return [];
    }
  }
}
