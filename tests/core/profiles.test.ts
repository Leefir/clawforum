/**
 * Tool profiles tests
 */
import { describe, it, expect } from 'vitest';
import { isToolAllowed, TOOL_PROFILES } from '../../src/core/tools/profiles.js';

describe('Tool Profiles', () => {
  describe('isToolAllowed', () => {
    it('should return true for dispatch in full profile', () => {
      expect(isToolAllowed('dispatch', 'full')).toBe(true);
    });

    it('should return false for tools not in full profile', () => {
      expect(isToolAllowed('unknown_tool', 'full')).toBe(false);
      expect(isToolAllowed('nonexistent', 'full')).toBe(false);
    });

    it('should return correct values for all profiles', () => {
      // Full profile should have dispatch
      expect(TOOL_PROFILES.full).toContain('dispatch');
      expect(TOOL_PROFILES.full).toContain('spawn');
      expect(TOOL_PROFILES.full).toContain('skill');

      // Readonly profile should not have write/spawn
      expect(TOOL_PROFILES.readonly).not.toContain('write');
      expect(TOOL_PROFILES.readonly).not.toContain('spawn');

      // Subagent profile should not have spawn
      expect(TOOL_PROFILES.subagent).not.toContain('spawn');
      expect(TOOL_PROFILES.subagent).not.toContain('send');

      // Dream profile should be read-only
      expect(TOOL_PROFILES.dream).not.toContain('write');
      expect(TOOL_PROFILES.dream).not.toContain('spawn');
    });
  });
});
