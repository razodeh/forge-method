/**
 * `forge template <list|validate>`.
 *
 * @see specs/22 M6
 */
import { describe, expect, it } from 'vitest';

import { templateList, templateValidateAll } from '../../src/commands/template.ts';

describe('templateList', () => {
  it('lists every real, shipped artifact-template type id', () => {
    const types = templateList();
    expect(types).toContain('Story');
    expect(types).toContain('ADR');
    expect(types.length).toBeGreaterThan(15);
  });
});

describe('templateValidateAll', () => {
  it('validates every real, shipped template with zero real errors — this milestone’s own exit-test line', async () => {
    const results = await templateValidateAll();
    expect(results.length).toBe(templateList().length);
    const invalid = results.filter((result) => !result.valid);
    expect(invalid).toEqual([]);
  });

  it('checks every real full-document template through validateArtifact, not just parses it', async () => {
    const results = await templateValidateAll();
    const story = results.find((result) => result.type === 'Story');
    expect(story?.kind).toBe('full');
    expect(story?.valid).toBe(true);
  });

  it('recognizes a real collection-entry stub template as its own honest kind, not a schema failure', async () => {
    const results = await templateValidateAll();
    const risk = results.find((result) => result.type === 'Risk');
    expect(risk?.kind).toBe('stub');
    expect(risk?.valid).toBe(true);
  });
});
