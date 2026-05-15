import { describe, it, expect, vi } from 'vitest';
import { createTaskStatusBar, buildTaskLine, makeTaskTrack } from '../../src/cli/commands/chat-viewport-task-status-bar.js';

describe('chat-viewport-task-status-bar', () => {
  const makeDeps = () => {
    const updateRender = vi.fn();
    return { updateRender, bar: createTaskStatusBar({ updateRender }) };
  };

  it('addTrack(subagent) goes to spawn, not shadow', () => {
    const { bar } = makeDeps();
    bar.addTrack('task-abc', 'subagent');
    const spawn = bar.renderSpawn(80);
    const shadow = bar.renderShadow(80);
    expect(spawn).toContain('task-abc');
    expect(shadow).not.toContain('task-abc');
  });

  it('addTrack(shadow) goes to shadow, not spawn', () => {
    const { bar } = makeDeps();
    bar.addTrack('task-def', 'shadow');
    const spawn = bar.renderSpawn(80);
    const shadow = bar.renderShadow(80);
    expect(shadow).toContain('task-def');
    expect(spawn).not.toContain('task-def');
  });

  it('unshift order: newest at head (visual top)', () => {
    const { bar } = makeDeps();
    bar.addTrack('task-a', 'subagent');
    bar.addTrack('task-b', 'subagent');
    bar.addTrack('task-c', 'subagent');
    const spawn = bar.renderSpawn(80);
    const lines = spawn.split('\n');
    // head = newest = task-c
    expect(lines[0]).toContain('task-c');
    expect(lines[1]).toContain('task-b');
    expect(lines[2]).toContain('task-a');
  });

  it('updateTrack tool_call renders tool name', () => {
    const { bar } = makeDeps();
    bar.addTrack('task-x', 'subagent');
    bar.updateTrack('task-x', { type: 'tool_call', name: 'exec' });
    const spawn = bar.renderSpawn(80);
    expect(spawn).toContain('exec');
  });

  it('updateTrack text_delta renders buffered text', () => {
    const { bar } = makeDeps();
    bar.addTrack('task-y', 'subagent');
    bar.updateTrack('task-y', { type: 'text_delta', delta: 'hello' });
    const spawn = bar.renderSpawn(80);
    expect(spawn).toContain('hello');
  });

  it('updateTrack turn_end removes track immediately', () => {
    const { bar } = makeDeps();
    bar.addTrack('task-z', 'subagent');
    expect(bar.renderSpawn(80)).toContain('task-z');
    bar.updateTrack('task-z', { type: 'turn_end' });
    expect(bar.renderSpawn(80)).not.toContain('task-z');
    expect(bar.renderShadow(80)).not.toContain('task-z');
  });

  it('callerType=spawn maps to spawn tracks', () => {
    const { bar } = makeDeps();
    bar.addTrack('task-spawn', 'spawn');
    // slice(0,8) shortens 'task-spawn' to 'task-spa'
    expect(bar.renderSpawn(80)).toContain('task-spa');
    expect(bar.renderShadow(80)).not.toContain('task-spa');
  });

  it('hasAny reflects track presence', () => {
    const { bar } = makeDeps();
    expect(bar.hasAny()).toBe(false);
    bar.addTrack('task-1', 'subagent');
    expect(bar.hasAny()).toBe(true);
    bar.removeTrack('task-1');
    expect(bar.hasAny()).toBe(false);
  });
});

describe('buildTaskLine', () => {
  it('renders tool call with buffered thinking', () => {
    const t = makeTaskTrack('abc12345', 'subagent');
    t.currentTool = 'read_file';
    t.textBuffer = 'pondering';
    t.bufferType = 'thinking';
    const line = buildTaskLine(t, 80);
    expect(line).toContain('[abc12345]');
    expect(line).toContain('read_file');
    expect(line).toContain('(pondering)');
  });

  it('renders idle track with text buffer', () => {
    const t = makeTaskTrack('def67890', 'shadow');
    t.textBuffer = 'some output';
    t.bufferType = 'text';
    const line = buildTaskLine(t, 80);
    expect(line).toContain('def67890');
    expect(line).toContain('some output');
  });
});
