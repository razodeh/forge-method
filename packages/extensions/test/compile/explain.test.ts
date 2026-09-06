/**
 * `explainOverlay` — `AC15-2` reproduced through the full `compile()` pipeline.
 *
 * @see specs/15 §15.2
 * @see PLAN-M2.md P9
 */
import { describe, expect, it } from 'vitest';

import { compile } from '../../src/compile/compile.ts';
import { explainOverlay } from '../../src/compile/explain.ts';
import type { CompileSources } from '../../src/compile/types.ts';

const EMPTY_SOURCES: CompileSources = {
  agents: {},
  workflows: {},
  frameworks: {},
  templates: {},
  checks: {},
  skills: {},
};

describe('explainOverlay', () => {
  it('names the true supplying layer for every field of a real multi-layer fixture', () => {
    const result = compile({
      ...EMPTY_SOURCES,
      agents: {
        backend: [
          {
            layer: 'L0',
            source: 'built-in',
            document: { model: { tier: 'balanced' }, persona: { voice: 'neutral' } },
          },
          { layer: 'L1', source: 'module:fm-core', document: { limits: { max_cost_usd: 2 } } },
          { layer: 'L3', source: 'project', document: { model: { tier: 'frugal' } } },
        ],
      },
    });
    expect(explainOverlay(result, 'agents', 'backend')).toEqual([
      { path: 'limits.max_cost_usd', layer: 'L1' },
      { path: 'model.tier', layer: 'L3' },
      { path: 'persona.voice', layer: 'L0' },
    ]);
  });

  it('returns [] for an unknown entity id', () => {
    const result = compile(EMPTY_SOURCES);
    expect(explainOverlay(result, 'agents', 'does-not-exist')).toEqual([]);
  });

  it('returns entries sorted by path, deterministically, regardless of contribution order', () => {
    const result = compile({
      ...EMPTY_SOURCES,
      agents: {
        backend: [{ layer: 'L0', source: 'built-in', document: { zeta: 'z', alpha: 'a' } }],
      },
    });
    const paths = explainOverlay(result, 'agents', 'backend').map((entry) => entry.path);
    expect(paths).toEqual([...paths].sort());
  });
});
