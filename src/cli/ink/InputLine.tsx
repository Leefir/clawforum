import { Text } from 'ink';
import { type FC } from 'react';

interface Props {
  prompt: string;
  buffer: string;
  cursorPos: number;
  active: boolean;
}

export const InputLine: FC<Props> = ({ prompt, buffer, cursorPos, active }) => {
  if (!active) {
    // 非 idle：只显示 prompt，无光标块
    return <Text><Text color="green" bold>{prompt}</Text></Text>;
  }

  // 光标位置字符用反色显示（Unicode-aware，处理 surrogate pair）
  const before = buffer.slice(0, cursorPos);
  const codePoint = buffer.codePointAt(cursorPos);
  const cursor = codePoint !== undefined ? String.fromCodePoint(codePoint) : ' ';
  const after = buffer.slice(cursorPos + cursor.length);

  return (
    <Text>
      <Text color="green" bold>{prompt}</Text>
      <Text>{before}</Text>
      <Text inverse>{cursor}</Text>
      <Text>{after}</Text>
    </Text>
  );
};
