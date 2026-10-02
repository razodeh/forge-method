/**
 * `forge kb <list|show|search|lint|diff|sync|open|graph>` — `03` §3.2.2.
 *
 * @see specs/03 §3.2.2
 */
import { afterEach, describe, expect, it } from 'vitest';

import { ForgeError } from '@forge/core/errors';

import { adrNew } from '../../src/commands/adr.ts';
import { specNew } from '../../src/commands/spec.ts';
import {
  kbDiff,
  kbDisclose,
  kbDiscloseResolve,
  kbDisclosures,
  kbGraph,
  kbLint,
  kbList,
  kbOpen,
  kbSearch,
  kbShow,
  kbSync,
  type KbCommandContext,
} from '../../src/commands/kb.ts';
import {
  KB_ROOT,
  SPECS_ROOT,
  cleanupAll,
  createTestProject,
  writeCollectionFileFixture,
  writeDiagramFixture,
  writeKbEntryFixture,
  writeRunbookFixture,
  type TestProject,
} from './helpers.ts';

afterEach(cleanupAll);

function ctx(project: TestProject): KbCommandContext {
  return { paths: project.paths, kbRoot: KB_ROOT, specsRoot: SPECS_ROOT, level: 'L1', env: {} };
}

describe('kbList / kbShow', () => {
  it('lists every real entry across every real kind (kb-entry, adr, diagram, runbook)', async () => {
    const project = await createTestProject();
    await writeKbEntryFixture(project);
    await writeDiagramFixture(project);
    await writeRunbookFixture(project);
    await adrNew({ paths: project.paths, kbRoot: KB_ROOT }, 'A fixture decision');

    const list = await kbList(ctx(project));
    expect(list.map((entry) => entry.kind).sort()).toEqual([
      'adr',
      'diagram',
      'kb-entry',
      'runbook',
    ]);
  });

  it('lists every real collection-register kind too (risks, assumptions, open-questions, environments, components)', async () => {
    const project = await createTestProject();
    await writeCollectionFileFixture(project, 'risks.md', 'Risk', 'risks');
    await writeCollectionFileFixture(project, 'assumptions.md', 'Assumption', 'assumptions');
    await writeCollectionFileFixture(
      project,
      'open-questions.md',
      'OpenQuestion',
      'open_questions',
    );
    await writeCollectionFileFixture(
      project,
      'delivery/environments.md',
      'Environment',
      'environments',
    );
    await writeCollectionFileFixture(
      project,
      'architecture/components.md',
      'Component',
      'components',
    );

    const list = await kbList(ctx(project));
    expect(list.map((entry) => entry.kind).sort()).toEqual([
      'assumptions-file',
      'components-file',
      'environments-file',
      'open-questions-file',
      'risks-file',
    ]);
    // Each carries a synthetic id (its own path) and a real, non-empty human-readable title —
    // `summarize`'s own documented behaviour for the five kinds with no single id/title of their own.
    for (const entry of list) {
      expect(entry.id).toBe(entry.path);
      expect(entry.title.length).toBeGreaterThan(0);
    }
  });

  it('shows one real entry by its real id', async () => {
    const project = await createTestProject();
    await writeKbEntryFixture(project, 'KB-ARCH-0002');

    const shown = await kbShow(ctx(project), 'KB-ARCH-0002');
    expect(shown.title).toBe('Fixture knowledge entry');
  });

  it('throws KB-015 for an id that does not exist', async () => {
    const project = await createTestProject();
    await expect(kbShow(ctx(project), 'KB-ARCH-9999')).rejects.toMatchObject({ code: 'KB-015' });
  });
});

describe('kbOpen', () => {
  it('resolves the real, full project-relative path of a real entry, without launching anything', async () => {
    const project = await createTestProject();
    await writeKbEntryFixture(project, 'KB-ARCH-0003');
    const opened = await kbOpen(ctx(project), 'KB-ARCH-0003');
    expect(opened.path).toBe(`${KB_ROOT}/architecture/KB-ARCH-0003.md`);
  });
});

describe('kbSync / kbSearch / kbGraph', () => {
  it('sync counts every real entry it indexed', async () => {
    const project = await createTestProject();
    await writeKbEntryFixture(project);
    await writeDiagramFixture(project);
    const result = await kbSync(ctx(project));
    expect(result.entryCount).toBe(2);
  });

  it('search finds a real entry by real term overlap, after a real sync', async () => {
    const project = await createTestProject();
    await writeKbEntryFixture(project);
    await kbSync(ctx(project));

    const hits = await kbSearch(ctx(project), 'Fixture knowledge entry');
    expect(hits.some((hit) => hit.id === 'KB-ARCH-0001')).toBe(true);
  });

  it('search against an unsynced project finds nothing, rather than implicitly syncing', async () => {
    const project = await createTestProject();
    await writeKbEntryFixture(project);
    const hits = await kbSearch(ctx(project), 'Fixture');
    expect(hits).toEqual([]);
  });

  it('graph expands real links from a real synced entry', async () => {
    const project = await createTestProject();
    await writeKbEntryFixture(project);
    await writeDiagramFixture(project);
    await kbSync(ctx(project));

    const edges = await kbGraph(ctx(project), undefined, 1);
    expect(Array.isArray(edges)).toBe(true);
  });

  it('graph expands a real edge from a real cross-reference between two entries', async () => {
    const project = await createTestProject();
    await writeKbEntryFixture(project, 'KB-ARCH-0001', { related: ['KB-ARCH-0002'] });
    await writeKbEntryFixture(project, 'KB-ARCH-0002');
    await kbSync(ctx(project));

    const edges = await kbGraph(ctx(project), 'KB-ARCH-0001', 1);
    expect(edges).toContainEqual({ from: 'KB-ARCH-0001', to: 'KB-ARCH-0002', hops: 1 });
  });
});

