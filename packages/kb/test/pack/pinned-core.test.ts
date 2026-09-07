/**
 * `computePinnedCore` — `05` §5.4's seven pinned-core items, four of them computed straight from the
 * already-parsed `KbTree` (`glossary`, `constraints`, `adrIndex`, `codingStandards`) and three passed
 * through from caller-supplied overrides (`projectIdentity`, `level`, `stageGoal`), since nothing in
 * this milestone's own `KbTree` carries them.
 *
 * @see specs/05 §5.4
 * @see SPEC-QUESTIONS.md Q54
 * @see PLAN-M3.md P9
 */
import { ProjectPaths } from '@forge/core/fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { computePinnedCore } from '../../src/pack/pinned-core.ts';
import { parseKbTree, type KbParsedEntry } from '../../src/schema/tree.ts';
import type { PinnedCore } from '../../src/pack/types.ts';

const FIXTURE_ROOT = path.resolve(import.meta.dirname, '../../../../fixtures/greenfield-service');

function findAdr(entries: readonly KbParsedEntry[]): Extract<KbParsedEntry, { kind: 'adr' }> {
  const adr = entries.find((entry): entry is Extract<KbParsedEntry, { kind: 'adr' }> => entry.kind === 'adr');
  if (adr === undefined) throw new Error('fixture missing an adr entry');
  return adr;
}

