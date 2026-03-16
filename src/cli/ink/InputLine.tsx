import { Text } from 'ink';
import { type FC } from 'react';

interface Props {
  prompt: string;
  buffer: string;
  cursorPos: number;
  active: boolean;
}

export const InputLine: FC<Props> = ({ prompt, buffer, cursorPos, active }) => {
  if (!active) return null;

  // 光标位置字符用反色显示
  const before = buffer.slice(0, cursorPos);
  const cursor = buffer[cursorPos] ?? ' ';
  const after = buffer.slice(cursorPos + 1);

  return (
    <Text>
      <Text color="green" bold>{prompt}</Text>
      <Text>{before}</Text>
      <Text inverse>{cursor}</Text>
      <Text>{after}</Text>
    </Text>
  );
};
