/**
 * File watcher - chokidar wrapper
 *
 * Wraps chokidar to provide our Watcher interface
 */

import { watch as chokidarWatch, type FSWatcher } from 'chokidar';
import type { Watcher, WatchEvent, WatchEventType, WatcherErrorContext } from './types.js';

/**
 * Chokidar-based watcher implementation
 */
class ChokidarWatcher implements Watcher {
  private active = true;

  constructor(
    private readonly watcher: FSWatcher,
    private readonly watchPath: string
  ) {}

  async close(): Promise<void> {
    if (!this.active) {
      return;
    }

    this.active = false;
    await this.watcher.close();
  }

  isActive(): boolean {
    return this.active;
  }

  getPath(): string {
    return this.watchPath;
  }
}

/**
 * Map chokidar event to our WatchEventType
 */
function mapEventType(chokidarEvent: string): WatchEventType | null {
  switch (chokidarEvent) {
    case 'add':
      return 'add';
    case 'change':
      return 'change';
    case 'unlink':
      return 'unlink';
    case 'addDir':
      return 'addDir';
    case 'unlinkDir':
      return 'unlinkDir';
    default:
      return null;
  }
}

/**
 * Create a file watcher
 * @param absolutePath - Absolute path to watch (file or directory)
 * @param callback - Called on each change event
 * @param options - Watch options
 * @returns Watcher handle
 */
export function createWatcher(
  absolutePath: string,
  callback: (event: WatchEvent) => void,
  options?: {
    /** Watch recursively (for directories) */
    recursive?: boolean;
    /** Ignore patterns */
    ignored?: (string | RegExp)[];
    /** Initial scan callback */
    onReady?: () => void;
    /** Error callback */
    onError?: (err: Error, context: WatcherErrorContext) => void;
    /**
     * Write finish stability strategy.
     * 'stable' (default): 100ms stabilityThreshold — safe for files being written over time.
     * 'immediate': emit on every FS event without stabilization — for append-only log tails.
     */
    stability?: 'stable' | 'immediate';
    /**
     * Whether the watcher holds the event loop alive.
     * Default: true (for daemon loops).
     * Set false for short-lived TUI observers so the process can exit cleanly
     * if a watcher cleanup is missed.
     */
    persistent?: boolean;
  }
): Watcher {
  const watcher = chokidarWatch(absolutePath, {
    persistent: options?.persistent ?? true,
    ignoreInitial: true,
    depth: options?.recursive ? undefined : 0,
    ignored: options?.ignored,
    awaitWriteFinish: options?.stability === 'immediate'
      ? false
      : { stabilityThreshold: 100, pollInterval: 50 },
  });

  // Map chokidar events to our format
  watcher.on('all', (event, filePath, stats) => {
    const type = mapEventType(event);
    if (!type) {
      return;
    }

    const watchEvent: WatchEvent = {
      type,
      path: filePath,
    };

    if (stats) {
      watchEvent.stats = {
        size: stats.size,
        mtime: stats.mtime,
      };
    }

    try {
      callback(watchEvent);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      try { options?.onError?.(e, 'callback'); } catch { /* swallow secondary */ }
    }
  });

  // Ready event
  watcher.on('ready', () => {
    try {
      options?.onReady?.();
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      try { options?.onError?.(e, 'ready'); } catch { /* swallow */ }
    }
  });

  // Error handling
  watcher.on('error', (raw) => {
    const e = raw instanceof Error ? raw : new Error(String(raw));
    try { options?.onError?.(e, 'watch'); } catch { /* swallow */ }
  });

  return new ChokidarWatcher(watcher, absolutePath);
}