describe('kbLint', () => {
  it('lints a real KB tree and surfaces a real dangling-reference finding', async () => {
    const project = await createTestProject();
    // `related` names an id that does not exist anywhere in the tree — a real, checkable defect
    // `lintKb`'s own dangling-reference check exists to catch.
    await writeKbEntryFixture(project, 'KB-ARCH-0001', { related: ['KB-ARCH-9999'] });
    const findings = await kbLint(ctx(project));
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((finding) => finding.message.includes('KB-ARCH-9999'))).toBe(true);
  });

  it('reports no dangling-reference finding once the entry it names really exists', async () => {
    const project = await createTestProject();
    // The base fixture's own `sources` names ADR-0001, which does not exist unless written —
    // writing it closes that one real gap; a real dangling-ref finding for it must then disappear.
    await writeKbEntryFixture(project);
    await adrNew({ paths: project.paths, kbRoot: KB_ROOT }, 'A fixture decision');
    const findings = await kbLint(ctx(project));
    expect(findings.some((finding) => finding.ruleId === 'kb:dangling-ref')).toBe(false);
  });

  it('lints against real spec-side Capability/Epic artifacts too', async () => {
    const project = await createTestProject();
    await writeKbEntryFixture(project);
    await specNew(
      { paths: project.paths, specsRoot: SPECS_ROOT, kbRoot: KB_ROOT },
      'Capability',
      'A real capability',
    );
    await specNew(
      { paths: project.paths, specsRoot: SPECS_ROOT, kbRoot: KB_ROOT },
      'Epic',
      'A real epic',
    );
    const findings = await kbLint(ctx(project));
    expect(Array.isArray(findings)).toBe(true);
  });
});

describe('kbDiff', () => {
  it('refuses rather than fabricating a diff, since no real mechanism exists', () => {
    expect(() => kbDiff()).toThrow(ForgeError);
    try {
      kbDiff();
    } catch (error) {
      expect((error as ForgeError).code).toBe('USR-003');
    }
  });
});

describe('kbDisclose / kbDiscloseResolve / kbDisclosures (specs/22 M15 P10)', () => {
  it('records a real disclosure and reads it back as an open row through the merged ledger', async () => {
    const project = await createTestProject();
    const id = await kbDisclose(ctx(project), {
      kind: 'trade-off',
      summary: 'coverage is project-wide, not scoped to the story the bundle is for',
      owner: 'architect',
      sources: [{ kind: 'decision', ref: 'ADR-0011' }],
    });
    expect(id).toMatch(/^DISC-\d{3}$/);

    const ledger = await kbDisclosures(ctx(project));
    expect(ledger.entries).toEqual([
      expect.objectContaining({ id, kind: 'trade-off', open: true, synthesized: false }),
    ]);
  });

  it('resolving a real disclosure flips it to closed in the merged ledger, never removing it', async () => {
    const project = await createTestProject();
    const id = await kbDisclose(ctx(project), {
      kind: 'known-gap',
      summary: 'a real, disclosed gap',
      owner: 'architect',
      sources: [{ kind: 'human', ref: 'elicitation 2026-01-05' }],
    });
    await kbDiscloseResolve(ctx(project), { id, reason: 'closed the gap', by: 'architect' });

    const ledger = await kbDisclosures(ctx(project));
    expect(ledger.entries).toEqual([
      expect.objectContaining({ id, open: false, synthesized: false }),
    ]);
  });

  it('resolving an unknown id refuses with KB-018, not-found', async () => {
    const project = await createTestProject();
    await expect(
      kbDiscloseResolve(ctx(project), { id: 'DISC-999', reason: 'r', by: 'a' }),
    ).rejects.toMatchObject({ code: 'KB-018', details: { reason: 'not-found' } });
  });

  it('defaults reportsRoot to DEFAULT_CONFIG.paths.reports when the context leaves it unset, so an exemption still appears automatically', async () => {
    const project = await createTestProject();
    const { appendExemption } = await import('../../src/commands/loop/test/exemptions.ts');
    const { SYSTEM_CLOCK } = await import('@forge/core');
    await appendExemption(
      project.paths,
      'docs/forge/reports',
      SYSTEM_CLOCK,
      { testId: 'STORY-001: timing-guard', reason: 'r', owner: 'alice', expiry: '2099-01-01' },
      { projectRoot: project.dir, runId: undefined },
    );
    // `ctx(project)` above never sets `reportsRoot` -- the same unset shape every pre-existing test in
    // this file already uses for every OTHER context field this piece did not touch.
    const ledger = await kbDisclosures(ctx(project));
    expect(ledger.entries.find((entry) => entry.kind === 'exemption')).toMatchObject({
      open: true,
    });
  });
});
