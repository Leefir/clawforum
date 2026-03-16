import type { ReplOptions, ReplCallbacks } from '../repl.js';

export async function runPiTui(options: ReplOptions): Promise<void> {
  const { TUI, Text, Input, ProcessTerminal } = await import('@mariozechner/pi-tui');
  const { prompt, header, onMessage, onClose } = options;

  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal);

  // 输出区域
  const outputText = new Text(header + '\nType your message or "exit" to quit.\n');

  // 输入组件
  const input = new Input();

  // 退出 Promise
  let resolveExit: () => void;
  const exitPromise = new Promise<void>(r => { resolveExit = r; });

  // 追加输出的辅助函数
  let outputContent = header + '\nType your message or "exit" to quit.\n';
  const appendOutput = (line: string) => {
    outputContent += '\n' + line;
    outputText.setText(outputContent);
    tui.requestRender();
  };

  // 退出逻辑
  const doExit = async () => {
    await onClose();
    tui.stop();
    await terminal.drainInput();
    process.stdin.pause();
    resolveExit();
  };

  // 提交处理
  let busy = false;
  input.onSubmit = async (text: string) => {
    if (busy) return;
    const trimmed = text.trim();

    if (!trimmed) {
      appendOutput(' ');
      input.setValue('');
      tui.requestRender();
      return;
    }

    if (trimmed === 'exit' || trimmed === 'quit') {
      await doExit();
      return;
    }

    // 显示用户消息
    appendOutput(`${prompt}${trimmed}`);
    input.setValue('');
    busy = true;

    const callbacks: ReplCallbacks = {};

    try {
      const reply = await onMessage(trimmed, callbacks);
      // reply 可能为空（流式输出已通过 callback 显示）
      if (reply) appendOutput(reply);
    } catch (e) {
      appendOutput(`Error: ${(e as Error).message}`);
    } finally {
      busy = false;
      tui.requestRender();
    }
  };

  tui.addChild(outputText);
  tui.addChild(input);
  tui.setFocus(input);
  tui.start();

  await exitPromise;
}
