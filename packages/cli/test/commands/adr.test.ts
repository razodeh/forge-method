/**
 * `forge adr <new|list|show|supersede|accept|reject>` — `03` §3.2.2.
 *
 * @see specs/03 §3.2.2
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  adrAccept,
  adrList,
  adrNew,
  adrReject,
  adrShow,
  adrSupersede,
  type AdrCommandContext,
} from '../../src/commands/adr.ts';
import { KB_ROOT, cleanupAll, createTestProject, type TestProject } from './helpers.ts';

afterEach(cleanupAll);

function ctx(project: TestProject): AdrCommandContext {
  return { paths: project.paths, kbRoot: KB_ROOT };
}

describe('adrNew', () => {
  it('allocates a real, well-formed id and scaffolds the real ADR template', async () => {
    const project = await createTestProject();
    const doc = await adrNew(ctx(project), 'Use PostgreSQL for the primary store');
    expect(doc.get(['id'])).toMatch(/^ADR-\d{4}$/);
    expect(doc.get(['title'])).toBe('Use PostgreSQL for the primary store');
    expect(doc.get(['status'])).toBe('proposed');
    // The rest of the template's own authorable placeholder text is left untouched.
    expect(doc.get(['category'])).toBe('architecture');
  });

  it('allocates a different id for each successive new ADR', async () => {
    const project = await createTestProject();
    const first = await adrNew(ctx(project), 'First decision');
    const second = await adrNew(ctx(project), 'Second decision');
    expect(first.get(['id'])).not.toBe(second.get(['id']));
  });

  it('never double-allocates an id under real concurrency (two adrNew calls fired at once)', async () => {
    // A gauntlet critic demonstrated the original per-call `new IdAllocator(...)` let two concurrent
    // calls both allocate ADR-0001 against the same project — this is the regression test for the
    // shared-allocator fix.
    const project = await createTestProject();
    const [first, second] = await Promise.all([
      adrNew(ctx(project), 'Concurrent decision A'),
      adrNew(ctx(project), 'Concurrent decision B'),
    ]);
    expect(first.get(['id'])).not.toBe(second.get(['id']));

    const list = await adrList(ctx(project));
    expect(list).toHaveLength(2);
    expect(new Set(list.map((entry) => entry.id)).size).toBe(2);
  });

  it('writes the ADR to the real, documented kb/decisions/ path', async () => {
    const project = await createTestProject();
    const doc = await adrNew(ctx(project), 'A slugged title, with punctuation!');
    expect(doc.path.startsWith(`${KB_ROOT}/decisions/`)).toBe(true);
    expect(doc.path).toContain('a-slugged-title-with-punctuation');
  });
});

describe('adrList / adrShow', () => {
  it('lists every real ADR written so far', async () => {
    const project = await createTestProject();
    await adrNew(ctx(project), 'Decision one');
    await adrNew(ctx(project), 'Decision two');
    const list = await adrList(ctx(project));
    expect(list).toHaveLength(2);
  });

  it('shows one real ADR by its real id', async () => {
    const project = await createTestProject();
    const created = await adrNew(ctx(project), 'A real decision');
    const id = created.get(['id']) as string;
    const shown = await adrShow(ctx(project), id);
    expect(shown.get(['title'])).toBe('A real decision');
  });
});

describe('adrAccept / adrReject', () => {
  it('accepts a real ADR, bumping its real revision', async () => {
    const project = await createTestProject();
    const created = await adrNew(ctx(project), 'To be accepted');
    const id = created.get(['id']) as string;

    const accepted = await adrAccept(ctx(project), id);
    expect(accepted.get(['status'])).toBe('accepted');
    expect(accepted.get(['revision'])).toBe(2);
  });

  it('rejects a real ADR', async () => {
    const project = await createTestProject();
    const created = await adrNew(ctx(project), 'To be rejected');
    const id = created.get(['id']) as string;

    const rejected = await adrReject(ctx(project), id);
    expect(rejected.get(['status'])).toBe('rejected');
  });
});

describe('adrSupersede', () => {
  it('creates a real replacement ADR and cross-links both real documents', async () => {
    const project = await createTestProject();
    const original = await adrNew(ctx(project), 'The original decision');
    const originalId = original.get(['id']) as string;

    const { superseded, replacement } = await adrSupersede(
      ctx(project),
      originalId,
      'The replacement decision',
    );

    expect(superseded.get(['status'])).toBe('superseded');
    expect(superseded.get(['superseded_by'])).toBe(replacement.get(['id']));
    expect(replacement.get(['supersedes'])).toEqual([originalId]);
  });

  it('throws KB-015 for a nonexistent id and writes no stray replacement ADR', async () => {
    // A gauntlet critic found the original ordering allocated and wrote a real replacement ADR
    // *before* checking the original id existed — this proves the fix: nothing is written at all.
    const project = await createTestProject();
    await expect(adrSupersede(ctx(project), 'ADR-9999', 'A replacement')).rejects.toMatchObject({
      code: 'KB-015',
    });
    const list = await adrList(ctx(project));
    expect(list).toEqual([]);
  });
});
