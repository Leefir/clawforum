/**
 * init command - Initialize clawforum workspace
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { saveGlobalConfig, isInitialized } from '../config.js';
import { PRESETS } from '../../foundation/llm/presets.js';
import { DEFAULT_MAX_STEPS } from '../../constants.js';

const FORMAT_MAP: Record<string, string> = {
  '1': 'custom-anthropic',
  '2': 'custom-openai',
  '3': 'custom-gemini',
};

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
      muted = true;
    });
  };

  try {
    // Configure LLM API
    console.log('Configure LLM API:');
    console.log('  1. Scan environment variables');
    console.log('  2. Enter API key manually');
    console.log('  3. Select provider');
    const configMethod = await question('\n> ', '1');

    let presetId = '';
    let apiKey = '';
    let model = '';
    let baseUrl: string | undefined;

    if (configMethod === '1') {
      // ── Branch 1: scan env vars ──
      const detected = Object.values(PRESETS)
        .map(p => p.envVar)
        .filter((v): v is string => !!v && !!process.env[v])
        .filter((v, i, arr) => arr.indexOf(v) === i);

      let varName: string;
      if (detected.length > 0) {
        console.log('\nDetected:');
        detected.forEach((v, i) => console.log(`  ${i + 1}. ${v}`));
        const pick = await question('\n> (number or variable name)');
        const idx = parseInt(pick, 10) - 1;
        if (pick.trim() && idx >= 0 && idx < detected.length) {
          varName = detected[idx];
        } else if (/^[A-Z][A-Z0-9_]*$/.test(pick.trim())) {
          varName = pick.trim();
        } else {
          console.error('Invalid input. Enter a number or a variable name (e.g. MY_API_KEY).');
          process.exit(1);
        }
      } else {
        console.log('\n  No API key environment variables detected.');
        varName = await question('Variable name');
        if (!varName) { console.error('Variable name is required'); process.exit(1); }
      }

      apiKey = process.env[varName] ?? '';
      if (!apiKey) { console.error(`Environment variable ${varName} is not set`); process.exit(1); }
      console.log(`✓ API Key read from environment (${varName})`);

      const matchedEntry = Object.entries(PRESETS).find(([, p]) => p.envVar === varName);
      if (matchedEntry) {
        [presetId] = matchedEntry;
        const matchedPreset = matchedEntry[1];
        model = await question('Model', matchedPreset.defaultModel ?? 'unknown');
      } else {
        // Unknown var — ask format
        console.log('\nCould not determine provider. Select API format:');
        console.log('  1. Anthropic');
        console.log('  2. OpenAI');
        console.log('  3. Gemini');
        const fmt = await question('\n> ', '2');
        presetId = FORMAT_MAP[fmt] ?? 'custom-openai';
        baseUrl = await question('Base URL');
        if (!baseUrl) { console.error('Base URL is required'); process.exit(1); }
        model = await question('Model');
        if (!model) { console.error('Model is required'); process.exit(1); }
      }

    } else if (configMethod === '2') {
      // ── Branch 2: manual ──
      console.log('\nAPI Format:');
      console.log('  1. Anthropic');
      console.log('  2. OpenAI');
      console.log('  3. Gemini');
      const fmt = await question('\n> ', '2');
      presetId = FORMAT_MAP[fmt] ?? 'custom-openai';
      baseUrl = await question('Base URL');
      if (!baseUrl) { console.error('Base URL is required'); process.exit(1); }
      apiKey = await passwordQuestion('API Key');
      if (!apiKey) { console.error('API Key is required'); process.exit(1); }
      model = await question('Model');
      if (!model) { console.error('Model is required'); process.exit(1); }

    } else if (configMethod === '3') {
      // ── Branch 3: not yet implemented ──
      console.error('Provider selection is not yet implemented. Please use option 1 or 2.');
      process.exit(1);

    } else {
      console.error('Invalid selection');
      process.exit(1);
    }

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
        heartbeat_interval_ms: 0,
        max_steps: DEFAULT_MAX_STEPS,
        max_concurrent_tasks: 3,
        llm_idle_timeout_ms: 120000,
        retrospective_silent: false,
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
