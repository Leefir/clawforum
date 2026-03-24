/**
 * init command - Initialize clawforum workspace
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { saveGlobalConfig, isInitialized } from '../config.js';
import { PRESETS } from '../../foundation/llm/presets.js';

export async function initCommand(silent = false): Promise<void> {
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

  // Read a password with echo suppressed
  const passwordQuestion = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      const fullPrompt = `${prompt}: `;
      let muted = false;
      // Suppress echo by intercepting _writeToOutput after the prompt is shown
      const original = (rl as any)._writeToOutput?.bind(rl);
      (rl as any)._writeToOutput = (str: string) => {
        if (!muted) original?.(str);
      };
      rl.question(fullPrompt, (answer) => {
        muted = false;
        (rl as any)._writeToOutput = original;
        process.stdout.write('\n');
        resolve(answer.trim());
      });
      muted = true; // start suppressing after prompt is queued
    });
  };

  try {
    // Select preset
    const presetEntries = Object.entries(PRESETS);
    console.log('Select provider:');
    const half = Math.ceil(presetEntries.length / 2);
    for (let i = 0; i < half; i++) {
      const [lid, lp] = presetEntries[i];
      const right = presetEntries[i + half];
      const leftStr = `${i + 1}. ${lid.padEnd(12)} (${lp.displayName})`;
      const rightStr = right ? `${i + half + 1}. ${right[0].padEnd(12)} (${right[1].displayName})` : '';
      console.log(`  ${leftStr.padEnd(32)}  ${rightStr}`);
    }
    const presetAnswer = await question('\n> ', '1');
    const presetIndex = parseInt(presetAnswer, 10) - 1;
    if (presetIndex < 0 || presetIndex >= presetEntries.length) {
      console.error('Invalid selection');
      process.exit(1);
    }
    const [presetId, preset] = presetEntries[presetIndex];

    // Base URL (only for custom presets without a default)
    let baseUrl: string | undefined;
    if (!preset.defaultBaseUrl) {
      baseUrl = await question('Base URL');
      if (!baseUrl) {
        console.error('Base URL is required for this provider');
        process.exit(1);
      }
    }

    // API Key (required)
    const apiKey = await passwordQuestion('API Key');
    if (!apiKey) {
      console.error('API Key is required');
      process.exit(1);
    }

    // Model (default from preset)
    const model = await question('Model', preset.defaultModel ?? 'unknown');

    // Build config
    const config = {
      version: '1',
      llm: {
        primary: {
          preset: presetId,
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
    if (!silent) {
      console.log('\nNext steps:');
      console.log('  1. Create a Claw: clawforum claw create <name>');
      console.log('  2. Start chatting: clawforum claw chat <name>');
    }

  } catch (error) {
    console.error('Init failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    rl.close();
  }
}
