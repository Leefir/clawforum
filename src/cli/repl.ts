/**
 * 公共交互式 REPL - 工厂模式
 * 支持 Ink 和 pi-tui 后端切换
 */

// 接口导出不变
export interface ReplCallbacks {
  onBeforeLLMCall?: () => void;
  onToolCall?: (name: string) => void;
  onToolResult?: (name: string, result: { success: boolean; content: string }, step: number, maxSteps: number) => void;
  onTextDelta?: (delta: string) => void;  // 新增：流式文本增量
  onThinkingDelta?: (delta: string) => void;  // 新增：流式 thinking 增量
}

export interface ReplOptions {
  /** 提示符，如 '> ' 或 'motion> ' */
  prompt: string;
  /** 头部说明文字 */
  header: string;
  /** 处理单条消息，返回回复文本 */
  onMessage: (message: string, callbacks: ReplCallbacks) => Promise<string>;
  /** REPL 关闭时的清理 */
  onClose: () => Promise<void>;
  /** Ctrl+C 中断当前 LLM 调用 */
  onInterrupt?: () => void;
}

// 后端接口
export interface ReplBackend {
  start(options: ReplOptions): Promise<void>;
}

// Ink 后端（动态 import）
async function createInkBackend(): Promise<ReplBackend> {
  const React = await import('react');
  const { render } = await import('ink');
  const { App } = await import('./ink/App.js');

  return {
    async start(options: ReplOptions): Promise<void> {
      const { waitUntilExit } = render(
        React.createElement(App, { options }),
        { exitOnCtrlC: false }
      );
      await waitUntilExit();
      process.stdin.pause();
    },
  };
}

// pi-tui 后端（动态 import）
async function createPiTuiBackend(): Promise<ReplBackend> {
  const { runPiTui } = await import('./pi-tui/App.js');
  return {
    async start(options: ReplOptions): Promise<void> {
      await runPiTui(options);
    },
  };
}

// 公共入口（签名不变，callers 零改动）
// 环境变量 CLAWFORUM_TUI=ink 使用 Ink，否则默认使用 pi-tui
export async function startRepl(options: ReplOptions): Promise<void> {
  const useInk = process.env.CLAWFORUM_TUI === 'ink';
  const backend = useInk
    ? await createInkBackend()
    : await createPiTuiBackend();
  await backend.start(options);
}
