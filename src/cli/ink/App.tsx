import { type FC, useState, useCallback } from 'react';
import { Text, Box, useApp, useInput } from 'ink';
import { useLineInput } from './useLineInput.js';
import { InputLine } from './InputLine.js';
import { StatusLine, type StatusItem } from './StatusLine.js';
import type { ReplOptions, ReplCallbacks } from '../repl.js';

type Phase = 'idle' | 'running';

interface AppProps {
  options: ReplOptions;
}

export const App: FC<AppProps> = ({ options }) => {
  const { prompt, header, onMessage, onClose, onInterrupt } = options;
  const { exit } = useApp();
  const [phase, setPhase] = useState<Phase>('idle');
  const [outputLines, setOutputLines] = useState<string[]>([]);
  const [status, setStatus] = useState<StatusItem | null>(null);
  const [streamingText, setStreamingText] = useState('');

  // 提交消息 → 进入 running 状态
  const handleSubmit = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    // exit/quit → 退出
    if (trimmed === 'exit' || trimmed === 'quit') {
      await onClose();
      exit();
      return;
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
      // 流式文本在 streamingText 中实时累积，不再单独处理 response
    } finally {
      // 将流式文本转为历史输出（如果中断，已显示的文本也保留）
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

  // 粘贴暂时直接合并为单条消息发送（Step 7 实现预览）
  const handlePaste = useCallback((lines: string[]) => {
    const joined = lines.join('\n').trim();
    if (joined) handleSubmit(joined);
  }, [handleSubmit]);

  const { buffer, cursorPos } = useLineInput({
    onSubmit: handleSubmit,
    onPaste: handlePaste,
    enabled: phase === 'idle',
  });

  // running 状态下 Esc 中断
  useInput((_input, key) => {
    if (key.escape && phase === 'running') {
      onInterrupt?.();
      setOutputLines(prev => [...prev, '\x1b[33m[interrupted]\x1b[0m']);
    }
  }, { isActive: phase === 'running' });

  return (
    <Box flexDirection="column">
      {/* Header（首次显示） */}
      <Text>{header}</Text>
      <Text dimColor>Type your message or "exit" to quit.</Text>
      <Text>{''}</Text>

      {/* 历史输出 */}
      {outputLines.map((line, i) => (
        <Text key={i}>{line}</Text>
      ))}

      {/* 流式文本（LLM 正在生成） */}
      {streamingText && <Text>{streamingText}</Text>}

      {/* 状态行 */}
      <StatusLine status={status} />

      {/* 输入行 */}
      <InputLine prompt={prompt} buffer={buffer} cursorPos={cursorPos} active={phase === 'idle'} />
    </Box>
  );
};
