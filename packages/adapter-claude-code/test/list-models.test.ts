/**
 * `listClaudeCodeModels` — a real, small static table (neither transport exposes a "list available
 * models" call of its own).
 *
 * @see specs/07 §7.2
 * @see PLAN-M7.md P4
 */
import { describe, expect, it } from 'vitest';

import { MODEL_TIER_NAMES } from '@forge/adapter-kit';

import { defaultClaudeCodeTierModels, listClaudeCodeModels } from '../src/list-models.ts';

describe('listClaudeCodeModels', () => {
  it('returns a non-empty, real, static table', () => {
    const models = listClaudeCodeModels();
    expect(models.length).toBeGreaterThan(0);
  });

  it('every model has a non-empty id and displayName, and no id repeats', () => {
    const models = listClaudeCodeModels();
    const ids = new Set<string>();
    for (const model of models) {
      expect(model.id.length).toBeGreaterThan(0);
      expect(model.displayName.length).toBeGreaterThan(0);
      expect(ids.has(model.id)).toBe(false);
      ids.add(model.id);
    }
  });

  it("includes both the short aliases and the full model ids this milestone's own live captures confirmed", () => {
    const ids = listClaudeCodeModels().map((model) => model.id);
    expect(ids).toContain('sonnet');
    expect(ids).toContain('claude-sonnet-5');
    // The two model ids this milestone's own real, live NDJSON captures actually reported in a
    // `system/init` event (fable via a non-bare/subscription call, haiku via a bare/API-key call) --
    // not merely names this piece assumes exist.
    expect(ids).toContain('claude-fable-5-1');
    expect(ids).toContain('claude-haiku-4-5-20251001');
  });

  it('returns a fresh array each call (never a shared mutable reference a caller could corrupt)', () => {
    const first = listClaudeCodeModels();
    const second = listClaudeCodeModels();
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });
});

describe('defaultClaudeCodeTierModels', () => {
  it('names a model for every FORGE tier', () => {
    const map = defaultClaudeCodeTierModels();
    for (const tier of MODEL_TIER_NAMES) {
      expect(map[tier], tier).toEqual(expect.any(String));
    }
  });

  it('only ever names models the adapter itself lists (init refuses anything else)', () => {
    const listed = new Set(listClaudeCodeModels().map((model) => model.id));
    for (const id of Object.values(defaultClaudeCodeTierModels())) {
      expect(listed.has(id)).toBe(true);
    }
  });

  it('maps the tiers to three distinct models, in ascending capability order', () => {
    const { frugal, balanced, max } = defaultClaudeCodeTierModels();
    expect(new Set([frugal, balanced, max]).size).toBe(3);
    expect([frugal, balanced, max]).toEqual(['haiku', 'sonnet', 'opus']);
  });
});
