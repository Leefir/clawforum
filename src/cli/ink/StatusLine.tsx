import { type FC, useState, useEffect } from 'react';
import { Text } from 'ink';

interface StatusItem {
  type: 'thinking' | 'tool_call' | 'tool_result';
  text: string;
}

interface Props {
  status: StatusItem | null;
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export const StatusLine: FC<Props> = ({ status }) => {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    // thinking 和 tool_call 都显示 spinner
    if (status?.type !== 'thinking' && status?.type !== 'tool_call') return;
    const timer = setInterval(() => {
      setFrame(f => (f + 1) % SPINNER_FRAMES.length);
    }, 80);
    return () => clearInterval(timer);
  }, [status?.type]);

  if (!status) return null;

  // thinking 和 tool_call 都显示 spinner
  if (status.type === 'thinking' || status.type === 'tool_call') {
    return <Text dimColor>{SPINNER_FRAMES[frame]} {status.text}</Text>;
  }

  // tool_result 静态显示
  return <Text dimColor>{status.text}</Text>;
};

// 导出类型供 App.tsx 使用
export type { StatusItem };
