/**
 * `KbWriter` — `08` §8.6's two write paths.
 *
 * @see specs/08 §8.6
 * @see SPEC-QUESTIONS.md Q52
 * @see PLAN-M3.md P7
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { isForgeError } from '@forge/core';
import type { Clock } from '@forge/core';
import { ProjectPaths } from '@forge/core/fs';
import { afterEach, describe, expect, it } from 'vitest';

import type { KbEntryInput, KbProposal } from '../../src/write/writer.ts';
import { KbWriter } from '../../src/write/writer.ts';

let projectRoot: string | undefined;

function freshProject(): ProjectPaths {
  const root = mkdtempSync(path.join(tmpdir(), 'forge-kb-writer-'));
  projectRoot = root;
  return new ProjectPaths(root);
}

/** A deterministic, injected clock returning real ISO-8601 timestamps a second apart — never the
 * real one (`QUALITY-BAR.md` R10). */
function fakeClock(startIso = '2026-01-05T00:00:00.000Z'): Clock {
  let current = new Date(startIso).getTime();
  return {
    now: () => {
      const iso = new Date(current).toISOString();
      current += 1000;
      return iso;
    },
  };
}

function validInput(overrides: Partial<KbEntryInput> = {}): KbEntryInput {
  return {
    path: 'architecture/topic.md',
    type: 'knowledge',
    section: 'architecture',
    title: 'A new piece of knowledge',
    status: 'active',
    confidence: 'high',
    owner: 'architect',
    sources: [{ kind: 'human', ref: 'elicitation 2026-01-05' }],
    review_by: '2026-04-05',
    supersedes: [],
    superseded_by: null,
    related: [],
    diagrams: [],
    tags: [],
    applies_to: [],
    body: '## Statement\nSomething is true.\n\n## Rationale\nBecause.\n',
    ...overrides,
  };
}

afterEach(() => {
  if (projectRoot !== undefined) rmSync(projectRoot, { recursive: true, force: true });
  projectRoot = undefined;
});

