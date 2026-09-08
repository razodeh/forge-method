/**
 * `selectStack` — `PLAN-M6.md` C5's own Checks section, including `12` §12.4's own worked example
 * reproduced against the real, shipped catalog.
 *
 * @see specs/12 §12.3
 * @see specs/12 §12.4
 * @see PLAN-M6.md C5
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadCatalogEntry } from '../../src/schema/load.ts';
import { CatalogRegistry } from '../../src/registry/registry.ts';
import { selectStack } from '../../src/select/select.ts';
import type { CatalogEntry } from '../../src/schema/types.ts';
import type { StackSelectionInput } from '../../src/select/types.ts';

const catalogRoot = path.resolve(import.meta.dirname, '../../catalog');

function loadRealRegistry(): CatalogRegistry {
  const entries: CatalogEntry[] = [];
  for (const kindDir of readdirSync(catalogRoot)) {
    const kindPath = path.join(catalogRoot, kindDir);
    for (const fileName of readdirSync(kindPath)) {
      const source = readFileSync(path.join(kindPath, fileName), 'utf8');
      const result = loadCatalogEntry(source, `${kindDir}/${fileName}`);
      if (!result.success) throw new Error(`${kindDir}/${fileName} failed to load`);
      entries.push(result.entry);
    }
  }
  return new CatalogRegistry(entries);
}

function makeEntry(overrides: Partial<CatalogEntry> & { id: string; kind: string }): CatalogEntry {
  return {
    name: overrides.id,
    category: 'test',
    maturity: 'mature',
    licence: 'MIT',
    strengths: ['a real strength'],
    weaknesses: ['a real weakness'],
    fits_when: ['condition one', 'condition two'],
    avoid_when: ['condition three', 'condition four'],
    operational_burden: 'low',
    team_familiarity_weight: 'medium',
    exit_cost: 'low',
    agent_friendliness: 'high',
    notes_for_agents: ['a real note'],
    ...overrides,
  };
}

function makeInput(overrides: Partial<StackSelectionInput> = {}): StackSelectionInput {
  return {
    constraints: { mandated: [], forbidden: [], teamSkills: [] },
    architectureStyle: '',
    accessPatterns: [],
    nfrs: [],
    deploymentTargets: [],
    level: 'L2',
    ...overrides,
  };
}

describe('selectStack -- small fixture registry', () => {
  it('records a mandated entry as the decision, with no scoring', () => {
    const registry = new CatalogRegistry([
      makeEntry({ id: 'mandated-lang', kind: 'language' }),
      makeEntry({ id: 'other-lang', kind: 'language', maturity: 'mature' }),
    ]);
    const result = selectStack(
      registry,
      makeInput({ constraints: { mandated: ['mandated-lang'], forbidden: [], teamSkills: [] } }),
    );
    const language = result.chosen.find((c) => c.catalogKind === 'language');
    expect(language?.entry.id).toBe('mandated-lang');
    expect(language?.reason.kind).toBe('mandated');
  });

  it('a forbidden entry is eliminated and never chosen, even if it would otherwise win on score', () => {
    const registry = new CatalogRegistry([
      makeEntry({ id: 'best', kind: 'auth', maturity: 'mature', agent_friendliness: 'high' }),
      makeEntry({ id: 'worse', kind: 'auth', maturity: 'legacy', agent_friendliness: 'low' }),
    ]);
    const result = selectStack(
      registry,
      makeInput({ constraints: { mandated: [], forbidden: ['best'], teamSkills: [] } }),
    );
    const auth = result.chosen.find((c) => c.catalogKind === 'auth');
    expect(auth?.entry.id).toBe('worse');
    expect(result.eliminated.some((r) => r.entry.id === 'best')).toBe(true);
  });

  it('a real pairs_with edge to an already-chosen entry wins over a higher-raw-score unrelated candidate', () => {
    const registry = new CatalogRegistry([
      makeEntry({ id: 'anchor', kind: 'language' }),
      makeEntry({
        id: 'coherent',
        kind: 'framework',
        pairs_with: ['anchor'],
        maturity: 'growing', // deliberately lower raw score than 'unrelated'
      }),
      makeEntry({
        id: 'unrelated',
        kind: 'framework',
        maturity: 'mature',
        operational_burden: 'low',
        agent_friendliness: 'high', // deliberately higher raw score, but no coherence edge
      }),
    ]);
    const result = selectStack(
      registry,
      makeInput({ constraints: { mandated: ['anchor'], forbidden: [], teamSkills: [] } }),
    );
    const framework = result.chosen.find((c) => c.catalogKind === 'framework');
    expect(framework?.entry.id).toBe('coherent');
  });

  it('an omitted kind (no candidates in the registry) simply has no ChosenEntry, not a thrown error', () => {
    const registry = new CatalogRegistry([makeEntry({ id: 'a', kind: 'language' })]);
    const result = selectStack(registry, makeInput());
    expect(result.chosen.every((c) => c.catalogKind !== 'datastore')).toBe(true);
  });

  it('propagates hard-rule flags for an emerging-maturity choice into the final result', () => {
    const registry = new CatalogRegistry([
      makeEntry({ id: 'risky', kind: 'frontend', maturity: 'emerging' }),
    ]);
    const result = selectStack(registry, makeInput());
    expect(
      result.hardRuleFlags.some((f) => f.rule === 'emerging-maturity' && f.entryId === 'risky'),
    ).toBe(true);
  });

  it('is deterministic: identical registry contents and input always produce the identical result', () => {
    const registry = new CatalogRegistry([
      makeEntry({ id: 'a', kind: 'language' }),
      makeEntry({ id: 'b', kind: 'framework', pairs_with: ['a'] }),
    ]);
    const input = makeInput({ constraints: { mandated: ['a'], forbidden: [], teamSkills: [] } });
    expect(selectStack(registry, input)).toEqual(selectStack(registry, input));
  });
});

describe("selectStack -- 12 §12.4's own worked example, reproduced against the real catalog", () => {
  const registry = loadRealRegistry();

  it("mandating typescript-js and postgresql (the worked example's own language/datastore choices) coherently selects the rest of the same TS ecosystem", () => {
    const input = makeInput({
      constraints: { mandated: ['typescript-js', 'postgresql'], forbidden: [], teamSkills: [] },
      architectureStyle: 'REST API',
      accessPatterns: ['high-throughput API'],
      level: 'L2',
    });

    const result = selectStack(registry, input);
    const byKind = new Map(result.chosen.map((c) => [c.catalogKind, c.entry.id]));

    // ADR-0009 (TypeScript + a Node framework), ADR-0010 (Next.js), ADR-0011 (PostgreSQL), ADR-0012
    // (an ORM pairing with PostgreSQL) -- reproduced in shape: both express and fastify have real,
    // mutual pairs_with edges to typescript-js and tie on coherence bonus, so the weighted-score
    // tiebreaker decides between them (express wins here on a real, higher team_familiarity_weight)
    // rather than pinning the exact worked-example framework choice, per the Checks text's own explicit
    // "not byte-for-byte... same reasoning shape" allowance.
    expect(byKind.get('language')).toBe('typescript-js');
    expect(['express', 'fastify', 'nestjs']).toContain(byKind.get('framework'));
    expect(byKind.get('frontend')).toBe('nextjs');
    expect(byKind.get('datastore')).toBe('postgresql');
    expect(byKind.get('orm')).toBe('prisma');

    // ADR-0013 (async work execution via a Postgres-backed queue, "pgboss") has no corresponding
    // catalog entry at all -- none of the 9 shipped queue-kind ids represent it, and fabricating one
    // would be scope creep beyond C1-C4's own scope-table-derived catalog. Only asserted to exist,
    // not to match a specific id.
    expect(byKind.has('queue')).toBe(true);

    // Real coherence grouping happened -- not just independent per-kind scoring.
    expect(result.coherenceScore).toBeGreaterThan(0);
    expect(result.hardRuleFlags).toEqual([]);
  });

  it('an emerging-maturity candidate in the real catalog, if chosen, is flagged -- not silently accepted', () => {
    // Force qwik (frontend, maturity: emerging in the real shipped catalog) to be the only frontend
    // candidate by mandating it directly, then confirm the hard-rule flag fires for real shipped data,
    // not just a synthetic fixture.
    const input = makeInput({
      constraints: { mandated: ['qwik'], forbidden: [], teamSkills: [] },
    });
    const result = selectStack(registry, input);
    expect(
      result.hardRuleFlags.some((f) => f.rule === 'emerging-maturity' && f.entryId === 'qwik'),
    ).toBe(true);
  });

  it('a forbidden-tech constraint removes every matching real candidate, naming each one and why', () => {
    const input = makeInput({
      constraints: { mandated: [], forbidden: ['fastify', 'express'], teamSkills: [] },
    });
    const result = selectStack(registry, input);
    const framework = result.chosen.find((c) => c.catalogKind === 'framework');
    expect(framework?.entry.id).not.toBe('fastify');
    expect(framework?.entry.id).not.toBe('express');
    const removedIds = result.eliminated.map((r) => r.entry.id);
    expect(removedIds).toContain('fastify');
    expect(removedIds).toContain('express');
  });

  it('is deterministic against the real catalog: identical input always produces the identical result', () => {
    const input = makeInput({
      constraints: { mandated: ['typescript-js'], forbidden: [], teamSkills: [] },
    });
    expect(selectStack(registry, input)).toEqual(selectStack(registry, input));
  });

  it('mandating two real primary languages selects both, and the L3-vs-other-level language-count hard rule fires against real selectStack output', () => {
    // A fresh critic round found that a first-draft version of selectStack capped every kind, including
    // `language`, at a single winner even for constraints.mandated -- making 12 §12.3's own "2 max at
    // L3" hard rule, and scoreCoherence's own runtime-count penalty, structurally unreachable through
    // the real orchestrator (only reachable via hand-built fixtures in coherence.test.ts/
    // hard-rules.test.ts, never through selectStack itself). Fixed to let every mandated entry of a kind
    // through, not just the first match. This test proves the fix through the real orchestrator, against
    // the real shipped catalog, not a synthetic fixture.
    const input = makeInput({
      constraints: {
        mandated: ['typescript-js', 'python', 'postgresql'],
        forbidden: [],
        teamSkills: [],
      },
      level: 'L2',
    });
    const result = selectStack(registry, input);
    const languages = result.chosen
      .filter((c) => c.catalogKind === 'language')
      .map((c) => c.entry.id)
      .sort();
    expect(languages).toEqual(['python', 'typescript-js']);
    expect(result.hardRuleFlags.some((f) => f.rule === 'primary-language-count')).toBe(true);

    const l3Result = selectStack(registry, { ...input, level: 'L3' });
    expect(l3Result.hardRuleFlags.some((f) => f.rule === 'primary-language-count')).toBe(false);
  });

  it('the runtime-count penalty in coherenceScore is reachable through real selectStack output: mandating two datastores produces a negative coherence contribution', () => {
    const withOneDatastore = selectStack(
      registry,
      makeInput({ constraints: { mandated: ['postgresql'], forbidden: [], teamSkills: [] } }),
    );
    const withTwoDatastores = selectStack(
      registry,
      makeInput({
        constraints: { mandated: ['postgresql', 'mysql-mariadb'], forbidden: [], teamSkills: [] },
      }),
    );
    // postgresql/mysql-mariadb are not mutually paired, so adding mysql-mariadb contributes at most a
    // small one-directional pairs_with edge elsewhere in the real catalog -- not enough to outweigh the
    // -2 runtime-count penalty a second datastore always incurs. The score still falls despite that
    // incidental edge, which is what actually proves the penalty fired (a scoped verify round confirmed
    // this by hand-auditing the real edge accounting: +1 edge, -2 penalty, net -1).
    expect(withTwoDatastores.coherenceScore).toBeLessThan(withOneDatastore.coherenceScore);
  });
});
