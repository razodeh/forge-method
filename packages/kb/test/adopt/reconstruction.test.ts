/**
 * `writeReconstruction` and its pure assembly helpers — `17` §17.2 phase 6 (RECONSTRUCTION).
 *
 * `PLAN-M10.md` P18's own three Checks, each with a dedicated test below: (1) a full RECONSTRUCTION
 * run produces a KB whose layout/entry-schema is indistinguishable from a greenfield one (every
 * written file parses cleanly via the real `parseKbTree`); (2) every generated diagram's own `depicts`
 * set traces back to a real id this test's own fixture input actually produced, never a fabricated
 * one; (3) every retroactive ADR carries `status: accepted`, `framework: reconstructed`, and an
 * inferred-context body stating the original decision date is unknown.
 *
 * @see specs/17 §17.2
 * @see PLAN-M10.md P18
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Clock } from '@forge/core';
import { ProjectPaths } from '@forge/core/fs';
import { afterEach, describe, expect, it } from 'vitest';

import type { CartographyFinding, CartographyResult } from '../../src/adopt/cartography.ts';
import type { DependencyGraph } from '../../src/adopt/inventory.ts';
import type { InferenceFinding, InferenceResult } from '../../src/adopt/inference.ts';
import {
  architectureEntries,
  dataEntries,
  deliveryEntries,
  deriveComponents,
  deriveRetroactiveAdrCandidates,
  engineeringStandardsEntry,
  indexVerificationOverrides,
  productEntries,
  RECONSTRUCTION_OWNER,
  slugify,
  toComponentsToC4Input,
  toDepsToGraphInput,
  toSchemaIntrospectToErInput,
  writeReconstruction,
  type ReconstructionInput,
} from '../../src/adopt/reconstruction.ts';
import type { VerificationResult } from '../../src/adopt/verification.ts';
import { parseKbTree } from '../../src/schema/tree.ts';
import { kbEntrySchema } from '../../src/schema/kb-entry.ts';

function fakeClock(startIso = '2026-02-01T00:00:00.000Z'): Clock {
  let current = new Date(startIso).getTime();
  return {
    now: () => {
      const iso = new Date(current).toISOString();
      current += 1000;
      return iso;
    },
  };
}

let dir: string | undefined;

afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

async function freshProject(): Promise<ProjectPaths> {
  dir = await mkdtemp(path.join(tmpdir(), 'forge-kb-reconstruction-'));
  return new ProjectPaths(dir);
}

const DEPENDENCY_GRAPH: DependencyGraph = {
  nodes: [
    { module: 'src/api', imports: ['src/db'] },
    { module: 'src/worker', imports: ['src/db'] },
    { module: 'src/db', imports: [] },
  ],
  cycles: [],
};

const API_COMPONENT_STATEMENT = 'An API component handles HTTP requests.';
const WORKER_COMPONENT_STATEMENT = 'A worker component processes background jobs.';
const DB_COMPONENT_STATEMENT = 'A database access component wraps Postgres.';
const LAYERING_STATEMENT =
  'The API component never writes to the database directly; only the worker does.';
const SHARED_TABLE_STATEMENT_WORKER = 'The jobs table is owned by the worker component.';
const SHARED_TABLE_STATEMENT_API = 'The jobs table is also written by the api component.';

function cartographyFindings(): readonly CartographyFinding[] {
  return [
    {
      kind: 'component',
      statement: API_COMPONENT_STATEMENT,
      evidence: [{ kind: 'path', path: 'src/api.ts' }],
      confidence: 'high',
    },
    {
      kind: 'component',
      statement: WORKER_COMPONENT_STATEMENT,
      evidence: [{ kind: 'path', path: 'src/worker.ts' }],
      confidence: 'medium',
    },
    {
      kind: 'component',
      statement: DB_COMPONENT_STATEMENT,
      evidence: [{ kind: 'path', path: 'src/db.ts' }],
      confidence: 'high',
    },
    {
      kind: 'layering',
      statement: LAYERING_STATEMENT,
      evidence: [{ kind: 'path', path: 'src/api.ts' }],
      confidence: 'medium',
    },
    {
      kind: 'data-ownership',
      statement: SHARED_TABLE_STATEMENT_WORKER,
      evidence: [{ kind: 'path', path: 'src/worker.ts' }],
      confidence: 'medium',
      table: 'jobs',
      owner: 'worker',
    },
    {
      kind: 'data-ownership',
      statement: SHARED_TABLE_STATEMENT_API,
      evidence: [{ kind: 'path', path: 'src/api.ts' }],
      confidence: 'low',
      table: 'jobs',
      owner: 'api',
    },
  ];
}

function cartographyResult(): CartographyResult {
  const findings = cartographyFindings();
  return {
    findings,
    rejected: [],
    sharedWriteTables: [{ table: 'jobs', owners: ['api', 'worker'] }],
  };
}

const CONVENTION_STATEMENT = 'Route handlers return typed responses.';
const INTENT_STATEMENT = 'The system appears to let users submit background jobs via HTTP.';

function inferenceFindings(): readonly InferenceFinding[] {
  return [
    {
      kind: 'convention',
      statement: CONVENTION_STATEMENT,
      evidence: [{ kind: 'path', path: 'src/api.ts' }],
      confidence: 'medium',
      status: 'draft',
      adherenceRatio: '8 of 10',
    },
    {
      kind: 'intent',
      statement: INTENT_STATEMENT,
      evidence: [{ kind: 'path', path: 'src/api.ts' }],
      confidence: 'medium',
      status: 'draft',
    },
  ];
}

function inferenceResult(): InferenceResult {
  return { findings: inferenceFindings(), rejected: [] };
}

function verificationResult(): VerificationResult {
  return {
    findings: [
      {
        kind: 'call-graph',
        subject: { origin: 'cartography', statement: API_COMPONENT_STATEMENT },
        outcome: 'pass',
        detail: 'every cited evidence entry still resolves against a fresh SURVEY/INVENTORY pass.',
        measuredAt: '2026-02-01T00:00:00.000Z',
        promotion: 'verified',
        confidenceAfter: 'verified',
      },
      {
        kind: 'schema',
        subject: { origin: 'cartography', statement: SHARED_TABLE_STATEMENT_API },
        outcome: 'fail',
        detail: 'evidence no longer resolves against a fresh SURVEY/INVENTORY pass: src/api.ts',
        measuredAt: '2026-02-01T00:00:00.000Z',
        promotion: 'downgraded',
        confidenceAfter: 'low',
      },
      {
        kind: 'build',
        subject: { origin: 'repository', statement: 'repository' },
        outcome: 'pass',
        detail: '"npm run build" exited 0.',
        command: 'npm run build',
        measuredAt: '2026-02-01T00:00:00.000Z',
        promotion: 'verified',
        confidenceAfter: 'verified',
      },
      {
        kind: 'test',
        subject: { origin: 'repository', statement: 'repository' },
        outcome: 'fail',
        detail: '"npm test" exited 1: 2 tests failed.',
        command: 'npm test',
        measuredAt: '2026-02-01T00:00:00.000Z',
        promotion: 'downgraded',
      },
    ],
    gaps: [],
  };
}

function fullInput(): ReconstructionInput {
  return {
    cartography: cartographyResult(),
    inference: inferenceResult(),
    verification: verificationResult(),
    dependencyGraph: DEPENDENCY_GRAPH,
  };
}

// ---- pure helpers -----------------------------------------------------------------------------

describe('slugify', () => {
  it('lowercases, hyphenates, and never starts with a digit or hyphen', () => {
    expect(slugify('An API Component!')).toBe('an-api-component');
    expect(slugify('3 tables shared')).toBe('c-3-tables-shared');
    expect(slugify('...')).toBe('component');
  });

  it('strips every path-escape and separator character out of an LLM-influenced statement -- never lets one through into a file path', () => {
    // `finding.statement` is LLM-influenced text, and slugify's own output becomes a KB-entry file
    // path segment (`uniquePath`) -- neither a `..` traversal segment nor a raw `/` or backslash may
    // survive into it, on a POSIX or a Windows-shaped input.
    expect(slugify('../../../etc/passwd')).not.toContain('/');
    expect(slugify('../../../etc/passwd')).not.toContain('..');
    expect(slugify('C:\\Windows\\System32')).not.toMatch(/[\\/:]/);
    expect(slugify('..')).toBe('component');
  });
});

describe('deriveComponents', () => {
  it('derives one component per finding with dependsOn computed from the real dependency graph, never fabricated', () => {
    const { components, componentIdByStatement, moduleOwner } = deriveComponents(
      cartographyFindings(),
      DEPENDENCY_GRAPH,
    );
    expect(components).toHaveLength(3);
    const api = components.find((c) => c.label === API_COMPONENT_STATEMENT);
    const worker = components.find((c) => c.label === WORKER_COMPONENT_STATEMENT);
    const db = components.find((c) => c.label === DB_COMPONENT_STATEMENT);
    expect(api).toBeDefined();
    expect(worker).toBeDefined();
    expect(db).toBeDefined();
    // Both api and worker import src/db, which only the db component's own evidence claims -- a
    // real, traceable cross-component edge, not a guess.
    expect(api?.dependsOn).toEqual([db?.id]);
    expect(worker?.dependsOn).toEqual([db?.id]);
    // The db component itself imports nothing.
    expect(db?.dependsOn).toEqual([]);
    expect(api?.owner).toBe(RECONSTRUCTION_OWNER);
    expect(api?.failureModes).toEqual([]);
    expect(componentIdByStatement.get(API_COMPONENT_STATEMENT)).toBe(api?.id);
    expect(moduleOwner.get('src/db')).toBe(db?.id);
  });

  it('never invents an edge to a module no component claims', () => {
    const { components } = deriveComponents(
      [
        {
          kind: 'component',
          statement: 'A lone component.',
          evidence: [{ kind: 'path', path: 'src/lonely.ts' }],
          confidence: 'high',
        },
      ],
      { nodes: [{ module: 'src/lonely', imports: ['src/unclaimed'] }], cycles: [] },
    );
    expect(components).toHaveLength(1);
    expect(components[0]?.dependsOn).toEqual([]);
  });

  it('deduplicates two components that would otherwise slugify to the same id', () => {
    const { components } = deriveComponents(
      [
        {
          kind: 'component',
          statement: 'Same!',
          evidence: [{ kind: 'path', path: 'a.ts' }],
          confidence: 'high',
        },
        {
          kind: 'component',
          statement: 'Same?',
          evidence: [{ kind: 'path', path: 'b.ts' }],
          confidence: 'high',
        },
      ],
      { nodes: [], cycles: [] },
    );
    expect(new Set(components.map((c) => c.id)).size).toBe(2);
  });
});

describe('generator input projections', () => {
  it('toComponentsToC4Input is a lossless id/label/dependsOn projection', () => {
    const { components } = deriveComponents(cartographyFindings(), DEPENDENCY_GRAPH);
    const input = toComponentsToC4Input(components);
    expect(input.components).toHaveLength(components.length);
    for (const c of components) {
      expect(input.components.find((i) => i.id === c.id)).toEqual({
        id: c.id,
        label: c.label,
        dependsOn: c.dependsOn,
      });
    }
  });

  it('toDepsToGraphInput maps DependencyGraphNode.module/imports directly, one to one', () => {
    expect(toDepsToGraphInput(DEPENDENCY_GRAPH)).toEqual({
      modules: [
        { name: 'src/api', dependsOn: ['src/db'] },
        { name: 'src/worker', dependsOn: ['src/db'] },
        { name: 'src/db', dependsOn: [] },
      ],
    });
  });

  it('toSchemaIntrospectToErInput takes only real data-ownership tables, never invents columns or foreign keys', () => {
    const input = toSchemaIntrospectToErInput(cartographyFindings());
    expect(input.tables).toEqual([{ name: 'jobs', columns: [] }]);
    expect(input.foreignKeys).toEqual([]);
  });

  it('produces no tables at all when CARTOGRAPHY found no data-ownership claims', () => {
    expect(toSchemaIntrospectToErInput([])).toEqual({ tables: [], foreignKeys: [] });
  });
});

describe('indexVerificationOverrides', () => {
  it('indexes only cartography/inference-origin promotions with a real confidence change, never repository-origin ones', () => {
    const overrides = indexVerificationOverrides(verificationResult());
    expect(overrides.get('cartography:' + API_COMPONENT_STATEMENT)?.confidenceAfter).toBe(
      'verified',
    );
    expect(overrides.get('cartography:' + SHARED_TABLE_STATEMENT_API)?.confidenceAfter).toBe('low');
    // Neither repository-origin check (build/test) is indexed under any statement key at all.
    expect(overrides.size).toBe(2);
  });
});

const TODAY = '2026-02-01';
const REVIEW_BY = '2026-03-03';

describe('architectureEntries', () => {
  it('includes component/layering kinds, excludes data-ownership, and carries verification overrides', () => {
    const overrides = indexVerificationOverrides(verificationResult());
    const { componentIdByStatement } = deriveComponents(cartographyFindings(), DEPENDENCY_GRAPH);
    const used = new Set<string>();
    const entries = architectureEntries(
      cartographyFindings(),
      overrides,
      componentIdByStatement,
      ['DIAG-001'],
      TODAY,
      REVIEW_BY,
      used,
    );
    // 3 components + 1 layering, no data-ownership.
    expect(entries).toHaveLength(4);
    const api = entries.find((e) => e.title === API_COMPONENT_STATEMENT);
    expect(api?.confidence).toBe('verified');
    expect(api?.body).toContain('## Verification');
    expect(api?.diagrams).toEqual(['DIAG-001']);
    expect(api?.applies_to).toEqual([componentIdByStatement.get(API_COMPONENT_STATEMENT)]);

    const worker = entries.find((e) => e.title === WORKER_COMPONENT_STATEMENT);
    // No override for the worker's own statement -- confidence is carried forward unchanged.
    expect(worker?.confidence).toBe('medium');

    expect(entries.some((e) => e.title === SHARED_TABLE_STATEMENT_WORKER)).toBe(false);
  });

  it('every produced entry is schema-valid at every confidence level it can carry, including "verified"', () => {
    const overrides = indexVerificationOverrides(verificationResult());
    const { componentIdByStatement } = deriveComponents(cartographyFindings(), DEPENDENCY_GRAPH);
    const used = new Set<string>();
    const entries = architectureEntries(
      cartographyFindings(),
      overrides,
      componentIdByStatement,
      [],
      TODAY,
      REVIEW_BY,
      used,
    );
    for (const entry of entries) {
      const rest: Record<string, unknown> = { ...entry };
      delete rest['path'];
      const parsed = kbEntrySchema.safeParse({
        ...rest,
        id: 'KB-ARCH-0001',
        created: TODAY,
        updated: TODAY,
      });
      expect(parsed.success).toBe(true);
    }
  });

  it('never collides two entries onto the same path', () => {
    const used = new Set<string>();
    const entries = architectureEntries(
      [
        {
          kind: 'component',
          statement: 'Same!',
          evidence: [{ kind: 'path', path: 'a.ts' }],
          confidence: 'high',
        },
        {
          kind: 'component',
          statement: 'Same?',
          evidence: [{ kind: 'path', path: 'b.ts' }],
          confidence: 'high',
        },
      ],
      new Map(),
      new Map(),
      [],
      TODAY,
      REVIEW_BY,
      used,
    );
    expect(new Set(entries.map((e) => e.path)).size).toBe(2);
  });

  it('cites an evidence line number in the body when one is present', () => {
    const used = new Set<string>();
    const entries = architectureEntries(
      [
        {
          kind: 'component',
          statement: 'A thing at a specific line.',
          evidence: [{ kind: 'path', path: 'src/thing.ts', line: 12 }],
          confidence: 'medium',
        },
      ],
      new Map(),
      new Map(),
      [],
      TODAY,
      REVIEW_BY,
      used,
    );
    expect(entries[0]?.body).toContain('src/thing.ts:12');
    expect(entries[0]?.sources[0]).toEqual({ kind: 'code', ref: 'src/thing.ts:12' });
  });

  it('falls back to listing its own evidence in the Verification section for a "verified" claim VERIFICATION never re-checked', () => {
    const used = new Set<string>();
    const entries = architectureEntries(
      [
        {
          kind: 'component',
          statement: 'Already claimed verified with no VERIFICATION-phase backing.',
          evidence: [{ kind: 'path', path: 'src/thing.ts' }],
          confidence: 'verified',
        },
      ],
      new Map(),
      new Map(),
      [],
      TODAY,
      REVIEW_BY,
      used,
    );
    expect(entries[0]?.confidence).toBe('verified');
    expect(entries[0]?.body).toContain('Supported by the following evidence from SURVEY/INVENTORY');
  });
});

describe('dataEntries', () => {
  it('aggregates every owner of a shared-write table and reports the worst resolved confidence', () => {
    const overrides = indexVerificationOverrides(verificationResult());
    const used = new Set<string>();
    const entries = dataEntries(cartographyFindings(), overrides, [], TODAY, REVIEW_BY, used);
    expect(entries).toHaveLength(1);
    const jobsEntry = entries[0];
    expect(jobsEntry?.title).toBe('Table: jobs');
    expect(jobsEntry?.body).toContain('api');
    expect(jobsEntry?.body).toContain('worker');
    // worker's own claim resolves to 'medium' (no override); api's own claim is downgraded to 'low'
    // by VERIFICATION -- the aggregate must report the worse of the two, never the better.
    expect(jobsEntry?.confidence).toBe('low');
    expect(jobsEntry?.body).toContain('More than one component writes this table');
  });

  it('produces nothing when CARTOGRAPHY found no data-ownership claims', () => {
    expect(dataEntries([], new Map(), [], TODAY, REVIEW_BY, new Set())).toEqual([]);
  });

  it('reports a single-owner table without the shared-write note, and reports the worst of three confidences even when the worse one comes later', () => {
    const findings: CartographyFinding[] = [
      {
        kind: 'data-ownership',
        statement: 'a',
        evidence: [{ kind: 'path', path: 'a.ts' }],
        confidence: 'low',
        table: 'solo',
        owner: 'api',
      },
      {
        kind: 'data-ownership',
        statement: 'b',
        evidence: [{ kind: 'path', path: 'b.ts' }],
        confidence: 'medium',
        table: 'solo',
        owner: 'api',
      },
      {
        kind: 'data-ownership',
        statement: 'c',
        evidence: [{ kind: 'path', path: 'c.ts' }],
        confidence: 'high',
        table: 'solo',
        owner: 'api',
      },
    ];
    const entries = dataEntries(findings, new Map(), [], TODAY, REVIEW_BY, new Set());
    expect(entries).toHaveLength(1);
    expect(entries[0]?.confidence).toBe('low');
    expect(entries[0]?.body).toContain('Exactly one component writes this table');
  });

  it('names the table as unidentified when no finding carries a real owner string', () => {
    const entries = dataEntries(
      [
        {
          kind: 'data-ownership',
          statement: 'x',
          evidence: [{ kind: 'fact', description: 'y' }],
          confidence: 'low',
          table: 'orphan',
        },
      ],
      new Map(),
      [],
      TODAY,
      REVIEW_BY,
      new Set(),
    );
    expect(entries[0]?.body).toContain('an unidentified component');
  });

  it('omits the Verification section when VERIFICATION never re-checked any finding for this table', () => {
    const entries = dataEntries(
      [
        {
          kind: 'data-ownership',
          statement: 'never verified',
          evidence: [{ kind: 'path', path: 'z.ts' }],
          confidence: 'medium',
          table: 'unverified_table',
          owner: 'api',
        },
      ],
      new Map(),
      [],
      TODAY,
      REVIEW_BY,
      new Set(),
    );
    expect(entries[0]?.body).not.toContain('## Verification');
  });
});

describe('deliveryEntries', () => {
  it('writes one entry per repository-origin check, "low" confidence for a failed check VERIFICATION never promoted', () => {
    const used = new Set<string>();
    const entries = deliveryEntries(verificationResult(), TODAY, REVIEW_BY, used);
    expect(entries).toHaveLength(2);
    const build = entries.find((e) => e.title.startsWith('Build command'));
    const test = entries.find((e) => e.title.startsWith('Test suite'));
    expect(build?.confidence).toBe('verified');
    expect(build?.body).toContain('npm run build');
    expect(test?.confidence).toBe('low');
    expect(test?.body).toContain('2 tests failed');
  });

  it('falls back to a generic "<kind> check" title and a fact-based evidence citation when no command was run', () => {
    const entries = deliveryEntries(
      {
        findings: [
          {
            kind: 'pipeline',
            subject: { origin: 'repository', statement: 'repository' },
            outcome: 'inconclusive',
            detail: 'no CI config with a last-run status was found.',
            measuredAt: '2026-02-01T00:00:00.000Z',
            promotion: 'unchanged',
          },
        ],
        gaps: [],
      },
      TODAY,
      REVIEW_BY,
      new Set(),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.title).toBe('pipeline check (reconstructed)');
    expect(entries[0]?.confidence).toBe('low');
    expect(entries[0]?.sources[0]?.ref).toContain('verification:pipeline@');
    expect(entries[0]?.body).not.toContain('Command:');
  });
});

describe('engineeringStandardsEntry', () => {
  it('aggregates every convention finding into one entry with its own real adherence ratio', () => {
    const overrides = new Map();
    const entry = engineeringStandardsEntry(
      inferenceFindings(),
      overrides,
      TODAY,
      REVIEW_BY,
      new Set(),
    );
    expect(entry?.path).toBe('engineering/standards.md');
    expect(entry?.body).toContain('8 of 10');
    expect(entry?.confidence).toBe('medium');
    expect(entry?.status).toBe('draft');
  });

  it('is undefined when there are no convention findings at all -- never writes an empty file', () => {
    expect(
      engineeringStandardsEntry(
        [
          {
            kind: 'intent',
            statement: 'x',
            evidence: [{ kind: 'fact', description: 'y' }],
            confidence: 'low',
            status: 'draft',
          },
        ],
        new Map(),
        TODAY,
        REVIEW_BY,
        new Set(),
      ),
    ).toBeUndefined();
  });

  it('lists a convention with no adherence ratio plainly, with no trailing "(...)"', () => {
    const entry = engineeringStandardsEntry(
      [
        {
          kind: 'convention',
          statement: 'No ratio was ever counted for this one.',
          evidence: [{ kind: 'path', path: 'x.ts' }],
          confidence: 'low',
          status: 'draft',
        },
      ],
      new Map(),
      TODAY,
      REVIEW_BY,
      new Set(),
    );
    expect(entry?.body).toContain('- No ratio was ever counted for this one.\n');
  });

  it('includes a real VERIFICATION re-check detail in its own Verification section when one exists', () => {
    const statement = 'A convention VERIFICATION actually re-counted.';
    const overrides = indexVerificationOverrides({
      findings: [
        {
          kind: 'convention',
          subject: { origin: 'inference', statement },
          outcome: 'pass',
          detail: 're-counted adherence ratio is 5 of 5, consistent with the claim.',
          measuredAt: '2026-02-01T00:00:00.000Z',
          promotion: 'verified',
          confidenceAfter: 'verified',
        },
      ],
      gaps: [],
    });
    const entry = engineeringStandardsEntry(
      [
        {
          kind: 'convention',
          statement,
          evidence: [{ kind: 'path', path: 'x.ts' }],
          confidence: 'medium',
          status: 'draft',
          adherenceRatio: '5 of 5',
        },
      ],
      overrides,
      TODAY,
      REVIEW_BY,
      new Set(),
    );
    expect(entry?.confidence).toBe('verified');
    expect(entry?.body).toContain('re-counted adherence ratio is 5 of 5');
  });
});

describe('productEntries', () => {
  it("forces confidence: low regardless of the underlying INFERENCE finding's own confidence", () => {
    const entries = productEntries(inferenceFindings(), TODAY, REVIEW_BY, new Set());
    expect(entries).toHaveLength(1);
    expect(entries[0]?.confidence).toBe('low');
    expect(entries[0]?.status).toBe('draft');
  });
});

describe('deriveRetroactiveAdrCandidates', () => {
  it('takes only layering findings and computes a real, evidence-traced blast radius', () => {
    const { moduleOwner } = deriveComponents(cartographyFindings(), DEPENDENCY_GRAPH);
    const candidates = deriveRetroactiveAdrCandidates(cartographyFindings(), moduleOwner);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.statement).toBe(LAYERING_STATEMENT);
    // The layering finding's own evidence names src/api.ts -- the api component's own module.
    const { componentIdByStatement } = deriveComponents(cartographyFindings(), DEPENDENCY_GRAPH);
    expect(candidates[0]?.blastRadius).toEqual([
      componentIdByStatement.get(API_COMPONENT_STATEMENT),
    ]);
  });
});

// ---- end-to-end write ---------------------------------------------------------------------------

describe('writeReconstruction', () => {
  it('writes a full, schema-valid KB tree with no parse errors -- indistinguishable in layout from a greenfield KB', async () => {
    const paths = await freshProject();
    const result = await writeReconstruction({ paths, clock: fakeClock() }, fullInput());

    expect(result.componentIds).toHaveLength(3);
    expect(result.diagramIds.length).toBeGreaterThan(0);
    expect(result.kbEntryIds.length).toBeGreaterThan(0);
    expect(result.adrIds).toHaveLength(1);

    const tree = await parseKbTree(paths, 'docs/forge/kb');
    expect(tree.errors).toEqual([]);
    expect(tree.entries.length).toBeGreaterThan(0);

    // Every real KB_SECTIONS-shaped section this piece can write only ever produces files under
    // architecture/, data/, delivery/, engineering/, product/, or decisions/ -- the exact greenfield
    // layout (08 §8.2), never a made-up directory of its own.
    const allowedTopLevel = new Set([
      'architecture',
      'data',
      'delivery',
      'engineering',
      'product',
      'decisions',
    ]);
    for (const entry of tree.entries) {
      const top = entry.path.split('/')[0];
      expect(allowedTopLevel.has(top ?? '')).toBe(true);
    }

    const componentsFile = tree.entries.find((e) => e.path === 'architecture/components.md');
    expect(componentsFile?.kind).toBe('components-file');
  });

  it("every generated diagram's own depicts set traces back to a real id this run actually produced, never fabricated", async () => {
    const paths = await freshProject();
    await writeReconstruction({ paths, clock: fakeClock() }, fullInput());
    const tree = await parseKbTree(paths, 'docs/forge/kb');
    const diagrams = tree.entries.filter(
      (e): e is Extract<(typeof tree.entries)[number], { kind: 'diagram' }> => e.kind === 'diagram',
    );
    expect(diagrams.length).toBeGreaterThanOrEqual(3);

    const { components } = deriveComponents(cartographyFindings(), DEPENDENCY_GRAPH);
    const realComponentIds = new Set(components.map((c) => c.id));
    const realModuleNames = new Set(DEPENDENCY_GRAPH.nodes.map((n) => n.module));
    const realTableNames = new Set(['jobs']);

    const c4 = diagrams.find((d) => d.value.generator === 'components-to-c4');
    const deps = diagrams.find((d) => d.value.generator === 'deps-to-graph');
    const er = diagrams.find((d) => d.value.generator === 'schema-introspect-to-er');
    expect(c4).toBeDefined();
    expect(deps).toBeDefined();
    expect(er).toBeDefined();

    if (c4 !== undefined) {
      expect(c4.value.depicts.length).toBeGreaterThan(0);
      for (const id of c4.value.depicts) expect(realComponentIds.has(id)).toBe(true);
    }
    if (deps !== undefined) {
      for (const name of deps.value.depicts) expect(realModuleNames.has(name)).toBe(true);
    }
    if (er !== undefined) {
      for (const name of er.value.depicts) expect(realTableNames.has(name)).toBe(true);
    }
  });

  it('writes a retroactive ADR carrying status: accepted, framework: reconstructed, and an inferred, unknown-date context -- never presented as an original ADR', async () => {
    const paths = await freshProject();
    await writeReconstruction({ paths, clock: fakeClock() }, fullInput());
    const tree = await parseKbTree(paths, 'docs/forge/kb');
    const adr = tree.entries.find((e) => e.kind === 'adr');
    expect(adr).toBeDefined();
    if (adr?.kind !== 'adr') throw new Error('expected an adr entry');
    expect(adr.value.status).toBe('accepted');
    expect(adr.value.framework).toBe('reconstructed');
    expect(adr.body.toLowerCase()).toContain('original decision date is unknown');
    expect(adr.value.title).toContain(LAYERING_STATEMENT);
  });

  it("forces product entries to confidence: low even at the KbWriter layer (a structural ceiling, not just this module's own default)", async () => {
    const paths = await freshProject();
    await writeReconstruction({ paths, clock: fakeClock() }, fullInput());
    const tree = await parseKbTree(paths, 'docs/forge/kb');
    const product = tree.entries.find((e) => e.path.startsWith('product/'));
    expect(product).toBeDefined();
    if (product?.kind === 'kb-entry') {
      expect(product.value.confidence).toBe('low');
      expect(product.value.section).toBe('product');
    }
  });

  it('skips the schema-introspect-to-er diagram entirely when CARTOGRAPHY found no data-ownership claims -- never a fabricated placeholder diagram', async () => {
    const paths = await freshProject();
    const input: ReconstructionInput = {
      cartography: {
        findings: cartographyFindings().filter((f) => f.kind !== 'data-ownership'),
        rejected: [],
        sharedWriteTables: [],
      },
      inference: inferenceResult(),
      verification: verificationResult(),
      dependencyGraph: DEPENDENCY_GRAPH,
    };
    const result = await writeReconstruction({ paths, clock: fakeClock() }, input);
    const tree = await parseKbTree(paths, 'docs/forge/kb');
    const er = tree.entries.find(
      (e) => e.kind === 'diagram' && e.value.generator === 'schema-introspect-to-er',
    );
    expect(er).toBeUndefined();
    expect(result.diagramIds.length).toBe(2);
  });

  it('reports "none identified" in a retroactive ADR whose layering evidence touches no known component', async () => {
    const paths = await freshProject();
    await writeReconstruction(
      { paths, clock: fakeClock() },
      {
        cartography: {
          findings: [
            {
              kind: 'layering',
              statement: 'A layering rule with no traceable component.',
              evidence: [{ kind: 'fact', description: 'dependency-cycle:a->b->a' }],
              confidence: 'medium',
            },
          ],
          rejected: [],
          sharedWriteTables: [],
        },
        inference: { findings: [], rejected: [] },
        verification: { findings: [], gaps: [] },
        dependencyGraph: { nodes: [], cycles: [] },
      },
    );
    const tree = await parseKbTree(paths, 'docs/forge/kb');
    const adr = tree.entries.find((e) => e.kind === 'adr');
    if (adr?.kind !== 'adr') throw new Error('expected an adr entry');
    expect(adr.value.blast_radius).toEqual([]);
    expect(adr.body).toContain('none identified');
  });

  it('writes nothing at all for a completely empty adoption run, without throwing', async () => {
    const paths = await freshProject();
    const result = await writeReconstruction(
      { paths, clock: fakeClock() },
      {
        cartography: { findings: [], rejected: [], sharedWriteTables: [] },
        inference: { findings: [], rejected: [] },
        verification: { findings: [], gaps: [] },
        dependencyGraph: { nodes: [], cycles: [] },
      },
    );
    expect(result).toEqual({ componentIds: [], diagramIds: [], kbEntryIds: [], adrIds: [] });
    const tree = await parseKbTree(paths, 'docs/forge/kb');
    expect(tree.entries).toEqual([]);
    expect(tree.errors).toEqual([]);
  });

  it('never attaches the data-only ER diagram to an architecture entry, and never attaches an architecture-only diagram to a data entry', async () => {
    const paths = await freshProject();
    await writeReconstruction({ paths, clock: fakeClock() }, fullInput());
    const tree = await parseKbTree(paths, 'docs/forge/kb');
    const diagrams = tree.entries.filter(
      (e): e is Extract<(typeof tree.entries)[number], { kind: 'diagram' }> => e.kind === 'diagram',
    );
    const erDiagramId = diagrams.find((d) => d.value.generator === 'schema-introspect-to-er')?.value
      .id;
    const architectureDiagramIds = new Set(
      diagrams
        .filter(
          (d) => d.value.generator === 'components-to-c4' || d.value.generator === 'deps-to-graph',
        )
        .map((d) => d.value.id),
    );
    expect(erDiagramId).toBeDefined();

    const architectureEntry = tree.entries.find(
      (e) => e.kind === 'kb-entry' && e.value.section === 'architecture',
    );
    const dataEntry = tree.entries.find((e) => e.kind === 'kb-entry' && e.value.section === 'data');
    if (architectureEntry?.kind !== 'kb-entry' || dataEntry?.kind !== 'kb-entry') {
      throw new Error('expected both an architecture and a data kb-entry');
    }
    // The ER diagram depicts a table, not a component or a module -- no architecture entry may cite
    // it, and no data entry may cite an architecture-only diagram either.
    expect(architectureEntry.value.diagrams).not.toContain(erDiagramId);
    for (const id of dataEntry.value.diagrams) expect(architectureDiagramIds.has(id)).toBe(false);
  });

  it('a second run against a project that already has one converges instead of crashing -- resumable per R9', async () => {
    const paths = await freshProject();
    const first = await writeReconstruction({ paths, clock: fakeClock() }, fullInput());
    const second = await writeReconstruction(
      { paths, clock: fakeClock('2026-03-01T00:00:00.000Z') },
      fullInput(),
    );

    expect(second.kbEntryIds).toEqual(first.kbEntryIds);
    expect(second.adrIds).toEqual(first.adrIds);
    expect(second.componentIds).toEqual(first.componentIds);

    // No duplicate ADR was written for the identical layering finding.
    const tree = await parseKbTree(paths, 'docs/forge/kb');
    const adrs = tree.entries.filter((e) => e.kind === 'adr');
    expect(adrs).toHaveLength(1);
  });
});
