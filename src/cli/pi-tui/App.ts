import type { ReplOptions, ReplCallbacks } from '../repl.js';
import { executeCommand, type CommandContext } from '../ink/commands.js';

type Phase = 'idle' | 'running' | 'paste_preview';

export async function runPiTui(options: ReplOptions): Promise<void> {
  const { TUI, Text, Input, ProcessTerminal, Key, matchesKey } = await import('@mariozechner/pi-tui');
  const { prompt, header, onMessage, onClose } = options;

  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal);

  // 输出区域（历史消息）
  const outputText = new Text(header + '\nType your message or "exit" to quit.\n');

  // 粘贴预览组件
  const pastePreviewText = new Text('');

  // 流式文本显示区域（当前正在接收的文本）
  const streamingTextComponent = new Text('');

  // 输入组件
  const input = new Input();

  // 状态
  let phase: Phase = 'idle';
  let pastedLines: string[] = [];
  let busy = false;

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

  // 显示粘贴预览
  const showPastePreview = () => {
    const preview = pastedLines.map((l, i) => `  ${i + 1} │ ${l}`).join('\n');
    const header = '\x1b[33m── Paste Preview (' + pastedLines.length + ' lines) ──\x1b[0m';
    const footer = '\x1b[2mEnter=confirm  q/Esc=cancel  e=edit\x1b[0m';
    pastePreviewText.setText(header + '\n' + preview + '\n' + footer);
    tui.requestRender();
  };

  // 处理粘贴
  const handlePaste = (text: string) => {
    const currentInput = input.getValue();
    const fullText = currentInput + text;
    input.setValue('');

    const lines = fullText.split(/\r\n|\r|\n/);
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
      lines.pop();
    }
    if (lines.length === 0) return;

    // 单行放回 Input 继续编辑
    if (lines.length === 1) {
      input.setValue(lines[0]);
      tui.requestRender();
      return;
    }

    // 多行进入预览模式
    pastedLines = lines;
    phase = 'paste_preview';
    showPastePreview();
  };

  // 粘贴处理变量
  let pasteBuffer = '';
  let isInPaste = false;

  // inputListener：拦截粘贴和预览模式按键
  tui.addInputListener((data: string) => {
    // 粘贴拦截
    if (data.includes('\x1b[200~')) {
      isInPaste = true;
      pasteBuffer = '';
      data = data.replace('\x1b[200~', '');
    }

    if (isInPaste) {
      const endIndex = data.indexOf('\x1b[201~');
      if (endIndex !== -1) {
        pasteBuffer += data.substring(0, endIndex);
        isInPaste = false;
        if (!busy) handlePaste(pasteBuffer);
        return { consume: true };
      }
      pasteBuffer += data;
      return { consume: true };
    }

    // 预览模式按键处理
    if (phase === 'paste_preview') {
      if (matchesKey(data, Key.enter)) {
        const text = pastedLines.join('\n').trim();
        pastedLines = [];
        phase = 'idle';
        pastePreviewText.setText('');
        if (text) input.onSubmit?.(text);
      } else if (matchesKey(data, Key.escape) || data === 'q') {
        pastedLines = [];
        phase = 'idle';
        pastePreviewText.setText('');
      } else if (data === 'e') {
        // TODO: 调用外部编辑器
        // 暂时取消预览
        pastedLines = [];
        phase = 'idle';
        pastePreviewText.setText('');
      }
      tui.requestRender();
      return { consume: true };
    }

    return undefined; // 不拦截
  });

  // 提交处理
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

    // 斜杠命令处理
    if (trimmed.startsWith('/')) {
      let shouldExit = false;
      const context: CommandContext = {
        clearOutput: () => { outputContent = ''; outputText.setText(outputContent); },
        exit: () => { shouldExit = true; },
        getPhase: () => phase,
      };
      const { handled, output } = executeCommand(trimmed, context);
      if (handled) {
        if (output) appendOutput(output);
        if (shouldExit) {
          await doExit();
          return;
        }
        input.setValue('');
        tui.requestRender();
        return;
      }
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
      await onMessage(trimmed, callbacks);
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
  tui.addChild(pastePreviewText);
  tui.addChild(streamingTextComponent);
  tui.addChild(input);
  tui.setFocus(input);
  tui.start();

  await exitPromise;
}
