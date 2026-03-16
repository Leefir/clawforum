import type { ReplOptions, ReplCallbacks } from '../repl.js';

export async function runPiTui(options: ReplOptions): Promise<void> {
  const { TUI, Text, Input, ProcessTerminal } = await import('@mariozechner/pi-tui');
  const { prompt, header, onMessage, onClose } = options;

  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal);

  // 输出区域（历史消息）
  const outputText = new Text(header + '\nType your message or "exit" to quit.\n');

  // 流式文本显示区域（当前正在接收的文本）
  const streamingTextComponent = new Text('');

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

  // 流式文本累积
  let streamingText = '';

  // flush 流式文本到输出历史
  const flushStreaming = () => {
    if (streamingText) {
      appendOutput(streamingText);
      streamingText = '';
      streamingTextComponent.setText('');
    }
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

    const callbacks: ReplCallbacks = {
      onBeforeLLMCall: () => {
        flushStreaming();
        streamingTextComponent.setText('⏳ Thinking...');
        tui.requestRender();
      },
      onToolCall: (name: string) => {
        flushStreaming();
        streamingTextComponent.setText(`→ ${name}...`);
        tui.requestRender();
        appendOutput(`\x1b[36m→ ${name}\x1b[0m`);
      },
      onToolResult: (name: string, result: { success: boolean; content: string }, step: number, maxSteps: number) => {
        const flat = result.content.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
        const summary = flat.length > 80 ? flat.slice(0, 80) + '...' : flat;
        const icon = result.success ? '✓' : '✗';
        appendOutput(`\x1b[2m  ${icon} [${step + 1}/${maxSteps}] ${summary}\x1b[0m`);
      },
      onTextDelta: (delta: string) => {
        streamingText += delta;
        streamingTextComponent.setText(streamingText);
        tui.requestRender();
      },
    };

    try {
      const reply = await onMessage(trimmed, callbacks);
      // reply 可能为空（流式输出已通过 callback 显示）
      if (reply) {
        flushStreaming();
        appendOutput(reply);
      }
    } catch (e) {
      flushStreaming();
      appendOutput(`Error: ${(e as Error).message}`);
    } finally {
      // flush 剩余流式文本
      if (streamingText) {
        appendOutput(streamingText);
        streamingText = '';
      }
      streamingTextComponent.setText('');
      busy = false;
      tui.requestRender();
    }
  };

  tui.addChild(outputText);
  tui.addChild(streamingTextComponent);
  tui.addChild(input);
  tui.setFocus(input);
  tui.start();

  await exitPromise;
}
