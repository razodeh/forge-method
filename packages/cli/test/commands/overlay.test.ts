/**
 * `forge overlay explain <id>` — a thin wrapper over `@forge/extensions/compile`'s `explainOverlay`.
 */
import { describe, expect, it } from 'vitest';
import { compile, type CompileSources } from '@forge/extensions/compile';

import { overlayExplain } from '../../src/commands/overlay.ts';

const SOURCES: CompileSources = {
  agents: {
    backend: [
      { layer: 'L0', source: 'built-in', document: { persona: { voice: 'neutral' } } },
      { layer: 'L3', source: 'project', document: { persona: { voice: 'blunt' } } },
    ],
  },
  workflows: {},
  frameworks: {},
  templates: {},
  checks: {},
  skills: {},
};

describe('overlayExplain', () => {
  it('names the real, true supplying layer for a real multi-layer entity', () => {
    const result = compile(SOURCES);
    expect(overlayExplain(result, 'agents', 'backend')).toEqual([
      { path: 'persona.voice', layer: 'L3' },
    ]);
  });
});
