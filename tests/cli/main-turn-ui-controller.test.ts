import { describe, it, expect, vi } from 'vitest';
import { createMainTurnUI } from '../../src/cli/commands/chat-viewport.js';
import { VIEWPORT_AUDIT_EVENTS } from '../../src/cli/commands/viewport-audit-events.js';

describe('MainTurnUIController', () => {
  const makeDeps = () => ({
    appendOutput: vi.fn(),
    updateDisplay: vi.fn(),
    trimOutputNewlines: true,
    getThinkingMode: vi.fn(() => 'full' as const),
    audit: { write: vi.fn() },
  });

  it('正常 main scope 下写操作不触发 audit', () => {
    const deps = makeDeps();
    const mainUI = createMainTurnUI(deps);

    mainUI.withScope('main', () => {
      mainUI.setPreview('hello');
      mainUI.enterPhase('waiting_llm');
      mainUI.appendToBuffer('world');
    });

    expect(deps.audit.write).not.toHaveBeenCalled();
    expect(deps.updateDisplay).toHaveBeenCalled();
  });

  it('task scope 下写主 UI 触发 viewport_ui_cross_pollution audit', () => {
    const deps = makeDeps();
    const mainUI = createMainTurnUI(deps);

    mainUI.withScope('task', () => {
      mainUI.setPreview('polluted');
    });

    expect(deps.audit.write).toHaveBeenCalledTimes(1);
    expect(deps.audit.write).toHaveBeenCalledWith(
      VIEWPORT_AUDIT_EVENTS.UI_CROSS_POLLUTION,
      'method=setPreview',
      'source=task',
    );
  });

  it('task scope 下多个写操作各自触发 audit', () => {
    const deps = makeDeps();
    const mainUI = createMainTurnUI(deps);

    mainUI.withScope('task', () => {
      mainUI.setPreview('a');
      mainUI.clearPreview();
      mainUI.enterPhase('waiting_llm');
      mainUI.enterPhase('idle');
      mainUI.appendToBuffer('b');
      mainUI.flushStreaming();
      mainUI.appendToThinking('c');
      mainUI.flushThinking();
    });

    expect(deps.audit.write.mock.calls.length).toBeGreaterThanOrEqual(8);
    const methods = deps.audit.write.mock.calls.map((c: unknown[]) => c[1]);
    expect(methods).toContain('method=setPreview');
    expect(methods).toContain('method=clearPreview');
    expect(methods).toContain('method=enterPhase:waiting_llm');
    expect(methods).toContain('method=enterPhase:idle');
    expect(methods).toContain('method=appendToBuffer');
    expect(methods).toContain('method=flushStreaming');
    expect(methods).toContain('method=appendToThinking');
    expect(methods).toContain('method=flushThinking');
  });

  it('system scope 下写操作不触发 audit', () => {
    const deps = makeDeps();
    const mainUI = createMainTurnUI(deps);

    mainUI.withScope('system', () => {
      mainUI.setPreview('system');
    });

    expect(deps.audit.write).not.toHaveBeenCalled();
  });

  it('withScope 嵌套时恢复上一 scope', () => {
    const deps = makeDeps();
    const mainUI = createMainTurnUI(deps);

    mainUI.withScope('main', () => {
      mainUI.setPreview('outer');
      expect(deps.audit.write).not.toHaveBeenCalled();

      mainUI.withScope('task', () => {
        mainUI.setPreview('inner');
        expect(deps.audit.write).toHaveBeenCalledTimes(1);
      });

      mainUI.setPreview('outer-again');
      expect(deps.audit.write).toHaveBeenCalledTimes(1);
    });
  });

  it('withScope 异常时仍恢复 scope', () => {
    const deps = makeDeps();
    const mainUI = createMainTurnUI(deps);

    expect(() => {
      mainUI.withScope('task', () => {
        throw new Error('boom');
      });
    }).toThrow('boom');

    mainUI.withScope('main', () => {
      mainUI.setPreview('safe');
    });
    expect(deps.audit.write).not.toHaveBeenCalled();
  });

  it('appendToBuffer 返回更新后的 buffer', () => {
    const deps = makeDeps();
    const mainUI = createMainTurnUI(deps);

    expect(mainUI.appendToBuffer('hello')).toBe('hello');
    expect(mainUI.appendToBuffer(' world')).toBe('hello world');
  });

  it('appendToThinking 返回更新后的 buffer', () => {
    const deps = makeDeps();
    const mainUI = createMainTurnUI(deps);

    expect(mainUI.appendToThinking('think')).toBe('think');
    expect(mainUI.appendToThinking('ing')).toBe('thinking');
  });

  // —— 新增：双槽独立 ——
  it('status 与 preview 双槽独立、互不覆盖', () => {
    const deps = makeDeps();
    const mainUI = createMainTurnUI(deps);

    mainUI.enterPhase('waiting_llm');
    mainUI.setPreview('preview text');

    expect(mainUI.getStatus()).toMatch(/Thinking/);
    expect(mainUI.getPreview()).toBe('preview text');
  });

  // —— 新增：min-dwell 反向防同 tick 塌缩 ——
  it('同 tick enterPhase waiting_llm → streaming_text，status slot 仍保留 spinner（dwell 内推迟 clear）', async () => {
    vi.useFakeTimers();
    try {
      const deps = makeDeps();
      const mainUI = createMainTurnUI(deps);

      mainUI.enterPhase('waiting_llm');
      const statusAfterEnter = mainUI.getStatus();
      expect(statusAfterEnter).toMatch(/Thinking/);

      mainUI.enterPhase('streaming_text');
      // dwell 内未到期、status slot 仍有 spinner（pendingClear 已 schedule 但未 fire）
      expect(mainUI.getStatus()).toMatch(/Thinking/);
      expect(mainUI.getPhase()).toBe('streaming_text');

      // 推过 dwell + 一帧
      await vi.advanceTimersByTimeAsync(250);
      expect(mainUI.getStatus()).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  // —— 新增：dwell 内切回 spinner 类 phase 取消 pendingClear ——
  it('dwell 内切回 waiting_llm，spinner 不被 pendingClear 误清', async () => {
    vi.useFakeTimers();
    try {
      const deps = makeDeps();
      const mainUI = createMainTurnUI(deps);

      mainUI.enterPhase('waiting_llm');
      mainUI.enterPhase('streaming_text');         // schedule pendingClear
      mainUI.enterPhase('waiting_llm');            // 应 cancel pendingClear

      await vi.advanceTimersByTimeAsync(300);
      expect(mainUI.getStatus()).toMatch(/Thinking/);
    } finally {
      vi.useRealTimers();
    }
  });

  // —— 新增：tool spinner label 切换无缝 ——
  it('waiting_llm → running_tool 切换 label 不重置 dwell 起点', async () => {
    vi.useFakeTimers();
    try {
      const deps = makeDeps();
      const calls: Array<[string, string]> = [];
      const mainUI2 = createMainTurnUI({
        ...deps,
        observability: { recordSpinner: (a, t) => calls.push([a, t]) },
      });

      mainUI2.enterPhase('waiting_llm');
      mainUI2.enterPhase('running_tool', 'exec');

      // 仅 1 次 start（waiting_llm），label 切换不再产 start
      expect(calls.filter(c => c[0] === 'start')).toHaveLength(1);
      expect(mainUI2.getStatus()).toMatch(/exec\.\.\./);
    } finally {
      vi.useRealTimers();
    }
  });

  // —— 新增：getPhase 返回当前 phase ——
  it('getPhase 反映 enterPhase 的最新值', () => {
    const deps = makeDeps();
    const mainUI = createMainTurnUI(deps);

    expect(mainUI.getPhase()).toBe('idle');
    mainUI.enterPhase('waiting_llm');
    expect(mainUI.getPhase()).toBe('waiting_llm');
    mainUI.enterPhase('running_tool', 'foo');
    expect(mainUI.getPhase()).toBe('running_tool');
  });
});
