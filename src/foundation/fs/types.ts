/**
 * FileSystem types and interfaces (F1)
 * Phase 0: Interface definitions
 * 
 * Design principles:
 * - All paths are relative to claw's workspace (enforced by implementation)
 * - Atomic writes: write-to-temp + rename pattern
 * - Watch support via chokidar for inbox monitoring
 */

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  size: number;
  mtime: Date;
}

export type WatchEventType = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';

export interface WatchEvent {
  type: WatchEventType;
  path: string;
  stats?: {
    size: number;
    mtime: Date;
  };
}

export interface Watcher {
  /** Stop watching and clean up resources */
  close(): Promise<void>;
  
  /** Check if watcher is still active */
  isActive(): boolean;
  
  /** Get the watched path */
  getPath(): string;
}

/**
 * FileSystem interface - Abstract file operations
 * 
 * Implementation notes:
 * - All methods are async (Promise-based)
 * - Paths are validated to be within claw space (implementation responsibility)
 * - Atomic writes ensure no partial files on crash
 */
export interface IFileSystem {
  // ========================================================================
  // Basic File Operations
  // ========================================================================
  
  /**
   * Read file content as string
   * @param path - Relative path within claw space
   * @returns File content
   * @throws FileNotFoundError if file doesn't exist
   */
  read(path: string): Promise<string>;
  
  /**
   * Read file content as Buffer (for binary files)
   * @param path - Relative path within claw space
   * @returns File content as Buffer
   * @throws FileNotFoundError if file doesn't exist
   */
  readBuffer(path: string): Promise<Buffer>;
  
  /**
   * Write file atomically (write-to-temp + rename)
   * @param path - Relative path within claw space
   * @param content - Content to write
   * @throws PathNotInClawSpaceError if path is outside claw space
   */
  writeAtomic(path: string, content: string): Promise<void>;
  
  /**
   * Append content to file (creates if not exists)
   * @param path - Relative path within claw space
   * @param content - Content to append
   */
  append(path: string, content: string): Promise<void>;
  
  /**
   * Delete a file
   * @param path - Relative path within claw space
   * @throws FileNotFoundError if file doesn't exist
   */
  delete(path: string): Promise<void>;
  
  // ========================================================================
  // Directory Operations
  // ========================================================================
  
  /**
   * Ensure directory exists (creates recursively if needed)
   * @param path - Relative path within claw space
   */
  ensureDir(path: string): Promise<void>;
  
  /**
   * Remove directory and all contents
   * @param path - Relative path within claw space
   */
  removeDir(path: string): Promise<void>;
  
  /**
   * List directory contents
   * @param path - Relative path within claw space
   * @param options - Listing options
   * @returns Array of file entries
   */
  list(path: string, options?: {
    recursive?: boolean;
    includeDirs?: boolean;
    pattern?: string;  // glob pattern
  }): Promise<FileEntry[]>;
  
  // ========================================================================
  // Path Queries
  // ========================================================================
  
  /**
   * Check if path exists
   * @param path - Relative path within claw space
   */
  exists(path: string): Promise<boolean>;
  
  /**
   * Check if path is a file
   * @param path - Relative path within claw space
   */
  isFile(path: string): Promise<boolean>;
  
  /**
   * Check if path is a directory
   * @param path - Relative path within claw space
   */
  isDirectory(path: string): Promise<boolean>;
  
  /**
   * Get file stats
   * @param path - Relative path within claw space
   */
  stat(path: string): Promise<{
    size: number;
    mtime: Date;
    ctime: Date;
    isFile: boolean;
    isDirectory: boolean;
  }>;
  
  /**
   * Resolve absolute path (for validation)
   * @param path - Relative path
   * @returns Absolute path
   */
  resolve(path: string): string;
  
  // ========================================================================
  // File Watching
  // ========================================================================
  
  /**
   * Watch a path for changes
   * @param path - Path to watch (file or directory)
   * @param callback - Called on each change event
   * @returns Watcher handle
   */
  watch(path: string, callback: (event: WatchEvent) => void): Watcher;
  
  // ========================================================================
  // Advanced Operations
  // ========================================================================
  
  /**
   * Move/rename a file or directory
   * @param from - Source path
   * @param to - Destination path
   */
  move(from: string, to: string): Promise<void>;
  
  /**
   * Copy a file
   * @param from - Source path
   * @param to - Destination path
   */
  copy(from: string, to: string): Promise<void>;
  
  /**
   * Search for files matching pattern
   * @param pattern - Glob pattern
   * @param options - Search options
   * @returns Matching file paths
   */
  glob(pattern: string, options?: {
    cwd?: string;
    ignore?: string[];
  }): Promise<string[]>;
}

/**
 * FileSystem factory options
 */
export interface FileSystemOptions {
  /** Base directory for all operations */
  baseDir: string;
  
  /** Enable permission checks (default: true) */
  enforcePermissions?: boolean;
  
  /** Additional allowed paths outside baseDir (e.g., skills directory) */
  allowedPaths?: string[];
}

/**
 * Queue entry for directory-based task queues (pending→running→done)
 */
export interface QueueEntry {
  id: string;
  fileName: string;
  sourcePath: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

/**
 * DirectoryQueue interface - For inbox/task queue management
 */
export interface IDirectoryQueue {
  /** Get all pending entries */
  getPending(): Promise<QueueEntry[]>;
  
  /** Get all running entries */
  getRunning(): Promise<QueueEntry[]>;
  
  /** Get next pending entry and move it to running */
  dequeue(): Promise<QueueEntry | null>;
  
  /** Mark entry as completed */
  complete(entryId: string, result?: unknown): Promise<void>;
  
  /** Mark entry as failed */
  fail(entryId: string, error: string): Promise<void>;
  
  /** Move running entry back to pending (for recovery) */
  requeue(entryId: string): Promise<void>;
  
  /** Watch for new entries */
  watch(callback: (entry: QueueEntry) => void): Watcher;
}
