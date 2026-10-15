/**
 * `adopt.ts` -- the staged-proposal lifecycle (`13` F-TEST-11): write/read/promote over a real
 * `.forge/test-adopt/<layer>.proposal.yaml` on disk.
 *
 * @see specs/13 F-TEST-11
 * @see specs/22 M17 P6
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ProjectPaths } from '@forge/core/fs';
import { afterEach, describe, expect, it } from 'vitest';

import {
  loadStagedProposalOrThrow,
  readStagedProposal,
  runDetectionAndStage,
  runPromotion,
  stagedProposalPath,
  writeStagedProposal,
  type StagedProposalRecord,
} from '../../../../src/commands/loop/test/adopt.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-adopt-'));
  dirs.push(dir);
  return dir;
}

/** Writes raw, deliberately-malformed text straight at a layer's own staged-proposal path --
 * `mkdir`-ing its parent first, since (unlike `writeStagedProposal`) a bare `writeFile` does not. */
async function writeRawProposalFile(
  paths: ProjectPaths,
  layer: string,
  text: string,
): Promise<void> {
  const target = stagedProposalPath(paths, layer);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, text, 'utf8');
}

const SAMPLE_RECORD: StagedProposalRecord = {
  layer: 'unit',
  source: 'detected',
  command: {
    run: 'npx vitest run --reporter=json',
    output: { source: 'stdout' },
    format: 'vitest-json',
  },
  reason: 'package.json declares "vitest" as a dependency.',
};

describe('stagedProposalPath / writeStagedProposal / readStagedProposal (specs/22 M17 P6)', () => {
  it('resolves under .forge/test-adopt/<layer>.proposal.yaml', async () => {
    const dir = await tempDir();
    const paths = new ProjectPaths(dir);
    expect(stagedProposalPath(paths, 'unit')).toBe(
      path.join(dir, '.forge', 'test-adopt', 'unit.proposal.yaml'),
    );
  });

  it('round-trips a real record through real YAML on disk', async () => {
    const dir = await tempDir();
    const paths = new ProjectPaths(dir);
    await writeStagedProposal(paths, 'unit', SAMPLE_RECORD);
    const result = await readStagedProposal(paths, 'unit');
    expect(result).toMatchObject({ outcome: 'found', record: SAMPLE_RECORD });
  });

  it('a second write overwrites the first (13 F-TEST-11: "writes OR OVERWRITES")', async () => {
    const dir = await tempDir();
    const paths = new ProjectPaths(dir);
    await writeStagedProposal(paths, 'unit', SAMPLE_RECORD);
    const updated: StagedProposalRecord = { ...SAMPLE_RECORD, reason: 'a different, later reason' };
    await writeStagedProposal(paths, 'unit', updated);
    const result = await readStagedProposal(paths, 'unit');
    expect(result).toMatchObject({
      outcome: 'found',
      record: { reason: 'a different, later reason' },
    });
  });

  it('reports "missing" for a layer with no staged record at all', async () => {
    const dir = await tempDir();
    const result = await readStagedProposal(new ProjectPaths(dir), 'unit');
    expect(result).toEqual({ outcome: 'missing' });
  });

  it('reports "invalid" for unparseable YAML', async () => {
    const dir = await tempDir();
    const paths = new ProjectPaths(dir);
    await mkdir(path.join(dir, '.forge', 'test-adopt'), { recursive: true });
    await writeFile(
      path.join(dir, '.forge', 'test-adopt', 'unit.proposal.yaml'),
      '{ not: valid: yaml',
      'utf8',
    );
    const result = await readStagedProposal(paths, 'unit');
    expect(result.outcome).toBe('invalid');
  });

  it('reports "invalid" for a schema violation (an unknown top-level key)', async () => {
    const dir = await tempDir();
    const paths = new ProjectPaths(dir);
    await writeRawProposalFile(
      paths,
      'unit',
      'layer: unit\nsource: detected\ncommand: not-a-real-structured-command\nreason: x\nsomeUnknownKey: y\n',
    );
    const result = await readStagedProposal(paths, 'unit');
    expect(result.outcome).toBe('invalid');
    if (result.outcome === 'invalid') expect(result.detail.length).toBeGreaterThan(0);
  });

  it('reports "invalid" for valid YAML that is schema-invalid via a MISSING required key, naming that real key (not "(document)")', async () => {
    const dir = await tempDir();
    const paths = new ProjectPaths(dir);
    // Real, parseable YAML -- every key present except the required "reason".
    await writeRawProposalFile(
      paths,
      'unit',
      'layer: unit\nsource: detected\ncommand:\n  run: echo x\n  output:\n    source: stdout\n  format: tap\n',
    );
    const result = await readStagedProposal(paths, 'unit');
    expect(result.outcome).toBe('invalid');
    if (result.outcome === 'invalid') {
      expect(result.key).toBe('reason');
      expect(result.detail).toContain('reason');
    }
  });
});

