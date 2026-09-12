/**
 * `assembleCartography` — `17` §17.2 phase 3's own two central Checks (`PLAN-M10.md` P16): a seeded
 * shared-write-table produces a flagged finding, and a fabricated claim (evidence naming something P15's
 * own SURVEY/INVENTORY never produced) is rejected, not silently accepted.
 *
 * @see specs/17 §17.2
 * @see PLAN-M10.md P16
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  assembleCartography,
  validateClaimEvidence,
  type RawCartographyClaim,
} from '../../src/adopt/cartography.ts';
import { buildEvidenceIndex, type EvidenceIndex } from '../../src/adopt/evidence.ts';
import { runInventory } from '../../src/adopt/inventory.ts';
import { runSurvey } from '../../src/adopt/survey.ts';
import { nodeFixtureFiles, populateFixture, STUB_GIT_PROFILE } from './fixtures.ts';

let dir: string | undefined;

afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

async function realIndex(): Promise<EvidenceIndex> {
  dir = await mkdtemp(path.join(tmpdir(), 'forge-kb-cartography-'));
  await populateFixture(dir, nodeFixtureFiles());
  const { survey } = await runSurvey({ rootDir: dir, gitProfile: STUB_GIT_PROFILE });
  const inventory = await runInventory({ rootDir: dir, survey });
  return buildEvidenceIndex(survey, inventory);
}

describe('validateClaimEvidence', () => {
  it('rejects a claim with no evidence at all', async () => {
    const index = await realIndex();
    const claim: RawCartographyClaim = {
      kind: 'component',
      statement: 'A routing component exists.',
      confidence: 'medium',
      evidence: [],
    };
    expect(validateClaimEvidence(claim, index)).toBe('no evidence cited');
  });

  it('accepts a claim whose evidence is real', async () => {
    const index = await realIndex();
    const claim: RawCartographyClaim = {
      kind: 'component',
      statement: 'A routing component lives at src/routes.ts.',
      confidence: 'medium',
      evidence: [{ kind: 'path', path: 'src/routes.ts' }],
    };
    expect(validateClaimEvidence(claim, index)).toBeUndefined();
  });

  it('rejects a claim manufactured without real evidence -- a component invented outright, the central anti-fabrication check', async () => {
    const index = await realIndex();
    const fabricated: RawCartographyClaim = {
      kind: 'component',
      statement: 'A PaymentsGateway component orchestrates third-party billing.',
      confidence: 'high',
      evidence: [{ kind: 'path', path: 'src/payments/gateway.ts' }],
    };
    const reason = validateClaimEvidence(fabricated, index);
    expect(reason).toContain('evidence not found');
  });

  it('rejects a claim mixing one real citation with one fabricated one -- no partial credit', async () => {
    const index = await realIndex();
    const mixed: RawCartographyClaim = {
      kind: 'component',
      statement: 'A component spans routes.ts and an invented file.',
      confidence: 'medium',
      evidence: [
        { kind: 'path', path: 'src/routes.ts' },
        { kind: 'path', path: 'src/invented.ts' },
      ],
    };
    expect(validateClaimEvidence(mixed, index)).toContain('evidence not found');
  });

  it('rejects a data-ownership claim missing table/owner even with real evidence', async () => {
    const index = await realIndex();
    const claim: RawCartographyClaim = {
      kind: 'data-ownership',
      statement: 'Something writes something.',
      confidence: 'low',
      evidence: [{ kind: 'path', path: 'src/db.ts' }],
    };
    expect(validateClaimEvidence(claim, index)).toBe('data-ownership claim missing table or owner');
  });

  it('rejects a data-ownership claim with an empty-string owner -- not a real component name', async () => {
    const index = await realIndex();
    const claim: RawCartographyClaim = {
      kind: 'data-ownership',
      statement: 'Something writes users, but names no real owner.',
      confidence: 'low',
      evidence: [{ kind: 'path', path: 'src/db.ts' }],
      table: 'users',
      owner: '   ',
    };
    expect(validateClaimEvidence(claim, index)).toBe('data-ownership claim missing table or owner');
  });

  it('rejects a data-ownership claim with an empty-string table', async () => {
    const index = await realIndex();
    const claim: RawCartographyClaim = {
      kind: 'data-ownership',
      statement: 'Names an owner but no real table.',
      confidence: 'low',
      evidence: [{ kind: 'path', path: 'src/db.ts' }],
      table: '',
      owner: 'db-component',
    };
    expect(validateClaimEvidence(claim, index)).toBe('data-ownership claim missing table or owner');
  });
});

describe('assembleCartography', () => {
  it(
    'a fabricated claim (from a scripted fake-adapter-shaped response inventing a component not in ' +
      "P15's own inventory) is rejected, not silently accepted, while a real claim in the same batch is kept",
    async () => {
      const index = await realIndex();
      const rawClaims: readonly RawCartographyClaim[] = [
        {
          kind: 'component',
          statement: 'The routing component lives at src/routes.ts.',
          confidence: 'high',
          evidence: [{ kind: 'path', path: 'src/routes.ts' }],
        },
        {
          kind: 'component',
          statement: 'An invented AuditLoggerService exists.',
          confidence: 'high',
          evidence: [{ kind: 'path', path: 'src/invented/audit-logger.ts' }],
        },
      ];
      const result = assembleCartography(rawClaims, index);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]?.statement).toContain('routing component');
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0]?.reason).toContain('evidence not found');
    },
  );

  it('flags a seeded shared-write table immediately -- the "highest-value finding" (17 §17.2)', async () => {
    const index = await realIndex();
    const rawClaims: readonly RawCartographyClaim[] = [
      {
        kind: 'data-ownership',
        statement: 'The routing component writes the users table.',
        confidence: 'medium',
        evidence: [{ kind: 'path', path: 'src/routes.ts' }],
        table: 'users',
        owner: 'routing-component',
      },
      {
        kind: 'data-ownership',
        statement: 'The db component also writes the users table.',
        confidence: 'medium',
        evidence: [{ kind: 'path', path: 'src/db.ts' }],
        table: 'users',
        owner: 'db-component',
      },
    ];
    const result = assembleCartography(rawClaims, index);
    expect(result.findings).toHaveLength(2);
    expect(result.sharedWriteTables).toEqual([
      { table: 'users', owners: ['db-component', 'routing-component'] },
    ]);
  });

  it('sorts multiple shared-write-table findings by table name, both comparison directions exercised', async () => {
    const index = await realIndex();
    function claim(table: string, owner: string): RawCartographyClaim {
      return {
        kind: 'data-ownership',
        statement: `${owner} writes ${table}.`,
        confidence: 'medium',
        evidence: [{ kind: 'path', path: 'src/db.ts' }],
        table,
        owner,
      };
    }
    const rawClaims: readonly RawCartographyClaim[] = [
      claim('zebras', 'a'),
      claim('zebras', 'b'),
      claim('accounts', 'c'),
      claim('accounts', 'd'),
      claim('middle', 'e'),
      claim('middle', 'f'),
    ];
    const result = assembleCartography(rawClaims, index);
    expect(result.sharedWriteTables.map((finding) => finding.table)).toEqual([
      'accounts',
      'middle',
      'zebras',
    ]);
  });

  it('does not flag a table only one accepted finding claims to own', async () => {
    const index = await realIndex();
    const rawClaims: readonly RawCartographyClaim[] = [
      {
        kind: 'data-ownership',
        statement: 'Only the db component writes the users table.',
        confidence: 'medium',
        evidence: [{ kind: 'path', path: 'src/db.ts' }],
        table: 'users',
        owner: 'db-component',
      },
    ];
    const result = assembleCartography(rawClaims, index);
    expect(result.sharedWriteTables).toEqual([]);
  });

  it("never derives sharedWriteTables from a rejected claim's own unverified table/owner", async () => {
    const index = await realIndex();
    const rawClaims: readonly RawCartographyClaim[] = [
      {
        kind: 'data-ownership',
        statement: 'Real claim, real evidence.',
        confidence: 'medium',
        evidence: [{ kind: 'path', path: 'src/db.ts' }],
        table: 'users',
        owner: 'db-component',
      },
      {
        kind: 'data-ownership',
        statement: 'Fabricated claim with fabricated evidence, same table, different owner.',
        confidence: 'high',
        evidence: [{ kind: 'path', path: 'src/invented/writer.ts' }],
        table: 'users',
        owner: 'invented-component',
      },
    ];
    const result = assembleCartography(rawClaims, index);
    expect(result.sharedWriteTables).toEqual([]);
  });
});
