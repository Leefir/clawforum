import type { ITool, ToolResult, ToolPermissions } from '../executor.js';
import type { ILLMService } from '../../../foundation/llm/index.js';
import type { Message } from '../../../types/message.js';

export class AskMotionTool implements ITool {
  readonly name = 'ask_motion';
  readonly description = `向 Motion 分身提问，获取 Motion 对用户意图、背景、偏好的判断。
分身继承 Motion 完整上下文（系统提示 + 当前对话历史），多轮问答自动累积。
适用场景：用户意图模糊、不确定目标 claw、需确认优先级或约束等。`;
  readonly requiredPermissions: (keyof ToolPermissions)[] = [];
  readonly readonly = true;
  readonly idempotent = false;

  readonly schema = {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: '向 Motion 分身提出的问题',
      },
    },
    required: ['question'],
  };

  private readonly cloneHistory: Message[] = [];

  constructor(
    private readonly llm: ILLMService,
    private readonly systemPrompt: string,
    private readonly motionContext: Message[],  // motion 当前对话快照（只读）
  ) {}

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const question = args.question as string;

    this.cloneHistory.push({ role: 'user', content: question });

    let answer: string;
    try {
      const response = await this.llm.call({
        system: this.systemPrompt,
        messages: [...this.motionContext, ...this.cloneHistory],
      });
      answer = response.content
        .filter(b => b.type === 'text')
        .map(b => (b as { type: 'text'; text: string }).text)
        .join('');
    } catch (err) {
      // 出错时从 history 移除刚追加的问题，避免 history 损坏
      this.cloneHistory.pop();
      return {
        success: false,
        content: `Motion 分身调用失败：${err instanceof Error ? err.message : String(err)}`,
      };
    }

    this.cloneHistory.push({ role: 'assistant', content: answer });
    return { success: true, content: answer };
  }
}
