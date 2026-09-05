/**
 * `baseFrontMatterSchema` — `specs/18` §18.6's canonical front matter.
 *
 * `specs/21` §21.3: "valid fixture passes, invalid fixture fails with the expected error path" —
 * every invalid case below asserts `error.issues[0].path`, not merely that parsing failed, per that
 * rule and `PLAN-M1.md` P5's own Checks.
 *
 * @see specs/18 §18.6
 * @see specs/21 §21.3
 */
import { describe, expect, it } from 'vitest';

import { baseFrontMatterSchema } from '../../src/registry/front-matter.ts';

/** A front matter object matching `specs/18` §18.6's own example, field for field. */
function validStoryFrontMatter(): Record<string, unknown> {
  return {
    id: 'STORY-014',
    type: 'Story',
    schemaVersion: 3,
    title: 'Render invoice preview from line items',
    status: 'ready',
    created: '2026-03-04',
    updated: '2026-03-11',
    revision: 2,
    author: 'po',
    run: 'run_01H',
    changelog: [
      { revision: 2, date: '2026-03-11', by: 'po', summary: 'Split AC-014-3 out to STORY-019' },
    ],
  };
}

describe('baseFrontMatterSchema — the valid case', () => {
  it('accepts the spec §18.6 example verbatim', () => {
    const result = baseFrontMatterSchema.safeParse(validStoryFrontMatter());
    expect(result.success).toBe(true);
  });

  it('accepts front matter with no run and an empty changelog (both allowed to be absent/empty)', () => {
    const withoutRun = validStoryFrontMatter();
    delete withoutRun['run'];
    const result = baseFrontMatterSchema.safeParse({ ...withoutRun, changelog: [] });
    expect(result.success).toBe(true);
  });

  it('accepts every registered artifact type as a valid "type" value, with a matching id', () => {
    const cases: readonly [type: string, id: string][] = [
      ['Vision', 'VIS-001'],
      ['Capability', 'CAP-004'],
      ['NFR', 'NFR-0002'],
      ['Epic', 'EPIC-003'],
      ['Story', 'STORY-014'],
      ['Task', 'TASK-041'],
      ['ADR', 'ADR-0011'],
      ['InterfaceContract', 'INT-004'],
      ['DataModel', 'DM-002'],
      ['Diagram', 'DIAG-014'],
      ['Risk', 'RISK-001'],
      ['Assumption', 'ASM-001'],
      ['OpenQuestion', 'OQ-001'],
      ['Waiver', 'WAIVER-001'],
      ['SessionRecord', 'SESSION-001'],
      ['RCA', 'RCA-001'],
      ['Defect', 'DEF-001'],
      ['Environment', 'ENV-001'],
      ['Runbook', 'RUN-001'],
      ['GateReport', 'GATE-001'],
      ['HandoffRecord', 'HO-0001'],
    ];
    for (const [type, id] of cases) {
      const result = baseFrontMatterSchema.safeParse({ ...validStoryFrontMatter(), type, id });
      expect(result.success, `type "${type}" with id "${id}"`).toBe(true);
    }
  });

  it('accepts the suffixed sub-id form (a split acceptance criterion, e.g. STORY-014-2)', () => {
    // Both the base regex and the per-type superRefine check allow a trailing `-\d+`; this is the
    // one shape neither the spec §18.6 example nor the per-type loop above ever exercises.
    const result = baseFrontMatterSchema.safeParse({
      ...validStoryFrontMatter(),
      id: 'STORY-014-2',
    });
    expect(result.success).toBe(true);
  });
});

describe('baseFrontMatterSchema — invalid, each asserting the error path', () => {
  it('rejects an id not matching the shape regex', () => {
    const result = baseFrontMatterSchema.safeParse({
      ...validStoryFrontMatter(),
      id: 'story-014',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['id']);
  });

  it('rejects an id whose prefix does not match its declared type', () => {
    const result = baseFrontMatterSchema.safeParse({
      ...validStoryFrontMatter(),
      id: 'STORY-014',
      type: 'Vision',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['id']);
  });

  it('rejects an id with the right prefix but the wrong digit width for its type', () => {
    // ADR requires 4 digits; 3 is a well-formed id shape in general (the base regex allows 3 or 4)
    // but wrong for this specific type.
    const result = baseFrontMatterSchema.safeParse({
      ...validStoryFrontMatter(),
      id: 'ADR-011',
      type: 'ADR',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['id']);
  });

  it('rejects a type that is not a registered artifact type', () => {
    const result = baseFrontMatterSchema.safeParse({
      ...validStoryFrontMatter(),
      type: 'NotARealType',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['type']);
  });

  it('rejects a non-integer schemaVersion', () => {
    const result = baseFrontMatterSchema.safeParse({
      ...validStoryFrontMatter(),
      schemaVersion: 1.5,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['schemaVersion']);
  });

  it('rejects schemaVersion 0 (versions count from 1)', () => {
    const result = baseFrontMatterSchema.safeParse({
      ...validStoryFrontMatter(),
      schemaVersion: 0,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['schemaVersion']);
  });

  it('rejects an empty title', () => {
    const result = baseFrontMatterSchema.safeParse({ ...validStoryFrontMatter(), title: '' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['title']);
  });

  it('rejects an empty status', () => {
    const result = baseFrontMatterSchema.safeParse({ ...validStoryFrontMatter(), status: '' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['status']);
  });

  it('rejects a created date with a time component', () => {
    const result = baseFrontMatterSchema.safeParse({
      ...validStoryFrontMatter(),
      created: '2026-03-04T00:00:00Z',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['created']);
  });

  it('rejects a malformed updated date', () => {
    const result = baseFrontMatterSchema.safeParse({
      ...validStoryFrontMatter(),
      updated: '03/11/2026',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['updated']);
  });

  it('rejects revision 0 (revisions count from 1)', () => {
    const result = baseFrontMatterSchema.safeParse({ ...validStoryFrontMatter(), revision: 0 });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['revision']);
  });

  it('rejects an empty author', () => {
    const result = baseFrontMatterSchema.safeParse({ ...validStoryFrontMatter(), author: '' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['author']);
  });

  it('rejects a changelog entry missing a required field', () => {
    const result = baseFrontMatterSchema.safeParse({
      ...validStoryFrontMatter(),
      changelog: [{ revision: 1, date: '2026-03-04', by: 'po' }],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['changelog', 0, 'summary']);
  });

  it('rejects a changelog entry with an unknown key', () => {
    const result = baseFrontMatterSchema.safeParse({
      ...validStoryFrontMatter(),
      changelog: [
        { revision: 1, date: '2026-03-04', by: 'po', summary: 'x', extra: 'not allowed' },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['changelog', 0]);
  });

  it('rejects an unknown top-level key', () => {
    const result = baseFrontMatterSchema.safeParse({
      ...validStoryFrontMatter(),
      extra: 'not part of the schema',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual([]);
  });

  it('rejects front matter missing a required field entirely', () => {
    const withoutTitle = validStoryFrontMatter();
    delete withoutTitle['title'];
    const result = baseFrontMatterSchema.safeParse(withoutTitle);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['title']);
  });
});