describe('KbWriter.write', () => {
  it('allocates an id, sets created/updated to the clock, and writes the file', async () => {
    const paths = freshProject();
    const writer = new KbWriter({ paths, clock: fakeClock('2026-01-05T00:00:00.000Z') });
    const entry = await writer.write(validInput());

    expect(entry.id).toBe('KB-ARCH-0001');
    expect(entry.created).toBe('2026-01-05');
    expect(entry.updated).toBe('2026-01-05');

    const written = readFileSync(
      paths.resolveWithin('docs/forge/kb/architecture/topic.md'),
      'utf8',
    );
    expect(written).toContain('id: KB-ARCH-0001');
    expect(written).toContain('## Statement');
  });

  it('appends one write event to the KB event log', async () => {
    const paths = freshProject();
    const writer = new KbWriter({ paths, clock: fakeClock() });
    await writer.write(validInput());

    const log = readFileSync(paths.resolveState('kb-events.jsonl'), 'utf8').trim().split('\n');
    expect(log).toHaveLength(1);
    const event = JSON.parse(log[0] ?? '{}') as { kind: string; entryId: string };
    expect(event.kind).toBe('write');
    expect(event.entryId).toBe('KB-ARCH-0001');
  });

  it('rejects an entry with no sources (KB-004), never silently accepted', async () => {
    const paths = freshProject();
    const writer = new KbWriter({ paths, clock: fakeClock() });
    let thrown: unknown;
    try {
      await writer.write(validInput({ sources: [] }));
    } catch (error) {
      thrown = error;
    }
    expect(isForgeError(thrown) && thrown.code === 'KB-004').toBe(true);
  });

  it('rejects an otherwise schema-invalid entry (KB-006)', async () => {
    const paths = freshProject();
    const writer = new KbWriter({ paths, clock: fakeClock() });
    let thrown: unknown;
    try {
      await writer.write(validInput({ owner: '' }));
    } catch (error) {
      thrown = error;
    }
    expect(isForgeError(thrown) && thrown.code === 'KB-006').toBe(true);
  });

  it('a schema-invalid write does not burn the id it would have allocated', async () => {
    // A gauntlet critic found a first version allocated before validating, so every typo in an
    // unrelated field (owner: '') permanently retired a real id for nothing.
    const paths = freshProject();
    const writer = new KbWriter({ paths, clock: fakeClock() });

    let thrown: unknown;
    try {
      await writer.write(validInput({ owner: '' }));
    } catch (error) {
      thrown = error;
    }
    expect(isForgeError(thrown) && thrown.code === 'KB-006').toBe(true);

    const entry = await writer.write(validInput());
    expect(entry.id).toBe('KB-ARCH-0001');
  });

  it('rejects a write to a path that already has an entry (KB-009), never silently overwriting it', async () => {
    const paths = freshProject();
    const writer = new KbWriter({ paths, clock: fakeClock() });
    const first = await writer.write(validInput());

    let thrown: unknown;
    try {
      await writer.write(validInput({ title: 'A different entry, same path' }));
    } catch (error) {
      thrown = error;
    }
    expect(isForgeError(thrown) && thrown.code === 'KB-009').toBe(true);

    const onDisk = readFileSync(paths.resolveWithin('docs/forge/kb/architecture/topic.md'), 'utf8');
    expect(onDisk).toContain(first.id);
    expect(onDisk).not.toContain('A different entry, same path');
  });

  it('two concurrent write() calls to the same section allocate two distinct, contiguous ids', async () => {
    const paths = freshProject();
    const writer = new KbWriter({ paths, clock: fakeClock() });
    const [a, b] = await Promise.all([
      writer.write(validInput({ path: 'architecture/a.md' })),
      writer.write(validInput({ path: 'architecture/b.md' })),
    ]);
    expect([a.id, b.id].sort()).toEqual(['KB-ARCH-0001', 'KB-ARCH-0002']);
  });

  it('two independently-constructed KbWriters against the same project never collide', async () => {
    // A gauntlet critic found a first version queued per KbWriter *instance*, not per project: two
    // separately-constructed writers against the same project raced for real (double-allocated ids,
    // lost event-log lines), despite this file's own earlier claim to be "process-wide."
    const paths = freshProject();
    const writerA = new KbWriter({ paths, clock: fakeClock() });
    const writerB = new KbWriter({ paths, clock: fakeClock('2026-06-01T00:00:00.000Z') });

    const entries = await Promise.all([
      writerA.write(validInput({ path: 'architecture/a.md' })),
      writerB.write(validInput({ path: 'architecture/b.md' })),
      writerA.write(validInput({ path: 'architecture/c.md' })),
      writerB.write(validInput({ path: 'architecture/d.md' })),
    ]);

    const ids = entries.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([
      'KB-ARCH-0001',
      'KB-ARCH-0002',
      'KB-ARCH-0003',
      'KB-ARCH-0004',
    ]);

    const log = readFileSync(paths.resolveState('kb-events.jsonl'), 'utf8').trim().split('\n');
    expect(log).toHaveLength(4);
  });

  it('is deterministic: identical inputs at the same clock tick produce the same result', async () => {
    const first = freshProject();
    const second = freshProject();
    const entryFirst = await new KbWriter({ paths: first, clock: fakeClock() }).write(validInput());
    const entrySecond = await new KbWriter({ paths: second, clock: fakeClock() }).write(
      validInput(),
    );
    expect(entrySecond).toEqual(entryFirst);
  });
});

describe('KbWriter.write confidenceCeiling (PLAN-M10.md P16)', () => {
  it('refuses (KB-016) a confidence above the ceiling', async () => {
    const paths = freshProject();
    const writer = new KbWriter({ paths, clock: fakeClock() });
    let error: unknown;
    try {
      await writer.write(validInput({ confidence: 'high' }), { confidenceCeiling: 'medium' });
    } catch (caught) {
      error = caught;
    }
    expect(isForgeError(error) && error.code).toBe('KB-016');
  });

  it('accepts a confidence at or below the ceiling', async () => {
    const paths = freshProject();
    const writer = new KbWriter({ paths, clock: fakeClock() });
    const entry = await writer.write(validInput({ confidence: 'medium', status: 'draft' }), {
      confidenceCeiling: 'medium',
    });
    expect(entry.confidence).toBe('medium');
  });

  it('accepts the lowest confidence value against every ceiling, including "low" itself', async () => {
    const paths = freshProject();
    const writer = new KbWriter({ paths, clock: fakeClock() });
    const entry = await writer.write(validInput({ confidence: 'low', status: 'draft' }), {
      confidenceCeiling: 'low',
    });
    expect(entry.confidence).toBe('low');
  });

  it('has no ceiling at all when the option is omitted -- every pre-existing caller, unchanged', async () => {
    const paths = freshProject();
    const writer = new KbWriter({ paths, clock: fakeClock() });
    const entry = await writer.write(
      validInput({
        confidence: 'verified',
        body: validInput().body + '\n## Verification\nChecked by hand.\n',
      }),
    );
    expect(entry.confidence).toBe('verified');
  });
});