describe('loadStagedProposalOrThrow (specs/22 M17 P6)', () => {
  it('returns undefined, not a throw, when nothing is staged', async () => {
    const dir = await tempDir();
    await expect(loadStagedProposalOrThrow(new ProjectPaths(dir), 'unit')).resolves.toBeUndefined();
  });

  it('returns the real record when one is staged and valid', async () => {
    const dir = await tempDir();
    const paths = new ProjectPaths(dir);
    await writeStagedProposal(paths, 'unit', SAMPLE_RECORD);
    await expect(loadStagedProposalOrThrow(paths, 'unit')).resolves.toEqual(SAMPLE_RECORD);
  });

  it('throws CFG-518, naming the file, for an invalid staged record', async () => {
    const dir = await tempDir();
    const paths = new ProjectPaths(dir);
    await writeRawProposalFile(paths, 'unit', 'this: [is, not, a, real, record');
    await expect(loadStagedProposalOrThrow(paths, 'unit')).rejects.toMatchObject({
      code: 'CFG-518',
    });
  });

  it('CFG-518 carries the real offending key, not the "(document)" placeholder, for a field-level schema problem', async () => {
    const dir = await tempDir();
    const paths = new ProjectPaths(dir);
    await writeRawProposalFile(
      paths,
      'unit',
      'layer: unit\nsource: detected\ncommand:\n  run: echo x\n  output:\n    source: stdout\n  format: tap\n',
    );
    await expect(loadStagedProposalOrThrow(paths, 'unit')).rejects.toMatchObject({
      code: 'CFG-518',
      details: { key: 'reason' },
    });
  });
});

describe('runDetectionAndStage (specs/22 M17 P6)', () => {
  it('stages a real proposal for a confident detection', async () => {
    const dir = await tempDir();
    const paths = new ProjectPaths(dir);
    await writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'fixture', devDependencies: { vitest: '2' } }),
      'utf8',
    );
    const result = await runDetectionAndStage(paths);
    expect(result).toMatchObject({ outcome: 'staged', layer: 'unit' });
    const staged = await readStagedProposal(paths, 'unit');
    expect(staged).toMatchObject({
      outcome: 'found',
      record: { layer: 'unit', source: 'detected' },
    });
  });

  it('writes nothing at all for an unconfident detection -- a real hand-off', async () => {
    const dir = await tempDir();
    const paths = new ProjectPaths(dir);
    const result = await runDetectionAndStage(paths);
    expect(result.outcome).toBe('handoff');
    await expect(readFile(stagedProposalPath(paths, 'unit'), 'utf8')).rejects.toThrow();
  });
});

describe('runPromotion -- --write always refuses in this build (specs/22 M17 P6)', () => {
  it('"no-staged-proposal" when nothing has ever been staged for this layer', async () => {
    const dir = await tempDir();
    const result = await runPromotion(new ProjectPaths(dir), 'unit');
    expect(result).toEqual({ outcome: 'no-staged-proposal', layer: 'unit' });
  });

  it('"proof-not-passing" when a proposal is staged but no proof has been recorded yet', async () => {
    const dir = await tempDir();
    const paths = new ProjectPaths(dir);
    await writeStagedProposal(paths, 'unit', SAMPLE_RECORD);
    const result = await runPromotion(paths, 'unit');
    expect(result).toMatchObject({ outcome: 'proof-not-passing', layer: 'unit' });
    if (result.outcome === 'proof-not-passing')
      expect(result.detail).toContain('no translator proof');
  });

  it('"proof-not-passing" when the recorded proof failed, naming the failing check', async () => {
    const dir = await tempDir();
    const paths = new ProjectPaths(dir);
    const record: StagedProposalRecord = {
      ...SAMPLE_RECORD,
      proof: {
        ok: false,
        failedCheck: 3,
        reason: 'the injected-failure probe does not appear at all.',
        subjectHash: 'abc',
        runnerVersion: '1.0.0',
        checkedAt: '2026-01-01T00:00:00.000Z',
      },
    };
    await writeStagedProposal(paths, 'unit', record);
    const result = await runPromotion(paths, 'unit');
    expect(result).toMatchObject({ outcome: 'proof-not-passing', layer: 'unit' });
    if (result.outcome === 'proof-not-passing') {
      expect(result.detail).toContain('check 3');
      expect(result.detail).toContain('does not appear at all');
    }
  });

  it('"gate-not-available" when the recorded proof passed -- G-TestAdopt has no gate file yet (P7)', async () => {
    const dir = await tempDir();
    const paths = new ProjectPaths(dir);
    const record: StagedProposalRecord = {
      ...SAMPLE_RECORD,
      proof: {
        ok: true,
        subjectHash: 'abc',
        runnerVersion: '1.0.0',
        checkedAt: '2026-01-01T00:00:00.000Z',
      },
    };
    await writeStagedProposal(paths, 'unit', record);
    const result = await runPromotion(paths, 'unit');
    expect(result).toEqual({ outcome: 'gate-not-available', layer: 'unit' });
  });

  it('a malformed staged record surfaces loudly (CFG-518), never treated as "nothing staged"', async () => {
    const dir = await tempDir();
    const paths = new ProjectPaths(dir);
    await writeRawProposalFile(paths, 'unit', 'this: [is, not, a, real, record');
    await expect(runPromotion(paths, 'unit')).rejects.toMatchObject({ code: 'CFG-518' });
  });
});
