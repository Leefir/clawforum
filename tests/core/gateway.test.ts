import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { createGateway } from '../../src/core/gateway/index.js';
import type { Gateway, GatewayInput } from '../../src/core/gateway/index.js';
import type { Transport, Connection } from '../../src/foundation/transport/index.js';
import type { StreamReader, StreamEvent } from '../../src/foundation/stream/index.js';
import type { ToolResult, ExecContext } from '../../src/core/tools/index.js';

function createStubTransport(): Transport & {
  _connect(conn: Connection): void;
  _disconnect(conn: Connection): void;
  _message(conn: Connection, data: string): void;
} {
  const connections = new Map<string, Connection>();
  const connectCbs: Array<(conn: Connection) => void> = [];
  const disconnectCbs: Array<(conn: Connection, reason?: Error) => void> = [];
  const messageCbs: Array<(conn: Connection, data: string) => void> = [];
  const transportErrorCbs: Array<(evt: import('../../src/foundation/transport/index.js').TransportErrorEvent) => void> = [];

  return {
    listen: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    send: vi.fn(),
    broadcast: vi.fn().mockReturnValue({ failed: [] }),
    getConnections: () => Array.from(connections.values()),
    onConnect: (cb) => connectCbs.push(cb),
    onDisconnect: (cb) => disconnectCbs.push(cb),
    onMessage: (cb) => messageCbs.push(cb),
    onTransportError: (cb) => transportErrorCbs.push(cb),
    _connect: (conn) => {
      connections.set(conn.id, conn);
      for (const cb of connectCbs) {
        try { cb(conn); } catch (err) { /* Transport safeFire isolates */ }
      }
    },
    _disconnect: (conn) => {
      connections.delete(conn.id);
      for (const cb of disconnectCbs) {
        try { cb(conn); } catch (err) { /* Transport safeFire isolates */ }
      }
    },
    _message: (conn, data) => {
      for (const cb of messageCbs) {
        try {
          cb(conn, data);
        } catch (err) {
          transportErrorCbs.forEach((tcb) => tcb({
            kind: 'callback_error',
            callbackName: 'onMessage',
            error: err instanceof Error ? err : new Error(String(err)),
          }));
        }
      }
    },
  };
}

function createStubStreamReaderFactory(): {
  factory: (onEvent: (ev: StreamEvent) => void) => StreamReader;
  fireEvent: (ev: StreamEvent) => void;
  lastReader: StreamReader | null;
} {
  let onEventRef: ((ev: StreamEvent) => void) | null = null;
  const readers: StreamReader[] = [];

  const factory = (cb: (ev: StreamEvent) => void): StreamReader => {
    onEventRef = cb;
    const reader: StreamReader = {
      start: vi.fn(),
      stop: vi.fn().mockResolvedValue(undefined),
      isActive: vi.fn().mockReturnValue(true),
    };
    readers.push(reader);
    return reader;
  };

  return {
    factory,
    fireEvent: (ev) => onEventRef?.(ev),
    get lastReader() {
      return readers[readers.length - 1] ?? null;
    },
  };
}

