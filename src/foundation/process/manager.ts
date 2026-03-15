/**
 * ProcessManager - Claw 进程管理器
 *
 * 管理守护进程的启动、停止和状态检查
 */

// TODO(phase3): 僵尸进程检测 - MVP 用 `ps` 命令检测僵尸，TS 只用 kill(0)，macOS/Linux 行为差异

import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';
import { readFileSync, openSync, mkdirSync, closeSync } from 'fs';
import type { IFileSystem } from '../fs/types.js';

export interface ProcessStatus {
  pid: number;
  startedAt: string;
}

export class ProcessManager {
  private fs: IFileSystem;
  private baseDir: string;

  constructor(fs: IFileSystem, baseDir: string) {
    this.fs = fs;
    this.baseDir = baseDir;
  }

  /**
   * 获取 claw 的 status 目录路径
   */
  private getStatusDir(clawId: string): string {
    return path.join(this.baseDir, 'claws', clawId, 'status');
  }

  /**
   * 获取 pid 文件路径
   */
  private getPidFile(clawId: string): string {
    return path.join(this.getStatusDir(clawId), 'pid');
  }

  /**
   * 确保 status 目录存在
   */
  private async ensureStatusDir(clawId: string): Promise<void> {
    const statusDir = this.getStatusDir(clawId);
    await this.fs.ensureDir(statusDir);
  }

  /**
   * 读取 pid 文件
   */
  private async readPid(clawId: string): Promise<number | null> {
    try {
      const pidFile = this.getPidFile(clawId);
      const content = await this.fs.read(pidFile);
      const pid = parseInt(content.trim(), 10);
      return isNaN(pid) ? null : pid;
    } catch {
      return null;
    }
  }

  /**
   * 写入 pid 文件
   */
  private async writePid(clawId: string, pid: number): Promise<void> {
    await this.ensureStatusDir(clawId);
    const pidFile = this.getPidFile(clawId);
    await this.fs.writeAtomic(pidFile, String(pid));
  }

  /**
   * 删除 pid 文件
   */
  private async removePid(clawId: string): Promise<void> {
    try {
      const pidFile = this.getPidFile(clawId);
      await this.fs.delete(pidFile);
    } catch {
      // 忽略删除失败
    }
  }

  /**
   * 检查进程是否存活
   * 使用 process.kill(pid, 0) 检测进程是否存在
   */
  isAlive(clawId: string): boolean {
    // 使用同步方式读取 pid，因为在某些场景下 async/await 会有问题
    try {
      const pidFile = path.join(this.baseDir, 'claws', clawId, 'status', 'pid');
      const content = readFileSync(pidFile, 'utf-8');
      const pid = parseInt(content.trim(), 10);
      if (isNaN(pid)) return false;

      try {
        process.kill(pid, 0);
        return true;
      } catch (err: any) {
        // ESRCH = 进程不存在
        if (err.code === 'ESRCH') {
          // 清理 stale pid 文件（异步，不等待）
          this.removePid(clawId).catch(err => {
            console.warn(`[ProcessManager] Failed to clean stale PID for ${clawId}:`, err);
          });
          return false;
        }
        // EPERM = 进程存在但没有权限（通常是其他用户的进程）
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
   * 启动守护进程
   * @returns 进程 PID
   */
  async spawn(clawId: string, clawDir: string): Promise<number> {
    // 检查是否已运行
    if (this.isAlive(clawId)) {
      throw new Error(`Claw "${clawId}" is already running`);
    }

    // 清理旧的 pid 文件
    await this.removePid(clawId);

    // 启动守护进程
    const cliPath = path.resolve(clawDir, '..', '..', '..', 'dist', 'cli.js');
    
    // 创建日志目录和日志文件
    const logsDir = path.join(clawDir, 'logs');
    mkdirSync(logsDir, { recursive: true });
    const logFd = openSync(path.join(logsDir, 'daemon.log'), 'a');
    
    try {
      const proc = spawn('node', [cliPath, 'claw', 'daemon', clawId], {
        detached: true,
        stdio: ['ignore', logFd, logFd],  // stdout + stderr → daemon.log
        cwd: process.cwd(),
      });

      const pid = proc.pid;
      if (!pid) {
        throw new Error('Failed to spawn daemon process');
      }

      // 写入 pid 文件
      await this.writePid(clawId, pid);

      // 等待进程启动确认（非阻塞）
      await new Promise(resolve => setTimeout(resolve, 500));

      return pid;
    } finally {
      // Design doc: ensure logFd is closed in all paths
      closeSync(logFd);
    }
  }

  /**
   * 优雅停止进程
   * SIGTERM → 等待5秒 → SIGKILL
   * @returns 是否成功停止
   */
  async stop(clawId: string): Promise<boolean> {
    const pid = await this.readPid(clawId);
    if (!pid) {
      return false;
    }

    // 检查进程是否还在运行
    if (!this.isAlive(clawId)) {
      await this.removePid(clawId);
      return true;
    }

    try {
      // 发送 SIGTERM
      process.kill(pid, 'SIGTERM');

      // 等待5秒
      await new Promise(resolve => setTimeout(resolve, 5000));

      // 检查是否还在运行
      if (this.isAlive(clawId)) {
        // 强制终止
        process.kill(pid, 'SIGKILL');
      }

      await this.removePid(clawId);
      return true;
    } catch (err: any) {
      // 进程已经不存在
      if (err.code === 'ESRCH') {
        await this.removePid(clawId);
        return true;
      }
      return false;
    }
  }

  /**
   * 重启守护进程
   * @returns 新进程 PID
   */
  async restart(clawId: string, clawDir: string): Promise<number> {
    await this.stop(clawId);
    // 等待一小段时间确保端口等资源释放
    await new Promise(resolve => setTimeout(resolve, 1000));
    return this.spawn(clawId, clawDir);
  }

  /**
   * 列出所有运行的 Claw
   * @returns 运行中的 claw ID 列表
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
