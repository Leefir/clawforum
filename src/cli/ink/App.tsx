import { type FC, useState, useCallback } from 'react';
import { Text, Box } from 'ink';
import { useLineInput } from './useLineInput.js';
import { InputLine } from './InputLine.js';

interface AppProps {
  prompt?: string;
}

export const App: FC<AppProps> = ({ prompt = '> ' }) => {
  const [output, setOutput] = useState<string[]>([]);

  const onSubmit = useCallback((text: string) => {
    setOutput(prev => [...prev, `[submit] ${text}`]);
  }, []);

  const onPaste = useCallback((lines: string[]) => {
    setOutput(prev => [...prev, `[paste] ${lines.length} lines`]);
  }, []);

  const { buffer, cursorPos } = useLineInput({
    onSubmit,
    onPaste,
    enabled: true,
  });

  return (
    <Box flexDirection="column">
      {output.map((line, i) => (
        <Text key={i}>{line}</Text>
      ))}
      <InputLine prompt={prompt} buffer={buffer} cursorPos={cursorPos} active={true} />
    </Box>
  );
};