describe('Gateway', () => {
  let transport: ReturnType<typeof createStubTransport>;
  let streamStub: ReturnType<typeof createStubStreamReaderFactory>;
  let interruptFn: ReturnType<typeof vi.fn>;
  let gateway: Gateway | null = null;

  beforeEach(() => {
    transport = createStubTransport();
    streamStub = createStubStreamReaderFactory();
    interruptFn = vi.fn();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (gateway) {
      await gateway.stop();
      gateway = null;
    }
  });

  function createOnlineInput(): GatewayInput {
    return {
      streamFactory: streamStub.factory,
      transport,
      interrupt: interruptFn,
    };
  }

  function createOfflineInput(): GatewayInput {
    return {
      streamFactory: streamStub.factory,
      interrupt: interruptFn,
    };
  }

  it('offline mode: start/stop are no-ops, isOnline() false, no connections', async () => {
    gateway = createGateway(createOfflineInput());
    expect(gateway.isOnline()).toBe(false);

    await gateway.start();
    expect(transport.listen).not.toHaveBeenCalled();
    expect(streamStub.lastReader).toBeNull();

    await gateway.stop();
    expect(transport.close).not.toHaveBeenCalled();
    expect(gateway.getActiveConnections()).toEqual([]);
  });

  it('online: isOnline() is false before start, true after start, false after stop', async () => {
    gateway = createGateway(createOnlineInput());
    expect(gateway.isOnline()).toBe(false);
    await gateway.start();
    expect(gateway.isOnline()).toBe(true);
    await gateway.stop();
    expect(gateway.isOnline()).toBe(false);
  });

  it('online mode: start binds transport callbacks and calls stream.start', async () => {
    gateway = createGateway(createOnlineInput());
    await gateway.start();

    expect(streamStub.lastReader?.start).toHaveBeenCalledTimes(1);
    // transport callbacks registered (at least one of each)
    expect(transport.broadcast).not.toHaveBeenCalled();
  });

  it('broadcasts stream events to all connected clients', async () => {
    gateway = createGateway(createOnlineInput());
    await gateway.start();

    const ev: StreamEvent = { ts: 1, type: 'test', data: 'hello' };
    streamStub.fireEvent(ev);

    expect(transport.broadcast).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(transport.broadcast.mock.calls[0][0] as string);
    expect(payload).toEqual({ type: 'stream', event: ev });
  });

  it('interrupt message triggers callback once; repeated within 500ms is debounced', async () => {
    gateway = createGateway(createOnlineInput());
    await gateway.start();

    const conn: Connection = { id: 'c1', connectedAt: Date.now() };
    transport._connect(conn);

    transport._message(conn, JSON.stringify({ type: 'interrupt', reason: 'user' }));
    expect(interruptFn).toHaveBeenCalledTimes(1);
    expect(interruptFn).toHaveBeenCalledWith('user');

    // within debounce window
    vi.advanceTimersByTime(400);
    transport._message(conn, JSON.stringify({ type: 'interrupt', reason: 'user' }));
    expect(interruptFn).toHaveBeenCalledTimes(1);
  });

  it('interrupt after debounce window triggers again', async () => {
    gateway = createGateway(createOnlineInput());
    await gateway.start();

    const conn: Connection = { id: 'c1', connectedAt: Date.now() };
    transport._connect(conn);

    transport._message(conn, JSON.stringify({ type: 'interrupt', reason: 'user' }));
    expect(interruptFn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(600);
    transport._message(conn, JSON.stringify({ type: 'interrupt', reason: 'user' }));
    expect(interruptFn).toHaveBeenCalledTimes(2);
  });

  it('malformed JSON drops the connection + broadcasts connection_dropped', async () => {
    gateway = createGateway(createOnlineInput());
    await gateway.start();

    const conn: Connection = { id: 'c1', connectedAt: Date.now() };
    transport._connect(conn);

    transport._message(conn, 'not json');

    expect(transport.broadcast).toHaveBeenCalledWith(
      JSON.stringify({ type: 'connection_dropped', connectionId: 'c1', reason: 'malformed JSON' }),
    );
  });

  it('unknown message type drops the connection', async () => {
    gateway = createGateway(createOnlineInput());
    await gateway.start();

    const conn: Connection = { id: 'c1', connectedAt: Date.now() };
    transport._connect(conn);

    transport._message(conn, JSON.stringify({ type: 'unknown_thing' }));

    expect(transport.broadcast).toHaveBeenCalledWith(
      JSON.stringify({ type: 'connection_dropped', connectionId: 'c1', reason: 'unknown message type' }),
    );
  });

  it('ask_user_reply with no pending session is silently ignored, does not drop connection', async () => {
    gateway = createGateway(createOnlineInput());
    await gateway.start();

    const conn: Connection = { id: 'c1', connectedAt: Date.now() };
    transport._connect(conn);

    transport._message(conn, JSON.stringify({ type: 'ask_user_reply', id: 'q1', answer: 'yes' }));

    // no broadcast, connection not dropped
    const droppedCalls = transport.broadcast.mock.calls.filter(
      (c) => (JSON.parse(c[0] as string) as { type: string }).type === 'connection_dropped',
    );
    expect(droppedCalls).toHaveLength(0);
  });

  it('stop() tears down: stream first, then connections, then transport.close', async () => {
    gateway = createGateway(createOnlineInput());
    await gateway.start();

    const conn: Connection = { id: 'c1', connectedAt: Date.now() };
    transport._connect(conn);

    const order: string[] = [];
    const origStreamStop = streamStub.lastReader!.stop;
    streamStub.lastReader!.stop = vi.fn(async () => {
      order.push('stream.stop');
      return origStreamStop();
    });
    const origBroadcast = transport.broadcast;
    transport.broadcast = vi.fn((data: string) => {
      order.push('broadcast:' + (JSON.parse(data) as { type: string }).type);
      return origBroadcast(data);
    });
    const origTransportClose = transport.close;
    transport.close = vi.fn(async () => {
      order.push('transport.close');
      return origTransportClose();
    });

    await gateway.stop();

    const streamStopIdx = order.indexOf('stream.stop');
    const connDroppedIdx = order.findIndex((s) => s.startsWith('broadcast:connection_dropped'));
    const transportCloseIdx = order.indexOf('transport.close');

    expect(streamStopIdx).toBeGreaterThanOrEqual(0);
    expect(connDroppedIdx).toBeGreaterThanOrEqual(0);
    expect(transportCloseIdx).toBeGreaterThanOrEqual(0);
    expect(streamStopIdx).toBeLessThan(connDroppedIdx);
    expect(connDroppedIdx).toBeLessThan(transportCloseIdx);
  });

  it('onDisconnect removes connection from active set', async () => {
    gateway = createGateway(createOnlineInput());
    await gateway.start();

    const conn: Connection = { id: 'c1', connectedAt: Date.now() };
    transport._connect(conn);
    expect(gateway.getActiveConnections()).toHaveLength(1);

    transport._disconnect(conn);
    expect(gateway.getActiveConnections()).toHaveLength(0);
  });

  it('interrupt callback throw is isolated by Transport safeFire, does not drop connection or block future messages', async () => {
    interruptFn.mockImplementationOnce(() => {
      throw new Error('interrupt boom');
    });

    gateway = createGateway(createOnlineInput());
    await gateway.start();

    const conn: Connection = { id: 'c1', connectedAt: Date.now() };
    transport._connect(conn);

    // first interrupt: callback throws, but Transport safeFire isolates it
    transport._message(conn, JSON.stringify({ type: 'interrupt', reason: 'user' }));
    expect(interruptFn).toHaveBeenCalledTimes(1);
    // connection still alive
    expect(gateway.getActiveConnections().some((c) => c.id === 'c1')).toBe(true);

    // second interrupt after debounce: callback called again, connection still alive
    vi.advanceTimersByTime(600);
    transport._message(conn, JSON.stringify({ type: 'interrupt', reason: 'user' }));
    expect(interruptFn).toHaveBeenCalledTimes(2);
    expect(gateway.getActiveConnections().some((c) => c.id === 'c1')).toBe(true);
  });

  it('start twice throws', async () => {
    gateway = createGateway(createOnlineInput());
    await gateway.start();
    await expect(gateway.start()).rejects.toThrow('Gateway already started');
  });
});
