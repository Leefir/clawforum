/**
 * resolvePreset() tests — Phase 20 preset system
 */
import { describe, it, expect } from 'vitest';
import { resolvePreset } from '../../src/foundation/llm/presets.js';

describe('resolvePreset', () => {
  it('should return anthropic preset with apiFormat=anthropic and defaultBaseUrl', () => {
    const preset = resolvePreset('anthropic');
    expect(preset.apiFormat).toBe('anthropic');
    expect(preset.defaultBaseUrl).toBe('https://api.anthropic.com');
    expect(preset.defaultModel).toBeTruthy();
  });

  it('should return deepseek preset with apiFormat=openai', () => {
    const preset = resolvePreset('deepseek');
    expect(preset.apiFormat).toBe('openai');
    expect(preset.defaultBaseUrl).toContain('deepseek');
  });

  it('should return minimax preset with apiFormat=anthropic (MiniMax uses Anthropic-compatible API)', () => {
    const preset = resolvePreset('minimax');
    expect(preset.apiFormat).toBe('anthropic');
    expect(preset.defaultModel).toBe('MiniMax-M1');
  });

  it('should return custom-openai with apiFormat=openai and no defaultBaseUrl', () => {
    const preset = resolvePreset('custom-openai');
    expect(preset.apiFormat).toBe('openai');
    expect(preset.defaultBaseUrl).toBeUndefined();
  });

  it('should return custom-anthropic with apiFormat=anthropic and no defaultBaseUrl', () => {
    const preset = resolvePreset('custom-anthropic');
    expect(preset.apiFormat).toBe('anthropic');
    expect(preset.defaultBaseUrl).toBeUndefined();
  });

  it('should throw for unknown preset ID with available list in message', () => {
    expect(() => resolvePreset('nonexistent-provider')).toThrow(/Unknown provider preset/);
    // Error message includes available presets
    expect(() => resolvePreset('nonexistent-provider')).toThrow(/anthropic/);
    expect(() => resolvePreset('nonexistent-provider')).toThrow(/openai/);
  });
});
