import { type FC, useState, useCallback } from 'react';
import { Text, Box, useApp, useInput, useStdin } from 'ink';
import { useLineInput } from './useLineInput.js';
import { InputLine } from './InputLine.js';
import { StatusLine, type StatusItem } from './StatusLine.js';
import { PastePreview } from './PastePreview.js';
import { editWithEditor } from './editor.js';
import { executeCommand, type CommandContext } from './commands.js';
import type { ReplOptions, ReplCallbacks } from '../repl.js';

type Phase = 'idle' | 'running' | 'paste_preview';

interface AppProps {
  options: ReplOptions;
}

export const App: FC<AppProps> = ({ options }) => {
  const { prompt, header, onMessage, onClose, onInterrupt } = options;
  const { exit } = useApp();
  const { setRawMode } = useStdin();
  const [phase, setPhase] = useState<Phase>('idle');
  const [outputLines, setOutputLines] = useState<string[]>([]);
  const [status, setStatus] = useState<StatusItem | null>(null);
  const [streamingText, setStreamingText] = useState('');
  const [pastedLines, setPastedLines] = useState<string[]>([]);

  // 提交消息 → 进入 running 状态
  const handleSubmit = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    // exit/quit → 退出（保留兼容）
    if (trimmed === 'exit' || trimmed === 'quit') {
      await onClose();
      exit();
      return;
    }

    // 斜杠命令
    if (trimmed.startsWith('/')) {
      const context: CommandContext = {
        clearOutput: () => setOutputLines([]),
        exit: () => { onClose().then(() => exit()); },
      };
      const { handled, output } = executeCommand(trimmed, context);
      if (handled) {
        if (output) setOutputLines(prev => [...prev, output]);
        return;
      }
    }

    setPhase('running');
    setStatus({ type: 'thinking', text: 'Thinking...' });
    setStreamingText('');

    const callbacks: ReplCallbacks = {
      onBeforeLLMCall: () => {
        setStatus({ type: 'thinking', text: 'Thinking...' });
      },
      onToolCall: (name: string) => {
        setStatus({ type: 'tool_call', text: `→ Tool: ${name}` });
      },
      onToolResult: (name: string, result: { success: boolean; content: string }, step: number, maxSteps: number) => {
        const summary = result.content.length > 80
          ? result.content.slice(0, 80) + '...'
          : result.content;
        const icon = result.success ? '✓' : '✗';
        setStatus({ type: 'tool_result', text: `  ${icon} [${step + 1}/${maxSteps}] ${summary}` });
      },
      onTextDelta: (delta: string) => {
        setStreamingText(prev => prev + delta);
      },
    };

    try {
      await onMessage(trimmed, callbacks);
    } finally {
      setStreamingText(st => {
        if (st) {
          setOutputLines(prev => [...prev, st]);
        }
        return '';
      });
      setStatus(null);
      setPhase('idle');
    }
  }, [onMessage, onClose, exit]);

  // 粘贴处理：进入预览模式
  const handlePaste = useCallback((lines: string[]) => {
    const trimmed = [...lines];
    while (trimmed.length > 0 && trimmed[trimmed.length - 1].trim() === '') {
      trimmed.pop();
    }
    if (trimmed.length === 0) return;
    if (trimmed.length === 1) {
      handleSubmit(trimmed[0]);
      return;
    }
    setPastedLines(trimmed);
    setPhase('paste_preview');
  }, [handleSubmit]);

  const { buffer, cursorPos } = useLineInput({
    onSubmit: handleSubmit,
    onPaste: handlePaste,
    enabled: phase === 'idle',
  });

  // 全局按键处理：Esc 中断、Ctrl+C
  useInput((input, key) => {
    // Ctrl+C
    if (key.ctrl && input === 'c') {
      if (phase === 'running') {
        onInterrupt?.();
        setOutputLines(prev => [...prev, '\x1b[33m[interrupted]\x1b[0m']);
      } else {
        onClose().then(() => exit());
      }
      return;
    }

    // Esc 中断 running
    if (key.escape && phase === 'running') {
      onInterrupt?.();
      setOutputLines(prev => [...prev, '\x1b[33m[interrupted]\x1b[0m']);
    }
  });

  // paste_preview 状态下按键处理
  useInput((input, key) => {
    if (phase !== 'paste_preview') return;

    if (key.return) {
      const text = pastedLines.join('\n').trim();
      setPastedLines([]);
      setPhase('idle');
      if (text) handleSubmit(text);
    } else if (input === 'e') {
      setRawMode(false);
      const edited = editWithEditor(pastedLines);
      setRawMode(true);
      setPastedLines(edited);
    } else if (input === 'q' || key.escape) {
      setPastedLines([]);
      setPhase('idle');
    }
  }, { isActive: phase === 'paste_preview' });

  return (
    <Box flexDirection="column">
      <Text>{header}</Text>
      <Text dimColor>Type your message or "exit" to quit.</Text>
      <Text>{''}</Text>

      {outputLines.map((line, i) => (
        <Text key={i}>{line}</Text>
      ))}

      {streamingText && <Text>{streamingText}</Text>}

      {phase === 'paste_preview' && <PastePreview lines={pastedLines} />}

      <StatusLine status={status} />

      <InputLine prompt={prompt} buffer={buffer} cursorPos={cursorPos} active={phase === 'idle'} />
    </Box>
  );
};
