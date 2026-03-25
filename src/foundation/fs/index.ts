/**
 * FileSystem module (F1)
 * Phase 0: Node.js implementation
 * 
 * Exports: IFileSystem interface, NodeFileSystem implementation,
 *          DirectoryQueue, permissions, watcher utilities
 */

// Types and interfaces
export type {
  FileEntry,
  WatchEvent,
  WatchEventType,
  Watcher,
  IFileSystem,
  FileSystemOptions,
} from './types.js';

// Implementation classes
export { NodeFileSystem } from './node-fs.js';

// Permission utilities
export {
  createPermissionChecker,
  checkReadPermission,
  checkWritePermission,
} from './permissions.js';
export type {
  PermissionOptions,
  PermissionChecker,
} from './permissions.js';

// Watcher utilities
export { createWatcher, watchDirForNewFiles } from './watcher.js';

// Atomic file operations (for advanced use)
export {
  readFile,
  readFileBuffer,
  writeAtomic,
  appendFile,
  ensureDir,
  deleteFile,
  removeDir,
  moveFile,
  copyFile,
  exists,
  stat,
  isFile,
  isDirectory,
  cleanupOrphanedTemp,
  cleanupTempFiles,
} from './atomic.js';
