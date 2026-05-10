/**
 * OpenAI request shape mappers — pure functions
 * 抽自 openai.ts (phase 630 / 形态 A.3 functional)
 * 0 this.X dep / 真 pure function
 */

import type { Message } from '../../types/message.js';

interface OpenAIMessage {
  role: string;
  content: string;
  tool_calls?: unknown[];
  tool_call_id?: string;
}

interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: unknown;
  };
}

/**
 * Convert internal Message[] + system prompt → OpenAI messages array
 */
export function formatMessages(
  messages: Array<{ role: string; content: unknown }>,
  system?: string,
): OpenAIMessage[] {
  const result: OpenAIMessage[] = [];

  // System message as first message
  if (system) {
    result.push({ role: 'system', content: system });
  }

  for (const m of messages) {
    const role = m.role;

    // Handle array content (tool_use, tool_result blocks)
    if (Array.isArray(m.content)) {
      const blocks = m.content as Array<Record<string, unknown>>;

      // Check for tool_use blocks (assistant)
      if (role === 'assistant') {
        const toolUses = blocks.filter(b => b.type === 'tool_use');
        if (toolUses.length > 0) {
          const textBlocks = blocks.filter(b => b.type === 'text') as Array<{ text?: string }>;
          const text = textBlocks.map(b => b.text || '').join('');

          result.push({
            role: 'assistant',
            content: text || '',
            tool_calls: toolUses.map(tu => ({
              id: tu.id as string,
              type: 'function',
              function: {
                name: tu.name as string,
                arguments: JSON.stringify(tu.input || {}),
              },
            })),
          });
          continue;
        }
      }

      // Check for tool_result blocks (user/tool)
      const toolResults = blocks.filter(b => b.type === 'tool_result');
      for (const tr of toolResults) {
        result.push({
          role: 'tool',
          content: typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content),
          tool_call_id: tr.tool_use_id as string,
        });
      }

      // Regular text blocks
      const textBlocks = blocks.filter(b => b.type === 'text') as Array<{ text?: string }>;
      const text = textBlocks.map(b => b.text || '').join('');
      if (text || toolResults.length === 0) {
        result.push({ role: role === 'assistant' ? 'assistant' : 'user', content: text || '' });
      }
    } else {
      // String content
      result.push({
        role: role === 'assistant' ? 'assistant' : 'user',
        content: m.content as string,
      });
    }
  }

  return result;
}

/**
 * Convert tool definitions → OpenAI tools array
 */
export function formatTools(
  tools: Array<{ name: string; description: string; input_schema: unknown }>,
): OpenAITool[] {
  return tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}
