/**
 * `buildContextPack` — `05` §5.4's assembly of pinned core + declared inputs + retrieved context,
 * checked against `PLAN-M3.md` P9's own named Checks: structural retrieval always wins over lexical
 * and graph retrieval, lexical ranking uses P8's real search, graph expansion is 1-hop from the
 * *declared* inputs only, budget drops the lowest-ranked retrieved entry first and never touches
 * pinned core or declared inputs, the manifest carries ids/token-counts only, and the whole function is
 * deterministic.
 *
 * @see specs/05 §5.4
 * @see specs/21 §21
 * @see SPEC-QUESTIONS.md Q54
 * @see PLAN-M3.md P9
 */
import { isForgeError } from '@forge/core';
import { ProjectPaths } from '@forge/core/fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { JsonBackend } from '../../src/db/json-backend.ts';
import { rebuildIndex } from '../../src/db/rebuild.ts';
import type { KbIndexBackend, SearchHit } from '../../src/db/types.ts';
import { buildContextPack } from '../../src/pack/build-context-pack.ts';
import { estimateTokens } from '../../src/pack/estimate-tokens.ts';
import type { PackRequest } from '../../src/pack/types.ts';
import { parseKbTree, type KbParsedEntry, type KbTree } from '../../src/schema/tree.ts';

const FIXTURE_ROOT = path.resolve(import.meta.dirname, '../../../../fixtures/greenfield-service');

let scratchDirs: string[] = [];

function freshIndexPath(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'forge-kb-pack-'));
  scratchDirs.push(dir);
  return path.join(dir, 'index.json');
}

afterEach(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
  scratchDirs = [];
});

async function realTree(): Promise<KbTree> {
  const paths = new ProjectPaths(FIXTURE_ROOT);
  return parseKbTree(paths);
}

function realBackend(tree: KbTree): KbIndexBackend {
  const backend = new JsonBackend(freshIndexPath());
  rebuildIndex(tree, backend);
  return backend;
}

/** A backend whose `search`/`expand` return fixed, caller-supplied results and record every call —
 * used where a test needs to isolate `buildContextPack`'s own ranking/budget logic from P8's real
 * term-matching, or needs to observe exactly which ids/hop-count a call passed in. */
class FakeBackend implements KbIndexBackend {
  readonly expandCalls: { ids: readonly string[]; hops: number }[] = [];
  readonly searchCalls: string[] = [];
  private readonly searchHits: readonly SearchHit[];
  private readonly expandResult: readonly string[];

  constructor(searchHits: readonly SearchHit[], expandResult: readonly string[]) {
    this.searchHits = searchHits;
    this.expandResult = expandResult;
  }

  // buildContextPack only ever reads from a backend (search/expand) — it never writes to one, so
  // these are genuinely unused by every test in this file.
  upsertEntry(): void {
    void 0;
  }

  upsertLinks(): void {
    void 0;
  }

  search(query: string): readonly SearchHit[] {
    this.searchCalls.push(query);
    return this.searchHits;
  }

  expand(ids: readonly string[], hops: number): readonly string[] {
    this.expandCalls.push({ ids, hops });
    return this.expandResult;
  }

  clear(): void {
    void 0;
  }

  close(): void {
    void 0;
  }
}

describe('buildContextPack — structural retrieval (declared inputs)', () => {
  it('returns the full text of a declared input even when nothing lexical or graph-based would surface it', async () => {
    const tree = await realTree();
    const backend = realBackend(tree);
    const pack = buildContextPack(
      { declaredInputIds: ['RUN-001'], briefText: 'PostgreSQL container decomposition', budgetTokens: 100_000 },
      backend,
      tree,
    );
    expect(pack.declaredInputs).toHaveLength(1);
    expect(pack.declaredInputs[0]?.id).toBe('RUN-001');
    expect(pack.declaredInputs[0]?.content).toContain('## Symptoms');
  });

  it('throws KB-013 for a declared input id that does not exist in the KB tree', async () => {
    const tree = await realTree();
    const backend = realBackend(tree);
    let thrown: unknown;
    try {
      buildContextPack({ declaredInputIds: ['KB-NOPE-9999'], briefText: '', budgetTokens: 100_000 }, backend, tree);
    } catch (error) {
      thrown = error;
    }
    expect(isForgeError(thrown) && thrown.code === 'KB-013').toBe(true);
  });
});

