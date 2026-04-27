/**
 * Watchdog port interfaces — H9 L3 WatchdogObserver/Control port
 *
 * CLI(L6b) 通过 port interface 消费 Watchdog(L6a) / 不直 import watchdog 内部。
 * Structural typing：watchdog 侧 0 改 / factory 构造 adapter 满足 interface。
 *
 * port pattern 第 4 次复用（phase337 + phase335 + phase340 + phase348）。
 */

/** Observer port — read-only watchdog state queries */
export interface WatchdogObserver {
  getWatchdogPid(): number | null;
  isWatchdogAlive(): boolean;
  getWatchdogEntryPath(): string;
}

/** Control port — lifecycle operations */
export interface WatchdogControl {
  startCommand(): Promise<void>;
  stopCommand(): Promise<void>;
}

/** Combined port for convenience */
export type WatchdogPort = WatchdogObserver & WatchdogControl;
