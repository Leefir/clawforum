/**
 * init command - Initialize clawforum workspace
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { saveGlobalConfig, isInitialized } from '../config.js';

export async function initCommand(): Promise<void> {
  // Check if already initialized
  if (isInitialized()) {
    console.log('✓ Already initialized (.clawforum/config.yaml exists)');
    return;
  }

  console.log('Initializing clawforum...\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt: string, defaultValue?: string): Promise<string> => {
    return new Promise((resolve) => {
      const fullPrompt = defaultValue
        ? `${prompt} (default: ${defaultValue}): `
        : `${prompt}: `;
      rl.question(fullPrompt, (answer) => {
        resolve(answer.trim() || defaultValue || '');
      });
    });
  };

  // Read a password with echo suppressed via raw mode
  const passwordQuestion = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      process.stdout.write(`${prompt}: `);
      const stdin = process.stdin;
      const wasRaw = stdin.isRaw;
      stdin.setRawMode?.(true);
      stdin.resume();

      let input = '';
      const onData = (char: Buffer) => {
        const c = char.toString();
        if (c === '\r' || c === '\n') {
          stdin.setRawMode?.(wasRaw ?? false);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(input);
        } else if (c === '\u0003') {
          // Ctrl+C
          stdin.setRawMode?.(wasRaw ?? false);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          process.exit(1);
        } else if (c === '\u007f' || c === '\b') {
          // Backspace
          if (input.length > 0) input = input.slice(0, -1);
        } else {
          input += c;
        }
      };
      stdin.on('data', onData);
    });
  };

  try {
    // Base URL (optional)
    const baseUrl = await question('Base URL (optional, press Enter for default)');

    // API Key (required)
    const apiKey = await passwordQuestion('API Key');
    if (!apiKey) {
      console.error('API Key is required');
      process.exit(1);
    }

    // Model (default provided)
    const model = await question('Model', 'claude-3-5-haiku-20241022');

    // Build config
    const config = {
      version: '1',
      llm: {
        primary: {
          name: 'anthropic',
          api_key: apiKey,
          model: model,
          max_tokens: 4096,
          temperature: 0.7,
          timeout_ms: 60000,
          ...(baseUrl && { base_url: baseUrl }),
        },
        retry_attempts: 3,
        retry_delay_ms: 1000,
      },
      tool_timeout_ms: 60000,
      watchdog: {
        interval_ms: 30000,
        disk_warning_mb: 500,
        log_archive_days: 30,
        claw_inactivity_timeout_ms: 300000,
      },
      motion: {
        heartbeat_interval_ms: 300000,
        max_steps: 100,
        max_concurrent_tasks: 3,
      },
    };

    // Save config
    saveGlobalConfig(config);

    // Create logs directory
    const logsDir = path.join(process.cwd(), '.clawforum', 'logs');
    fs.mkdirSync(logsDir, { recursive: true });

    console.log('\n✓ Initialized successfully!');
    console.log('  Config: .clawforum/config.yaml');
    console.log('  Logs:   .clawforum/logs/');
    console.log('\nNext steps:');
    console.log('  1. Create a Claw: clawforum claw create <name>');
    console.log('  2. Start chatting: clawforum claw chat <name>');

  } catch (error) {
    console.error('Init failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    rl.close();
  }
}