describe('buildContextPack — lexical retrieval', () => {
  it('ranks an entry containing more of the brief\'s salient terms above one containing fewer, using the real backend search', async () => {
    const tree = await realTree();
    const backend = realBackend(tree);
    const pack = buildContextPack(
      { declaredInputIds: [], briefText: 'runtime service', budgetTokens: 100_000 },
      backend,
      tree,
    );
    // KB-CON-0001's body contains both "runtime" and "service"; KB-ARCH-0001's body and RUN-001's own
    // title each contain only "service" — tied at a lower score, broken by id ascending (both share
    // the same `updated` date).
    expect(pack.retrieved.map((entry) => entry.id)).toEqual(['KB-CON-0001', 'KB-ARCH-0001', 'RUN-001']);
    expect(pack.retrieved[0]?.score).toBeGreaterThan(pack.retrieved[1]?.score ?? Number.POSITIVE_INFINITY);
    expect(pack.retrieved[1]?.score).toBe(pack.retrieved[2]?.score);
  });
});

describe('buildContextPack — graph expansion', () => {
  it('pulls the 1-hop neighbours of a declared input (ADR-0001 links to its own diagram, DIAG-001)', async () => {
    const tree = await realTree();
    const backend = realBackend(tree);
    const pack = buildContextPack(
      { declaredInputIds: ['ADR-0001'], briefText: '', budgetTokens: 100_000 },
      backend,
      tree,
    );
    expect(pack.retrieved.map((entry) => entry.id)).toContain('DIAG-001');
    expect(pack.declaredInputs[0]?.content).toContain('## Context');
  });

  it('asks the backend to expand exactly the declared input ids, 1 hop — not every retrieved candidate', async () => {
    const tree = await realTree();
    const backend = new FakeBackend([], []);
    buildContextPack(
      { declaredInputIds: ['ADR-0001', 'RUN-001'], briefText: 'anything', budgetTokens: 100_000 },
      backend,
      tree,
    );
    expect(backend.expandCalls).toEqual([{ ids: ['ADR-0001', 'RUN-001'], hops: 1 }]);
  });

  it('breaks a relevance tie between two graph-only candidates by recency, then by id', async () => {
    const tree = await realTree();
    const adr = tree.entries.find(
      (entry): entry is Extract<KbParsedEntry, { kind: 'adr' }> => entry.kind === 'adr',
    );
    const diagram = tree.entries.find(
      (entry): entry is Extract<KbParsedEntry, { kind: 'diagram' }> => entry.kind === 'diagram',
    );
    if (adr === undefined || diagram === undefined) throw new Error('fixture missing adr/diagram');

    const older = { ...diagram, value: { ...diagram.value, id: 'TIE-OLDER', updated: '2026-01-01' } };
    const newer = { ...adr, value: { ...adr.value, id: 'TIE-NEWER', updated: '2026-06-01' } };
    const sameAgeA = { ...diagram, value: { ...diagram.value, id: 'TIE-SAME-B', updated: '2026-03-01' } };
    const sameAgeB = { ...adr, value: { ...adr.value, id: 'TIE-SAME-A', updated: '2026-03-01' } };
    const syntheticTree: KbTree = {
      entries: [...tree.entries, older, newer, sameAgeA, sameAgeB],
      errors: [],
    };

    const backend = new FakeBackend([], ['TIE-OLDER', 'TIE-NEWER', 'TIE-SAME-A', 'TIE-SAME-B']);
    const pack = buildContextPack({ declaredInputIds: [], briefText: '', budgetTokens: 100_000 }, backend, syntheticTree);

    // All four tie on score (0). Recency (updated desc) breaks first: NEWER, then the two SAME-age
    // entries (tied again, broken by id ascending), then OLDER last.
    expect(pack.retrieved.map((entry) => entry.id)).toEqual([
      'TIE-NEWER',
      'TIE-SAME-A',
      'TIE-SAME-B',
      'TIE-OLDER',
    ]);
  });

  it('breaks a full tie (score and recency) by id ascending, even when the pair is compared higher-id-first', async () => {
    const tree = await realTree();
    const adr = tree.entries.find(
      (entry): entry is Extract<KbParsedEntry, { kind: 'adr' }> => entry.kind === 'adr',
    );
    const diagram = tree.entries.find(
      (entry): entry is Extract<KbParsedEntry, { kind: 'diagram' }> => entry.kind === 'diagram',
    );
    if (adr === undefined || diagram === undefined) throw new Error('fixture missing adr/diagram');

    const higherId = { ...diagram, value: { ...diagram.value, id: 'TIE-Z', updated: '2026-03-01' } };
    const lowerId = { ...adr, value: { ...adr.value, id: 'TIE-A', updated: '2026-03-01' } };
    const syntheticTree: KbTree = { entries: [...tree.entries, higherId, lowerId], errors: [] };

    // The backend hands back the higher id first — the opposite of the final sorted order — so the
    // sort's very first comparator call sees (lower, higher) and must decide "lower belongs first"
    // itself, rather than happening to already be in that order.
    const backend = new FakeBackend([], ['TIE-Z', 'TIE-A']);
    const pack = buildContextPack({ declaredInputIds: [], briefText: '', budgetTokens: 100_000 }, backend, syntheticTree);

    expect(pack.retrieved.map((entry) => entry.id)).toEqual(['TIE-A', 'TIE-Z']);
  });

  it('silently skips a search hit naming an id this tree does not have, rather than throwing (a stale, not-yet-rebuilt index)', async () => {
    const tree = await realTree();
    const backend = new FakeBackend([{ id: 'KB-GHOST-0001', score: 5 }], []);
    const pack = buildContextPack(
      { declaredInputIds: [], briefText: 'anything', budgetTokens: 100_000 },
      backend,
      tree,
    );
    expect(pack.retrieved).toEqual([]);
  });
});