describe('KbWriter.propose', () => {
  async function writerWithOneEntry(paths: ProjectPaths, clock: Clock): Promise<KbWriter> {
    const writer = new KbWriter({ paths, clock });
    await writer.write(validInput());
    return writer;
  }

  function proposal(overrides: Partial<KbProposal> = {}): KbProposal {
    return {
      targetId: 'KB-ARCH-0001',
      field: 'statement',
      baseValue: 'Something is true.',
      proposedValue: 'Something else is true.',
      rationale: 'New information came in.',
      sources: [{ kind: 'human', ref: 'follow-up elicitation' }],
      ...overrides,
    };
  }

  it('applies a proposal whose baseValue matches the target section’s current content', async () => {
    const paths = freshProject();
    const writer = await writerWithOneEntry(paths, fakeClock());
    const outcome = await writer.propose(proposal());

    expect(outcome.status).toBe('applied');
    const written = readFileSync(
      paths.resolveWithin('docs/forge/kb/architecture/topic.md'),
      'utf8',
    );
    expect(written).toContain('Something else is true.');
    expect(written).not.toContain('## Statement\nSomething is true.');
  });

  it('bumps updated on a successful proposal', async () => {
    const paths = freshProject();
    const writer = await writerWithOneEntry(paths, fakeClock('2026-01-05T00:00:00.000Z'));
    await writer.propose(proposal());
    const written = readFileSync(
      paths.resolveWithin('docs/forge/kb/architecture/topic.md'),
      'utf8',
    );
    // A real string value is always rendered double-quoted now (`stringifyScalar`'s own doc comment
    // in `@forge/core/artifacts/edit.ts` — a real `YAML.stringify` corruption class this guarantees
    // against, `PLAN-M8.md` P9).
    expect(written).toMatch(/updated: "2026-01-05"/);
  });

  it('rejects a proposal with no sources (KB-004)', async () => {
    const paths = freshProject();
    const writer = await writerWithOneEntry(paths, fakeClock());
    let thrown: unknown;
    try {
      await writer.propose(proposal({ sources: [] }));
    } catch (error) {
      thrown = error;
    }
    expect(isForgeError(thrown) && thrown.code === 'KB-004').toBe(true);
  });

  it('rejects a proposal against an unknown target (KB-007)', async () => {
    const paths = freshProject();
    const writer = await writerWithOneEntry(paths, fakeClock());
    let thrown: unknown;
    try {
      await writer.propose(proposal({ targetId: 'KB-ARCH-9999' }));
    } catch (error) {
      thrown = error;
    }
    expect(isForgeError(thrown) && thrown.code === 'KB-007').toBe(true);
  });

  it('rejects a proposal targeting a section the entry never had (KB-008)', async () => {
    // validInput()'s own body only has ## Statement and ## Rationale — a legitimate KB entry need
    // not carry all four §8.3 sections (only ## Verification is ever required, and only when
    // confidence: 'verified').
    const paths = freshProject();
    const writer = await writerWithOneEntry(paths, fakeClock());
    let thrown: unknown;
    try {
      await writer.propose(proposal({ field: 'implications', baseValue: '' }));
    } catch (error) {
      thrown = error;
    }
    expect(isForgeError(thrown) && thrown.code === 'KB-008').toBe(true);
  });

  it('reports a conflict, without writing anything, when baseValue no longer matches', async () => {
    const paths = freshProject();
    const writer = await writerWithOneEntry(paths, fakeClock());
    const before = readFileSync(paths.resolveWithin('docs/forge/kb/architecture/topic.md'), 'utf8');

    const outcome = await writer.propose(proposal({ baseValue: 'A stale value nobody wrote.' }));

    expect(outcome).toEqual(
      expect.objectContaining({ status: 'conflict', currentValue: 'Something is true.' }),
    );
    const after = readFileSync(paths.resolveWithin('docs/forge/kb/architecture/topic.md'), 'utf8');
    expect(after).toBe(before);
  });

  it('two concurrent proposals to the same target and field: the first applies, the second conflicts', async () => {
    const paths = freshProject();
    const writer = await writerWithOneEntry(paths, fakeClock());

    const [first, second] = await Promise.all([
      writer.propose(proposal({ proposedValue: 'Version A.' })),
      writer.propose(proposal({ proposedValue: 'Version B.' })),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual(['applied', 'conflict']);
  });

  it('two concurrent proposals to the same target but different fields both apply', async () => {
    const paths = freshProject();
    const writer = await writerWithOneEntry(paths, fakeClock());

    const [statementOutcome, rationaleOutcome] = await Promise.all([
      writer.propose(proposal({ field: 'statement', proposedValue: 'New statement.' })),
      writer.propose({
        targetId: 'KB-ARCH-0001',
        field: 'rationale',
        baseValue: 'Because.',
        proposedValue: 'New rationale.',
        rationale: 'Clarifying.',
        sources: [{ kind: 'human', ref: 'follow-up' }],
      }),
    ]);

    expect(statementOutcome.status).toBe('applied');
    expect(rationaleOutcome.status).toBe('applied');
    const written = readFileSync(
      paths.resolveWithin('docs/forge/kb/architecture/topic.md'),
      'utf8',
    );
    expect(written).toContain('New statement.');
    expect(written).toContain('New rationale.');
  });

  it('appends one event per adjudicated proposal', async () => {
    const paths = freshProject();
    const writer = await writerWithOneEntry(paths, fakeClock());
    await writer.propose(proposal());
    await writer.propose(proposal({ baseValue: 'a stale value' }));

    const log = readFileSync(paths.resolveState('kb-events.jsonl'), 'utf8').trim().split('\n');
    // One "write" event from writerWithOneEntry's own setup, plus one per propose() call above.
    expect(log).toHaveLength(3);
    const kinds = log.map((line) => (JSON.parse(line) as { kind: string }).kind);
    expect(kinds).toEqual(['write', 'propose-applied', 'propose-conflict']);
  });

  it('preserves the blank line separating the edited section from the next heading', async () => {
    // A gauntlet critic found a first version silently dropped this separator on any section other
    // than the body's last one — statement, here, is followed by rationale.
    const paths = freshProject();
    const writer = await writerWithOneEntry(paths, fakeClock());
    await writer.propose(proposal());
    const written = readFileSync(
      paths.resolveWithin('docs/forge/kb/architecture/topic.md'),
      'utf8',
    );
    expect(written).toContain('Something else is true.\n\n## Rationale');
  });

  it('does not grow the file with stray trailing blank lines across repeated edits to a non-last section', async () => {
    // A gauntlet critic found a first version appended one extra trailing newline per edit to any
    // section other than the last, compounding without bound over an entry's real editing life.
    const paths = freshProject();
    const writer = await writerWithOneEntry(paths, fakeClock());

    await writer.propose(proposal({ proposedValue: 'Round one.' }));
    const afterRoundOne = readFileSync(
      paths.resolveWithin('docs/forge/kb/architecture/topic.md'),
      'utf8',
    );

    await writer.propose(proposal({ baseValue: 'Round one.', proposedValue: 'Round two.' }));
    const afterRoundTwo = readFileSync(
      paths.resolveWithin('docs/forge/kb/architecture/topic.md'),
      'utf8',
    );

    expect(afterRoundOne.endsWith('\n\n')).toBe(false);
    expect(afterRoundTwo.endsWith('\n\n')).toBe(false);
    expect(afterRoundTwo.length - afterRoundOne.length).toBe(
      'Round two.'.length - 'Round one.'.length,
    );
  });

  it('rejects a proposal whose target id is claimed by more than one file (KB-011)', async () => {
    // The KB is meant to be hand-editable (08 §8.9) — a gauntlet critic found a first version
    // silently picked whichever of two same-id files matched first, with no signal of the ambiguity.
    const paths = freshProject();
    const writer = await writerWithOneEntry(paths, fakeClock());
    const original = readFileSync(
      paths.resolveWithin('docs/forge/kb/architecture/topic.md'),
      'utf8',
    );
    // A path that sorts before "topic.md", reusing the same id — the exact shape a copy-paste leaves.
    const decoyPath = paths.resolveWithin('docs/forge/kb/architecture/aaa-decoy.md');
    writeFileSync(decoyPath, original);

    let thrown: unknown;
    try {
      await writer.propose(proposal());
    } catch (error) {
      thrown = error;
    }
    expect(isForgeError(thrown) && thrown.code === 'KB-011').toBe(true);
  });
});
