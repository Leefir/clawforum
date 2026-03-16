export interface SlashCommand {
  name: string;
  description: string;
  execute: (args: string, context: CommandContext) => string | null;
  // 返回 string → 显示输出；null → 无输出
}

export interface CommandContext {
  clearOutput: () => void;
  exit: () => void;
  getPhase: () => string;
}

// 内置命令
const builtinCommands: SlashCommand[] = [
  {
    name: 'help',
    description: '显示可用命令',
    execute: (_args, _ctx) => {
      return allCommands
        .map(c => `  /${c.name} — ${c.description}`)
        .join('\n');
    },
  },
  {
    name: 'clear',
    description: '清屏',
    execute: (_args, ctx) => {
      ctx.clearOutput();
      return null;
    },
  },
  {
    name: 'exit',
    description: '退出',
    execute: (_args, ctx) => {
      ctx.exit();
      return null;
    },
  },
  {
    name: 'status',
    description: '显示当前状态',
    execute: (_args, ctx) => {
      return `状态：${ctx.getPhase()}`;
    },
  },
];

let allCommands = [...builtinCommands];

export function registerCommand(cmd: SlashCommand): void {
  allCommands.push(cmd);
}

export function executeCommand(input: string, context: CommandContext): { handled: boolean; output: string | null } {
  const match = input.match(/^\/(\S+)\s*(.*)/);
  if (!match) return { handled: false, output: null };

  const [, name, args] = match;
  const cmd = allCommands.find(c => c.name === name);
  if (!cmd) {
    return { handled: true, output: `未知命令: /${name}。输入 /help 查看可用命令。` };
  }

  return { handled: true, output: cmd.execute(args, context) };
}
