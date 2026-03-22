/**
 * Chat Viewport - tail stream.jsonl 并渲染 TUI
 * motion 和 claw 共用
 */

import * as fsNative from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { writeInboxMessage } from '../../utils/inbox-writer.js';

export interface ChatViewportOptions {
  agentDir: string;   // motion dir 或 claw dir
  label: string;      // 显示名，如 'motion' 或 'claw-search'
  ensureDaemon?: () => Promise<void>;  // 调用方提供：检查 daemon 是否运行，没运行就启动
}

function writeUserChat(agentDir: string, message: string): void {
  const inboxDir = path.join(agentDir, 'inbox', 'pending');
  writeInboxMessage({
    inboxDir,
    type: 'user_chat',
    source: 'user',
    priority: 'high',
    body: message,
    idPrefix: 'chat',
  });
}

export async function runChatViewport(options: ChatViewportOptions): Promise<void> {
  // 确保 daemon 运行
  if (options.ensureDaemon) {
    await options.ensureDaemon();
  }

  const { TUI, Text, Input, Key, matchesKey, EditorKeybindingsManager, setEditorKeybindings } = await import('@mariozechner/pi-tui');
  const { ProcessTerminal } = await import('@mariozechner/pi-tui');

  // 移除 Ctrl+C 从 Input 的 selectCancel，让 TUI listener 处理
  setEditorKeybindings(new EditorKeybindingsManager({
    selectCancel: 'escape',  // 只绑 ESC
  }));

  const streamPath = path.join(options.agentDir, 'stream.jsonl');
  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal);

  // 单一输出区域（永久内容 + 流式后缀合并显示，消除组件间距）
  const outputText = new Text(`[${options.label}] Watching daemon activity...`, 0, 0);
  let outputContent = `[${options.label}] Watching daemon activity...`;
  let streamingSuffix = '';  // 当前流式内容（spinner / thinking / text）

  let streamingBuffer = '';
  let thinkingBuffer = '';
  let inTurn = false;  // daemon 是否正在处理 turn（用于 ESC 中断判断）

  // Braille spinner 动画
  const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let spinnerTimer: ReturnType<typeof setInterval> | null = null;

  const updateDisplay = () => {
    const full = streamingSuffix
      ? outputContent + '\n' + streamingSuffix
      : outputContent;
    outputText.setText(full);
    tui.requestRender();
  };

  const setStreamingSuffix = (text: string) => {
    streamingSuffix = text;
    updateDisplay();
  };

  const startSpinner = (text = 'Thinking...') => {
    stopSpinner();
    let frame = 0;
    spinnerTimer = setInterval(() => {
      streamingSuffix = `${SPINNER_FRAMES[frame % SPINNER_FRAMES.length]} ${text}`;
      updateDisplay();
      frame++;
    }, 80);
    // 立即显示第一帧
    setStreamingSuffix(`${SPINNER_FRAMES[0]} ${text}`);
  };

  const stopSpinner = () => {
    if (spinnerTimer) {
      clearInterval(spinnerTimer);
      spinnerTimer = null;
    }
  };

  // 输入组件
  const input = new Input();

  const appendOutput = (line: string) => {
    outputContent += '\n' + line;
    updateDisplay();
  };

  const flushStreaming = () => {
    if (streamingBuffer) {
      outputContent += '\n' + streamingBuffer;
      streamingBuffer = '';
      streamingSuffix = '';
      updateDisplay();
    }
  };

  const flushThinking = () => {
    if (thinkingBuffer) {
      outputContent += '\n\x1b[2m' + thinkingBuffer + '\x1b[0m';
      thinkingBuffer = '';
      updateDisplay();
    }
  };

  // 处理一个 stream event
  const handleEvent = (event: { type: string; [key: string]: unknown }) => {
    switch (event.type) {
      case 'turn_start': {
        inTurn = true;
        flushThinking();
        flushStreaming();
        const srcs = event.sources as Array<{ text: string; type: string }> | undefined;
        if (srcs && srcs.length > 0) {
          // 显示所有非 user_chat 的来源（系统消息、inbox 消息等）
          const sysParts = srcs.filter(s => s.type !== 'user_chat').map(s => s.text);
          if (sysParts.length > 0) {
            appendOutput(`\x1b[33m> ${sysParts.join(' | ').slice(0, 120)}\x1b[0m`);
          }
        }
        break;
      }

      case 'llm_start':
        inTurn = true;
        flushThinking();
        flushStreaming();
        startSpinner();
        break;

      case 'thinking_delta':
        stopSpinner();
        thinkingBuffer += event.delta as string;
        setStreamingSuffix('\x1b[2m' + thinkingBuffer + '\x1b[0m');
        break;

      case 'text_delta':
        stopSpinner();
        flushThinking();
        streamingBuffer += event.delta as string;
        setStreamingSuffix(streamingBuffer + '▋');
        break;

      case 'text_end':
        // no-op: keep cursor (▋) visible until tool_call/turn_end flushes
        break;

      case 'tool_call':
        stopSpinner();
        flushThinking();
        flushStreaming();
        appendOutput(`\x1b[36m→ ${event.name}\x1b[0m`);
        startSpinner(`${event.name}...`);
        break;

      case 'tool_result': {
        stopSpinner();
        const icon = event.success ? '✓' : '✗';
        const step = event.step ?? '?';
        const maxSteps = event.maxSteps ?? '?';
        appendOutput(`\x1b[2m  ${icon} [${step}/${maxSteps}] ${event.summary}\x1b[0m`);
        streamingSuffix = '';
        updateDisplay();
        break;
      }

      case 'turn_end':
        inTurn = false;
        stopSpinner();
        flushThinking();
        flushStreaming();
        streamingSuffix = '';
        updateDisplay();
        // Cursor disappearance signals completion; no extra separator needed
        break;

      case 'turn_interrupted':
        inTurn = false;
        stopSpinner();
        flushThinking();
        flushStreaming();
        streamingSuffix = '';
        updateDisplay();
        appendOutput('\x1b[33m⏎ Interrupted\x1b[0m');
        break;

      case 'turn_error':
        inTurn = false;
        stopSpinner();
        flushThinking();
        flushStreaming();
        streamingSuffix = '';
        updateDisplay();
        appendOutput(`\x1b[31m✗ Error: ${event.error}\x1b[0m`);
        break;

      case 'user_notify': {
        const sub = event.subtype as string;
        const subtaskId = event.subtaskId as string;
        if (sub === 'subtask_completed') {
          appendOutput(`\x1b[32m✓ [contract] ${subtaskId} accepted\x1b[0m`);
        } else if (sub === 'acceptance_failed') {
          const fb = (event.feedback as string) ?? '';
          appendOutput(`\x1b[33m⚠ [contract] ${subtaskId} rejected: ${fb}\x1b[0m`);
        }
        break;
      }
    }
  };

  // tail stream.jsonl
  let fileSize = 0;
  try {
    const stat = fsNative.statSync(streamPath);
    fileSize = stat.size;  // 从当前末尾开始（不 replay 历史）
  } catch (err: any) {
    if (err?.code !== 'ENOENT') {
      console.warn(`[chat] Failed to stat stream file: ${err?.message}`);
    }
    // ENOENT: 文件不存在，从 0 开始
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
          // 跳过无效行（可能是流截断产生的半行，正常现象）
          // 只在非空行时 warn，避免末尾空行误报
          if (line.trim().length > 2) {
            console.warn(`[chat] Failed to parse stream event: ${line.slice(0, 80)}`);
          }
        }
      }
    } catch {
      // 文件可能被截断（daemon 重启），重置
      fileSize = 0;
    }
  };

  // fs.watch + fallback 轮询
  let watcher: ReturnType<typeof fsNative.watch> | null = null;
  const pollInterval = setInterval(pollStream, 200);  // fallback 200ms

  try {
    watcher = fsNative.watch(streamPath, () => pollStream());
  } catch {
    // watch 失败，靠 pollInterval
  }

  // Daemon 存活检测（每 3 秒一次）
  let daemonDead = false;
  const pidFile = path.join(options.agentDir, 'status', 'pid');
  const checkDaemonAlive = () => {
    if (daemonDead) return;
    try {
      const pid = parseInt(fsNative.readFileSync(pidFile, 'utf-8').trim(), 10);
      if (isNaN(pid)) return;
      try {
        process.kill(pid, 0); // 检测存活
      } catch {
        // 进程不存在
        daemonDead = true;
        inTurn = false;
        stopSpinner();
        streamingSuffix = '';
        updateDisplay();
        appendOutput('\x1b[31m✗ Daemon 已停止\x1b[0m');
      }
    } catch {
      // PID 文件不存在或读取失败，忽略
    }
  };
  const daemonCheckInterval = setInterval(checkDaemonAlive, 3000);

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

    // 写入 inbox
    writeUserChat(options.agentDir, trimmed);
    tui.requestRender();
  };

  // Ctrl+C / Ctrl+D 退出
  let resolveExit: () => void;
  const exitPromise = new Promise<void>(r => { resolveExit = r; });

  tui.addInputListener((data: string) => {
    // Ctrl+C / Ctrl+D → 退出 viewport（优先检查，避免被 ESC 逻辑抢先）
    // 使用 includes 匹配批量输入（如 \x03\x03\x1b\x1b）
    if (data.includes('\x03') || data.includes('\x04')) {
      resolveExit();
      return { consume: true };
    }
    // ESC → 中断 daemon react（只在活跃 turn 时有效）
    // 快速连按时 data 可能是多个 \x1b，需检查是否包含 ESC 字节
    // 排除 CSI 序列（\x1b[ 开头的是方向键等）
    if (data.includes('\x1b') && !data.includes('\x1b[')) {
      if (!inTurn) {
        // 防御性清理：如果 spinner 还在转，强制停止
        stopSpinner();
        streamingSuffix = '';
        updateDisplay();
        return { consume: true };
      }
      const interruptFile = path.join(options.agentDir, 'interrupt');
      try {
        fsNative.writeFileSync(interruptFile, '');
      } catch { /* best-effort */ }
      startSpinner('Interrupting...');
      // 5 秒超时保护：如果 daemon 没响应，强制清理
      setTimeout(() => {
        if (inTurn) {
          inTurn = false;
          stopSpinner();
          streamingSuffix = '';
          updateDisplay();
        }
      }, 5000);
      return { consume: true };
    }
    return undefined;
  });

  tui.addChild(outputText);
  tui.addChild(input);
  tui.setFocus(input);
  tui.start();

  // 兜底：SIGINT 退出（终端未进 raw mode 时 Ctrl+C 转为 SIGINT）
  process.on('SIGINT', () => resolveExit());

  await exitPromise;

  // 清理
  stopSpinner();
  clearInterval(pollInterval);
  clearInterval(daemonCheckInterval);
  watcher?.close();
  tui.stop();
  await terminal.drainInput();
  process.stdin.pause();
}
