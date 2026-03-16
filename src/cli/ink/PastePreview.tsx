import { type FC } from 'react';
import { Text, Box } from 'ink';

interface Props {
  lines: string[];
}

const PREVIEW_MAX = 10;

export const PastePreview: FC<Props> = ({ lines }) => {
  const shown = lines.slice(0, PREVIEW_MAX);
  const editor = process.env.EDITOR || process.env.VISUAL || 'vi';

  return (
    <Box flexDirection="column">
      <Text color="cyan">粘贴内容（{lines.length} 行）：</Text>
      <Text>{'─'.repeat(50)}</Text>
      {shown.map((line, i) => (
        <Text key={i}>  {line}</Text>
      ))}
      {lines.length > PREVIEW_MAX && (
        <Text dimColor>  ... （还有 {lines.length - PREVIEW_MAX} 行）</Text>
      )}
      <Text>{'─'.repeat(50)}</Text>
      <Text dimColor>[Enter] 发送  [e] 用 {editor} 编辑  [q/Esc] 取消</Text>
    </Box>
  );
};