describe('computePinnedCore — fixtures/greenfield-service', () => {
  it('takes glossary from glossary.md\'s own body, not a fabricated summary', async () => {
    const paths = new ProjectPaths(FIXTURE_ROOT);
    const tree = await parseKbTree(paths);
    const core = computePinnedCore(tree, undefined);
    expect(core.glossary).toContain('Term definitions for this project\'s domain.');
    expect(core.glossary).toContain('**Component**');
  });

  it('takes codingStandards from engineering/standards.md\'s own body', async () => {
    const paths = new ProjectPaths(FIXTURE_ROOT);
    const tree = await parseKbTree(paths);
    const core = computePinnedCore(tree, undefined);
    expect(core.codingStandards).toContain('follows the repository\'s own ESLint configuration');
  });

  it('computes constraints as one sorted line per active constraints-section entry', async () => {
    const paths = new ProjectPaths(FIXTURE_ROOT);
    const tree = await parseKbTree(paths);
    const core = computePinnedCore(tree, undefined);
    expect(core.constraints).toBe('KB-CON-0001: No new language runtimes without an ADR');
  });

  it('computes adrIndex as one sorted line per ADR, with id, title, and status', async () => {
    const paths = new ProjectPaths(FIXTURE_ROOT);
    const tree = await parseKbTree(paths);
    const core = computePinnedCore(tree, undefined);
    expect(core.adrIndex).toBe('ADR-0001: Use PostgreSQL as the primary transactional store (accepted)');
  });

  it('leaves projectIdentity/level/stageGoal undefined when no override is given', async () => {
    const paths = new ProjectPaths(FIXTURE_ROOT);
    const tree = await parseKbTree(paths);
    const core = computePinnedCore(tree, undefined);
    expect(core.projectIdentity).toBeUndefined();
    expect(core.level).toBeUndefined();
    expect(core.stageGoal).toBeUndefined();
  });

  it('lets a caller-supplied override fill projectIdentity/level/stageGoal, and even replace a computed field', async () => {
    const paths = new ProjectPaths(FIXTURE_ROOT);
    const tree = await parseKbTree(paths);
    const core = computePinnedCore(tree, {
      projectIdentity: 'greenfield-service: a small internal API',
      level: 'MVP',
      stageGoal: 'Ship the first vertical slice',
      constraints: 'overridden',
    });
    expect(core.projectIdentity).toBe('greenfield-service: a small internal API');
    expect(core.level).toBe('MVP');
    expect(core.stageGoal).toBe('Ship the first vertical slice');
    expect(core.constraints).toBe('overridden');
  });

  it('keeps the computed value for a required field when the override object sets it to undefined explicitly, rather than clobbering it', async () => {
    // `Partial<PinnedCore>` (`pinnedCoreOverrides`'s own type) lets a caller write `{ glossary:
    // undefined }` even though `PinnedCore.glossary` is a required `string` — a gauntlet verify pass
    // found a plain object spread let that explicit `undefined` through, producing a `PinnedCore`
    // whose `glossary` was genuinely `undefined` at runtime despite its required-`string` type.
    const paths = new ProjectPaths(FIXTURE_ROOT);
    const tree = await parseKbTree(paths);
    const computed = computePinnedCore(tree, undefined);
    // `exactOptionalPropertyTypes` means no ordinary, type-checked call site can write this literal —
    // the cast simulates an untyped/JS caller, or one that spread a partially-built config object
    // through without omitting the key, either of which is a real possibility for an exported library
    // function's own runtime input.
    const adversarialOverrides = {
      glossary: undefined,
      constraints: undefined,
      adrIndex: undefined,
      codingStandards: undefined,
    } as unknown as Partial<PinnedCore>;
    const withExplicitUndefined = computePinnedCore(tree, adversarialOverrides);
    expect(withExplicitUndefined.glossary).toBe(computed.glossary);
    expect(withExplicitUndefined.constraints).toBe(computed.constraints);
    expect(withExplicitUndefined.adrIndex).toBe(computed.adrIndex);
    expect(withExplicitUndefined.codingStandards).toBe(computed.codingStandards);
  });

  it('excludes a non-active constraints-section entry from the constraints line', async () => {
    const paths = new ProjectPaths(FIXTURE_ROOT);
    const tree = await parseKbTree(paths);
    const withDraftConstraint = {
      ...tree,
      entries: [
        ...tree.entries,
        {
          path: 'constraints/draft.md',
          kind: 'kb-entry' as const,
          value: {
            ...(tree.entries.find((e) => e.path === 'constraints/technical.md') as Extract<
              (typeof tree.entries)[number],
              { kind: 'kb-entry' }
            >).value,
            id: 'KB-CON-0002',
            status: 'draft' as const,
            title: 'A not-yet-active constraint',
          },
        },
      ],
    };
    const core = computePinnedCore(withDraftConstraint, undefined);
    expect(core.constraints).not.toContain('KB-CON-0002');
  });

  it('sorts three active constraints entries by id ascending, in a scrambled insertion order', async () => {
    const paths = new ProjectPaths(FIXTURE_ROOT);
    const tree = await parseKbTree(paths);
    const technical = tree.entries.find((e) => e.path === 'constraints/technical.md') as Extract<
      (typeof tree.entries)[number],
      { kind: 'kb-entry' }
    >;
    // Neither strictly ascending nor strictly descending — with only one or two entries inserted in a
    // single direction, Array.prototype.sort's own insertion sort calls the comparator too few times
    // to exercise both the a < b and a >= b branches; this scrambled order (0001, 0003, 0000) does.
    const withMoreActiveConstraints = {
      ...tree,
      entries: [
        ...tree.entries,
        {
          ...technical,
          path: 'constraints/third.md',
          value: { ...technical.value, id: 'KB-CON-0003', title: 'A later-numbered constraint' },
        },
        {
          ...technical,
          path: 'constraints/second.md',
          value: { ...technical.value, id: 'KB-CON-0000', title: 'An earlier-numbered constraint' },
        },
      ],
    };
    const core = computePinnedCore(withMoreActiveConstraints, undefined);
    expect(core.constraints).toBe(
      [
        'KB-CON-0000: An earlier-numbered constraint',
        'KB-CON-0001: No new language runtimes without an ADR',
        'KB-CON-0003: A later-numbered constraint',
      ].join('\n'),
    );
  });

  it('sorts two ADRs by id ascending regardless of insertion order', async () => {
    const paths = new ProjectPaths(FIXTURE_ROOT);
    const tree = await parseKbTree(paths);
    const adr = findAdr(tree.entries);
    const withSecondAdr = {
      ...tree,
      entries: [
        ...tree.entries,
        {
          ...adr,
          path: 'decisions/ADR-0000-earlier.md',
          value: { ...adr.value, id: 'ADR-0000', title: 'An earlier-numbered decision' },
        },
      ],
    };
    const core = computePinnedCore(withSecondAdr, undefined);
    expect(core.adrIndex).toBe(
      [
        'ADR-0000: An earlier-numbered decision (accepted)',
        'ADR-0001: Use PostgreSQL as the primary transactional store (accepted)',
      ].join('\n'),
    );
  });

  it('is "" for glossary/codingStandards when the fixed path does not exist in the tree at all', () => {
    const core = computePinnedCore({ entries: [], errors: [] }, undefined);
    expect(core.glossary).toBe('');
    expect(core.codingStandards).toBe('');
  });

  it('is "" for glossary when something non-kb-entry sits at glossary.md\'s own path', async () => {
    const paths = new ProjectPaths(FIXTURE_ROOT);
    const tree = await parseKbTree(paths);
    const adr = findAdr(tree.entries);
    const withNonEntryAtGlossaryPath = {
      ...tree,
      entries: [...tree.entries.filter((e) => e.path !== 'glossary.md'), { ...adr, path: 'glossary.md' }],
    };
    const core = computePinnedCore(withNonEntryAtGlossaryPath, undefined);
    expect(core.glossary).toBe('');
  });
});