describe('buildContextPack — budget', () => {
  it('drops the lowest-ranked retrieved entry first, never touching pinned core or declared inputs, even at budgetTokens: 0', async () => {
    const tree = await realTree();
    const backend = realBackend(tree);
    const request: Omit<PackRequest, 'budgetTokens'> = {
      declaredInputIds: ['RUN-001'],
      briefText: 'runtime service',
    };

    const unconstrained = buildContextPack({ ...request, budgetTokens: 100_000 }, backend, tree);
    expect(unconstrained.retrieved.map((entry) => entry.id)).toEqual(['KB-CON-0001', 'KB-ARCH-0001']);

    const starved = buildContextPack({ ...request, budgetTokens: 0 }, backend, tree);
    expect(starved.retrieved).toEqual([]);
    expect(starved.declaredInputs).toEqual(unconstrained.declaredInputs);
    expect(starved.pinnedCore).toEqual(unconstrained.pinnedCore);
  });

  it('admits the higher-ranked candidate at a strictly smaller budget than the lower-ranked one needs', async () => {
    const tree = await realTree();
    const backend = realBackend(tree);
    const request: Omit<PackRequest, 'budgetTokens'> = {
      declaredInputIds: ['RUN-001'],
      briefText: 'runtime service',
    };

    function minimalBudgetFor(targetId: string): number {
      let lo = 0;
      let hi = 100_000;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        const pack = buildContextPack({ ...request, budgetTokens: mid }, backend, tree);
        if (pack.retrieved.some((entry) => entry.id === targetId)) hi = mid;
        else lo = mid + 1;
      }
      return lo;
    }

    const budgetForCon = minimalBudgetFor('KB-CON-0001');
    const budgetForArch = minimalBudgetFor('KB-ARCH-0001');
    expect(budgetForArch).toBeGreaterThan(budgetForCon);

    const atConBoundary = buildContextPack({ ...request, budgetTokens: budgetForCon }, backend, tree);
    expect(atConBoundary.retrieved.map((entry) => entry.id)).toEqual(['KB-CON-0001']);
  });

  it('drops every candidate ranked below one that does not fit, even a smaller one that would fit on its own — a rank-ordered prefix, not bin-packing (SPEC-QUESTIONS.md Q54)', async () => {
    const tree = await realTree();
    const diagram = tree.entries.find(
      (entry): entry is Extract<KbParsedEntry, { kind: 'diagram' }> => entry.kind === 'diagram',
    );
    if (diagram === undefined) throw new Error('fixture missing a diagram');

    // Both candidates are `diagram`-kind so pinned core (built from `adr`/`kb-entry` entries only)
    // stays entirely empty here — pinnedCoreTokens is exactly 0, so the budget below is exactly and
    // only "enough for SMALL, not BIG."
    const big = { ...diagram, value: { ...diagram.value, id: 'BIG', caption: 'x'.repeat(4000), alt_text: '' } };
    const small = { ...diagram, value: { ...diagram.value, id: 'SMALL', caption: 's', alt_text: '' } };
    const syntheticTree: KbTree = { entries: [big, small], errors: [] };

    const backend = new FakeBackend(
      [
        { id: 'BIG', score: 10 },
        { id: 'SMALL', score: 1 },
      ],
      [],
    );
    const budgetTokens = estimateTokens('s\n\n'); // exactly SMALL's own content, nothing more
    const pack = buildContextPack({ declaredInputIds: [], briefText: 'x', budgetTokens }, backend, syntheticTree);

    // SMALL alone would fit, but BIG outranks it and doesn't fit, so both are dropped.
    expect(pack.retrieved).toEqual([]);
  });
});

