/**
 * `diagramSchema` — `08` §8.11.5's Diagram artifact.
 *
 * @see specs/08 §8.11.5
 * @see specs/21 §21.3
 */
import { describe, expect, it } from 'vitest';

import { diagramSchema } from '../../src/artifacts/diagram.ts';

function validDiagram(): Record<string, unknown> {
  return {
    id: 'DIAG-014',
    type: 'Diagram',
    schemaVersion: 1,
    title: 'Container decomposition — billing platform',
    status: 'active',
    created: '2026-03-05',
    updated: '2026-03-05',
    revision: 1,
    author: 'architect',
    changelog: [],
    kind: 'C4Container',
    notation: 'mermaid',
    source: 'architecture/views/containers.mmd',
    generated: true,
    generator: 'forge:components-to-c4',
    depicts: ['component:api', 'component:worker', 'component:web', 'datastore:postgres-primary'],
    explains: ['ADR-0011', 'ADR-0013', 'KB-ARCH-0007'],
    caption: 'The MVP topology: a single API deployable, a worker sharing the same image.',
    alt_text: 'Three boxes — web, API, worker — all connecting to one PostgreSQL database.',
    owner: 'architect',
    verified: '2026-03-11',
    review_by: '2026-06-11',
  };
}

describe('diagramSchema — valid', () => {
  it('accepts the spec §8.11.5 example', () => {
    expect(diagramSchema.safeParse(validDiagram()).success).toBe(true);
  });

  it('accepts generated: false with no generator', () => {
    const withoutGenerator = validDiagram();
    delete withoutGenerator['generator'];
    const result = diagramSchema.safeParse({ ...withoutGenerator, generated: false });
    expect(result.success).toBe(true);
  });
});

describe('diagramSchema — invalid, each asserting the error path', () => {
  it('rejects a missing caption (08 §8.11.5, PLAN-M1.md P7 Check)', () => {
    const withoutCaption = validDiagram();
    delete withoutCaption['caption'];
    const result = diagramSchema.safeParse(withoutCaption);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['caption']);
  });

  it('rejects a missing alt_text (08 §8.11.5, PLAN-M1.md P7 Check)', () => {
    const withoutAltText = validDiagram();
    delete withoutAltText['alt_text'];
    const result = diagramSchema.safeParse(withoutAltText);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['alt_text']);
  });

  it('rejects generated: true with no generator (PLAN-M1.md P7 Check)', () => {
    const withoutGenerator = validDiagram();
    delete withoutGenerator['generator'];
    const result = diagramSchema.safeParse(withoutGenerator);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['generator']);
  });

  it('rejects a notation outside its closed enum', () => {
    const result = diagramSchema.safeParse({ ...validDiagram(), notation: 'ascii' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['notation']);
  });
});
