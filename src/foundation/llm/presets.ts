/**
 * Provider Preset System
 * Defines known providers and their configurations
 */

export type ApiFormat = 'anthropic' | 'openai';
export type AuthMethod = 'api_key' | 'oauth' | 'aws_credentials';

export interface ProviderPreset {
  id: string;
  displayName: string;
  apiFormat: ApiFormat;
  authMethod: AuthMethod;
  defaultBaseUrl?: string;
  defaultModel?: string;
}

export const PRESETS: Record<string, ProviderPreset> = {
  'anthropic': {
    id: 'anthropic',
    displayName: 'Anthropic',
    apiFormat: 'anthropic',
    authMethod: 'api_key',
    defaultBaseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-3-7-sonnet-20250219',
  },
  'openai': {
    id: 'openai',
    displayName: 'OpenAI',
    apiFormat: 'openai',
    authMethod: 'api_key',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
  },
  'deepseek': {
    id: 'deepseek',
    displayName: 'DeepSeek',
    apiFormat: 'openai',
    authMethod: 'api_key',
    defaultBaseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
  },
  'moonshot': {
    id: 'moonshot',
    displayName: 'Moonshot AI',
    apiFormat: 'openai',
    authMethod: 'api_key',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
  },
  'minimax': {
    id: 'minimax',
    displayName: 'MiniMax',
    apiFormat: 'anthropic',
    authMethod: 'api_key',
    defaultBaseUrl: 'https://api.minimax.io/anthropic',
    defaultModel: 'claude-3-7-sonnet-20250219',
  },
  'ollama': {
    id: 'ollama',
    displayName: 'Ollama',
    apiFormat: 'openai',
    authMethod: 'api_key',
    defaultBaseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3.1',
  },
  'custom-anthropic': {
    id: 'custom-anthropic',
    displayName: 'Custom (Anthropic Format)',
    apiFormat: 'anthropic',
    authMethod: 'api_key',
  },
  'custom-openai': {
    id: 'custom-openai',
    displayName: 'Custom (OpenAI Format)',
    apiFormat: 'openai',
    authMethod: 'api_key',
  },
};

export function resolvePreset(id: string): ProviderPreset {
  const preset = PRESETS[id];
  if (!preset) {
    const available = Object.keys(PRESETS).join(', ');
    throw new Error(
      `Unknown provider preset "${id}". Available presets: ${available}`
    );
  }
  return preset;
}
