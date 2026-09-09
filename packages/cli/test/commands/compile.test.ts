/**
 * `forge compile [--check]` — a thin wrapper over `@forge/extensions/compile`.
 */
import { describe, expect, it } from 'vitest';
import type { CompileSources } from '@forge/extensions/compile';

import { forgeCompile } from '../../src/commands/compile.ts';

const SOURCES: CompileSources = {
  agents: {
    backend: [{ layer: 'L0', source: 'built-in', document: { model: { tier: 'balanced' } } }],
  },
  workflows: {},
  frameworks: {},
  templates: {},
  checks: {},
  skills: {},
};

describe('forgeCompile', () => {
  it('resolves a real entity through the real compile() it wraps', () => {
    const result = forgeCompile(SOURCES);
    expect(result.documents.agents.size).toBe(1);
    expect(result.violations).toEqual([]);
  });

  it('threads --check through to the real invariant pass', () => {
    const result = forgeCompile(SOURCES, { check: true });
    expect(Array.isArray(result.violations)).toBe(true);
  });
});
