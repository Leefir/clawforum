/**
 * Chat Viewport - tail stream.jsonl 并渲染 TUI
 * motion 和 claw 共用
 */

import * as fsNative from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

export interface ChatViewportOptions {
  agentDir: string;   // motion dir 或 claw dir
  label: string;      // 显示名，如 'motion' 或 'claw-search'
  ensureDaemon?: () => Promise<void>;  // 调用方提供：检查 daemon 是否运行，没运行就启动
}

function writeUserChat(agentDir: string, message: string): void {
  const inboxDir = path.join(agentDir, 'inbox', 'pending');
  fsNative.mkdirSync(inboxDir, { recursive: true });

  const now = new Date();
  const ts = now.toISOString().replace(/[-:]/g, '').slice(0, 15);
  const uuid8 = randomUUID().slice(0, 8);
  const filename = `${ts}_user_chat_${uuid8}.md`;

  const content = `---
id: chat-${now.getTime()}-${uuid8}
type: user_chat
source: user
priority: high
timestamp: ${now.toISOString()}
---

${message}
`;

  fsNative.writeFileSync(path.join(inboxDir, filename), content);
}

export async function runChatViewport(options: ChatViewportOptions): Promise<void> {
  // 确保 daemon 运行
  if (options.ensureDaemon) {
    await options.ensureDaemon();
  }

  const { TUI, Text, Input, Key, matchesKey } = await import('@mariozechner/pi-tui');
  const { ProcessTerminal } = await import('@mariozechner/pi-tui');

  const streamPath = path.join(options.agentDir, 'stream.jsonl');
  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal);

  // 输出区域
  const outputText = new Text(`[${options.label}] Watching daemon activity...\n`);
  let outputContent = `[${options.label}] Watching daemon activity...\n`;

  // 流式文本（当前正在接收的增量）
  const streamingText = new Text('');
  let streamingBuffer = '';
  let thinkingBuffer = '';

  // 输入组件
  const input = new Input();

  const appendOutput = (line: string) => {
    outputContent += '\n' + line;
    outputText.setText(outputContent);
    tui.requestRender();
  };

  const flushStreaming = () => {
    if (streamingBuffer) {
      appendOutput(streamingBuffer);
      streamingBuffer = '';
      streamingText.setText('');
    }
  };

  const flushThinking = () => {
    if (thinkingBuffer) {
      appendOutput('\x1b[2m💭 ' + thinkingBuffer + '\x1b[0m');
      thinkingBuffer = '';
    }
  };

  // 处理一个 stream event
  const handleEvent = (event: { type: string; [key: string]: unknown }) => {
    switch (event.type) {
      case 'turn_start':
        flushThinking();
        flushStreaming();
        if (event.source) {
          appendOutput(`\x1b[33m── ${event.source} ──\x1b[0m`);
        }
        break;

      case 'llm_start':
        flushThinking();
        flushStreaming();
        streamingText.setText('⏳ Thinking...');
        tui.requestRender();
        break;

      case 'thinking_delta':
        thinkingBuffer += event.delta as string;
        streamingText.setText('\x1b[2m💭 ' + thinkingBuffer + '\x1b[0m');
        tui.requestRender();
        break;

      case 'text_delta':
        flushThinking();
        streamingBuffer += event.delta as string;
        streamingText.setText(streamingBuffer);
        tui.requestRender();
        break;

      case 'tool_call':
        flushThinking();
        flushStreaming();
        streamingText.setText(`→ ${event.name}...`);
        tui.requestRender();
        appendOutput(`\x1b[36m→ ${event.name}\x1b[0m`);
        break;

      case 'tool_result': {
        const icon = event.success ? '✓' : '✗';
        const step = event.step ?? '?';
        const maxSteps = event.maxSteps ?? '?';
        appendOutput(`\x1b[2m  ${icon} [${step}/${maxSteps}] ${event.summary}\x1b[0m`);
        streamingText.setText('');
        tui.requestRender();
        break;
      }

      case 'turn_end':
        flushThinking();
        flushStreaming();
        break;
    }
  };

  // tail stream.jsonl
  let fileSize = 0;
  try {
    const stat = fsNative.statSync(streamPath);
    fileSize = stat.size;  // 从当前末尾开始（不 replay 历史）
  } catch {
    // 文件不存在，从 0 开始
  }

  const pollStream = () => {
    try {
      const stat = fsNative.statSync(streamPath);
      if (stat.size <= fileSize) return;

      const buf = Buffer.alloc(stat.size - fileSize);
      const fd = fsNative.openSync(streamPath, 'r');
      fsNative.readSync(fd, buf, 0, buf.length, fileSize);
      fsNative.closeSync(fd);
      fileSize = stat.size;

      const lines = buf.toString('utf-8').split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          handleEvent(event);
        } catch {
          // 跳过无效行
        }
      }
    } catch {
      // 文件可能被截断（daemon 重启），重置
      fileSize = 0;
    }
  };

  // fs.watch + fallback 轮询
  let watcher: ReturnType<typeof fsNative.watch> | null = null;
  const pollInterval = setInterval(pollStream, 1000);  // fallback 1s

  try {
    watcher = fsNative.watch(streamPath, () => pollStream());
  } catch {
    // watch 失败，靠 pollInterval
  }

  // 输入提交处理
  input.onSubmit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      input.setValue('');
      tui.requestRender();
      return;
    }

    if (trimmed === 'exit' || trimmed === 'quit') {
      resolveExit();
      return;
    }

    // 显示用户消息
    appendOutput(`\x1b[32m> ${trimmed}\x1b[0m`);
    input.setValue('');
    tui.requestRender();

    // 写入 inbox
    writeUserChat(options.agentDir, trimmed);
  };

  // Ctrl+C / Ctrl+D 退出
  let resolveExit: () => void;
  const exitPromise = new Promise<void>(r => { resolveExit = r; });

  tui.addInputListener((data: string) => {
    if (matchesKey(data, Key.ctrl('c')) || matchesKey(data, Key.ctrl('d'))) {
      resolveExit();
      return { consume: true };
    }
    return undefined;
  });

  tui.addChild(outputText);
  tui.addChild(streamingText);
  tui.addChild(input);
  tui.setFocus(input);
  tui.start();

  await exitPromise;

  // 清理
  clearInterval(pollInterval);
  watcher?.close();
  tui.stop();
  await terminal.drainInput();
  process.stdin.pause();
}
