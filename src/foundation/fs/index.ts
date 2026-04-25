/**
 * @module L1.FileSystem
 * FileSystem module (L1)
 *
 * clawforum 进程内代码的所有文件 I/O 的唯一入口。
 * 原子写、路径守护、权限域配置。
 */

// Types and interfaces
export type {
  FileEntry,
  FileSystem,
  FileSystemOptions,
} from './types.js';

// Implementation classes
export { NodeFileSystem } from './node-fs.js';

// Permission utilities
export {
  createPermissionChecker,
} from './permissions.js';
export type {
  PermissionOptions,
  PermissionChecker,
} from './permissions.js';

// Atomic file operations
export {
  readFile,
  writeAtomic,
  appendFile,
  ensureDir,
  deleteFile,
  removeDir,
  moveFile,
  exists,
  stat,
  isDirectory,
  cleanupOrphanedTemp,
  IGNORE_PATTERN,
} from './atomic.js';