describe('buildContextPack — input validation', () => {
  it('deduplicates a caller-supplied declaredInputIds list, keeping first-occurrence order, so the budget and manifest never double-count one document', async () => {
    const tree = await realTree();
    const backend = realBackend(tree);
    const pack = buildContextPack(
      { declaredInputIds: ['RUN-001', 'RUN-001'], briefText: '', budgetTokens: 100_000 },
      backend,
      tree,
    );
    expect(pack.declaredInputs).toEqual([{ id: 'RUN-001', content: pack.declaredInputs[0]?.content }]);
    expect(pack.manifest.ids).toEqual(['RUN-001']);
    expect(Object.keys(pack.manifest.tokenCounts)).toEqual(['RUN-001']);
  });

  it('throws KB-014 for a NaN budgetTokens, rather than silently admitting every candidate regardless of size', async () => {
    const tree = await realTree();
    const backend = realBackend(tree);
    let thrown: unknown;
    try {
      buildContextPack({ declaredInputIds: [], briefText: '', budgetTokens: Number.NaN }, backend, tree);
    } catch (error) {
      thrown = error;
    }
    expect(isForgeError(thrown) && thrown.code === 'KB-014').toBe(true);
  });

  it('treats a non-finite score from the backend as 0, not NaN, keeping the final sort a genuine total order', async () => {
    const tree = await realTree();
    const backend = new FakeBackend(
      [
        { id: 'RUN-001', score: Number.NaN },
        { id: 'ADR-0001', score: 3 },
      ],
      [],
    );
    const pack = buildContextPack(
      { declaredInputIds: [], briefText: 'x', budgetTokens: 100_000 },
      backend,
      tree,
    );
    expect(pack.retrieved.map((entry) => entry.id)).toEqual(['ADR-0001', 'RUN-001']);
    expect(pack.retrieved.find((entry) => entry.id === 'RUN-001')?.score).toBe(0);
  });
});

