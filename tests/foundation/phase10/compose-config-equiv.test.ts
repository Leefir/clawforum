import { describe, it, expect } from 'vitest';
import { createClawGlobalConfigSchema, createClawConfigSchema } from '../../../src/foundation/config/schemas.js';
import { CONFIG_DEFAULTS } from '../../../src/assembly/config-defaults.js';
import { createGlobalConfigSchema, getClawConfigSchema } from '../../../src/assembly/compose-config.js';

describe('phase 10 composer ↔ legacy schemas equiv', () => {
  const legacyGlobal = createClawGlobalConfigSchema(CONFIG_DEFAULTS);
  const composedGlobal = createGlobalConfigSchema();
  const legacyClaw = createClawConfigSchema(CONFIG_DEFAULTS);
  const composedClaw = getClawConfigSchema();

  it('parses minimal global fixture equivalently', () => {
    const fixture = {
      llm: {
        primary: { api_key: 'KEY', preset: 'custom-anthropic' },
      },
    };
    const legacyResult = legacyGlobal.parse(fixture);
    const composedResult = composedGlobal.parse(fixture);
    expect(composedResult).toEqual(legacyResult);
  });

  it('parses full global fixture equivalently', () => {
    const fixture = {
      version: '2',
      default_max_steps: 50,
      llm: {
        primary: { api_key: 'KEY', preset: 'custom-anthropic', model: 'auto' },
        fallbacks: [],
        retry_attempts: 3,
        retry_delay_ms: 1000,
        circuit_breaker: { failure_threshold: 5, reset_timeout_ms: 120000 },
      },
      motion: { heartbeat_interval_ms: 5000, max_steps: 100, max_concurrent_tasks: 5, llm_idle_timeout_ms: 120000 },
      tool_timeout_ms: 30000,
      watchdog: { interval_ms: 10000, disk_warning_mb: 1000, claw_inactivity_timeout_ms: 600000 },
      cron: { enabled: true, tick_interval_ms: 2000, jobs: { disk_monitor: { enabled: true, schedule: 'hourly' } } },
      viewport: { show_recap_stream: true, show_system_messages: true, show_contract_events: false, trim_output_newlines: false },
      audit: { retention: { max_size_mb: 100 } },
      stream: { retention: { max_files: 10, max_days: 7 } },
      retention: { inbox_max_days: 14, outbox_max_days: 21, tasks_max_days: 30, dialog_max_days: 45 },
    };
    const legacyResult = legacyGlobal.parse(fixture);
    const composedResult = composedGlobal.parse(fixture);
    expect(composedResult).toEqual(legacyResult);
  });

  it('parses minimal claw fixture equivalently', () => {
    const fixture = { name: 'test-claw' };
    expect(composedClaw.parse(fixture)).toEqual(legacyClaw.parse(fixture));
  });

  it('parses claw with llm.primary equivalently', () => {
    const fixture = { name: 'test-claw', llm: { primary: { api_key: 'KEY2', preset: 'custom-anthropic' } } };
    expect(composedClaw.parse(fixture)).toEqual(legacyClaw.parse(fixture));
  });

  it('parses retention-only fixture equivalently', () => {
    const fixture = {
      llm: { primary: { api_key: 'KEY', preset: 'custom-anthropic' } },
      retention: { inbox_max_days: 7, outbox_max_days: 7, tasks_max_days: 7, dialog_max_days: 7 },
    };
    const legacyResult = legacyGlobal.parse(fixture);
    const composedResult = composedGlobal.parse(fixture);
    expect(composedResult).toEqual(legacyResult);
  });
});
