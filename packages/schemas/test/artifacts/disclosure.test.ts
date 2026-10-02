/**
 * `disclosureSchema` — `specs/22` M15 P10's own `DISC-###` entry shape.
 *
 * @see specs/22 M15 P10
 */
import { describe, expect, it } from 'vitest';

import { disclosureSchema } from '../../src/artifacts/disclosure.ts';

function openDisclosure(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'DISC-001',
    kind: 'trade-off',
    summary: 'coverage is project-wide, not scoped to the story the bundle is for',
    owner: 'architect',
    sources: [{ kind: 'decision', ref: 'ADR-0011' }],
    resolved: false,
    ...overrides,
  };
}

describe('disclosureSchema', () => {
  it('accepts a well-formed, unresolved disclosure', () => {
    expect(disclosureSchema.safeParse(openDisclosure()).success).toBe(true);
  });

  it('accepts a well-formed, resolved disclosure carrying a real resolution', () => {
    const result = disclosureSchema.safeParse(
      openDisclosure({
        resolved: true,
        resolution: {
          reason: 'scoped the AC coverage check to the story',
          by: 'architect',
          at: '2026-02-01',
        },
      }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts the other real kind, known-gap', () => {
    expect(disclosureSchema.safeParse(openDisclosure({ kind: 'known-gap' })).success).toBe(true);
  });

  it('rejects a kind outside the two real, persisted values (exemption/stopped-critic-loop are synthesized, never written)', () => {
    const result = disclosureSchema.safeParse(openDisclosure({ kind: 'exemption' }));
    expect(result.success).toBe(false);
  });

  it('rejects resolved: true with no resolution', () => {
    const result = disclosureSchema.safeParse(openDisclosure({ resolved: true }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['resolution']);
  });

  it('rejects resolved: false with a resolution present (the two must agree)', () => {
    const result = disclosureSchema.safeParse(
      openDisclosure({
        resolved: false,
        resolution: { reason: 'x', by: 'architect', at: '2026-02-01' },
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['resolved']);
  });

  it('rejects empty sources -- provenance is mandatory, the identical artifactSourceSchema convention', () => {
    const result = disclosureSchema.safeParse(openDisclosure({ sources: [] }));
    expect(result.success).toBe(false);
  });

  it('rejects a blank summary', () => {
    const result = disclosureSchema.safeParse(openDisclosure({ summary: '' }));
    expect(result.success).toBe(false);
  });

  it('rejects a blank owner', () => {
    const result = disclosureSchema.safeParse(openDisclosure({ owner: '' }));
    expect(result.success).toBe(false);
  });

  it('rejects an id not matching the registered DISC-### prefix/width', () => {
    const result = disclosureSchema.safeParse(openDisclosure({ id: 'EXEMPT-001' }));
    expect(result.success).toBe(false);
  });

  it('rejects an unknown top-level key', () => {
    const result = disclosureSchema.safeParse(openDisclosure({ extra: 'nope' }));
    expect(result.success).toBe(false);
  });
});