describe('buildContextPack — manifest', () => {
  it('records exactly the included ids and each one\'s token count, and carries no content of its own', async () => {
    const tree = await realTree();
    const backend = realBackend(tree);
    const pack = buildContextPack(
      { declaredInputIds: ['RUN-001'], briefText: 'runtime service', budgetTokens: 100_000 },
      backend,
      tree,
    );

    expect(pack.manifest.ids).toEqual(['RUN-001', 'KB-CON-0001', 'KB-ARCH-0001']);
    expect(Object.keys(pack.manifest.tokenCounts).sort()).toEqual(
      ['KB-ARCH-0001', 'KB-CON-0001', 'RUN-001'].sort(),
    );
    expect(pack.manifest.tokenCounts['RUN-001']).toBe(estimateTokens(pack.declaredInputs[0]?.content ?? ''));
    expect(pack.manifest.tokenCounts['KB-CON-0001']).toBe(
      estimateTokens(pack.retrieved.find((entry) => entry.id === 'KB-CON-0001')?.content ?? ''),
    );

    // No entry's own body text leaks into the manifest itself.
    const manifestText = JSON.stringify(pack.manifest);
    expect(manifestText).not.toContain('transactional');
    expect(manifestText).not.toContain('Symptoms');
  });
});

describe('buildContextPack — determinism', () => {
  it('produces byte-identical output for an identical request against two independently rebuilt index states', async () => {
    const tree = await realTree();
    const request: PackRequest = {
      declaredInputIds: ['RUN-001', 'ADR-0001'],
      briefText: 'runtime service database',
      budgetTokens: 5_000,
    };

    const backendA = realBackend(tree);
    const packA = buildContextPack(request, backendA, tree);

    const backendB = realBackend(tree);
    const packB = buildContextPack({ ...request }, backendB, tree);

    expect(JSON.stringify(packA)).toBe(JSON.stringify(packB));
  });
});

describe('buildContextPack — benchmark (informational, not a gate)', () => {
  it('assembles a pack over a ~500-entry synthetic KB well inside 21 §21\'s 300ms figure', async () => {
    const tree = await realTree();
    const template = tree.entries.find(
      (entry): entry is Extract<KbParsedEntry, { kind: 'kb-entry' }> => entry.kind === 'kb-entry',
    );
    if (template === undefined) throw new Error('fixture missing a kb-entry template');

    const synthetic: KbParsedEntry[] = [];
    for (let index = 0; index < 500; index += 1) {
      synthetic.push({
        ...template,
        path: `synthetic/entry-${String(index)}.md`,
        value: {
          ...template.value,
          id: `KB-SYN-${String(index).padStart(4, '0')}`,
          title: `Synthetic entry ${String(index)}`,
        },
      });
    }
    const bigTree: KbTree = { entries: [...tree.entries, ...synthetic], errors: [] };
    const backend = realBackend(bigTree);

    const start = performance.now();
    const pack = buildContextPack(
      { declaredInputIds: ['RUN-001'], briefText: 'runtime service database', budgetTokens: 10_000 },
      backend,
      bigTree,
    );
    const durationMs = performance.now() - start;

    expect(pack.declaredInputs).toHaveLength(1);
    // Informational per PLAN-M3.md P9: recorded, not enforced at exactly 300ms — a generous ceiling
    // here only catches a catastrophic algorithmic regression, not ordinary machine variance.
    // eslint-disable-next-line no-console -- deliberate benchmark reporting, not leftover debugging.
    console.info(`buildContextPack over ${String(bigTree.entries.length)} entries took ${durationMs.toFixed(2)}ms`);
    expect(durationMs).toBeLessThan(2_000);
  });
});
