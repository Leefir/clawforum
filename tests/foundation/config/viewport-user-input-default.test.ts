import { describe, it, expect } from 'vitest';
import { viewportConfigSchema } from '../../../src/cli/commands/chat-viewport/config-schema.js';
import { EXEC_MAX_OUTPUT } from '../../../src/foundation/command-tool/constants.js';

describe('viewportConfigSchema user_input_inline_max_chars (phase 142)', () => {
  it('default value aligns with EXEC_MAX_OUTPUT', () => {
    const config = viewportConfigSchema.parse({});
    expect(config.user_input_inline_max_chars).toBe(EXEC_MAX_OUTPUT);
    expect(config.user_input_inline_max_chars).toBe(2000);
  });

  it('accepts positive integer override', () => {
    expect(viewportConfigSchema.parse({ user_input_inline_max_chars: 1 }).user_input_inline_max_chars).toBe(1);
    expect(viewportConfigSchema.parse({ user_input_inline_max_chars: 100000 }).user_input_inline_max_chars).toBe(100000);
  });

  it('rejects non-positive or non-integer', () => {
    expect(() => viewportConfigSchema.parse({ user_input_inline_max_chars: 0 })).toThrow();
    expect(() => viewportConfigSchema.parse({ user_input_inline_max_chars: -1 })).toThrow();
    expect(() => viewportConfigSchema.parse({ user_input_inline_max_chars: 1.5 })).toThrow();
  });
});
