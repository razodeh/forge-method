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
import { DEFAULT_CONFIG, type StructuredTestCommand } from '@forge/schemas/config';
import { appendEvent } from '@forge/telemetry/events';
import * as YAML from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

import {
  checkTestAdoptionApproved,
  loadStagedProposalOrThrow,
  readStagedProposal,
  runDetectionAndStage,
  runPromotion,
  stagedProposalPath,
  writeStagedProposal,
  type PromotionContext,
  type StagedProposalRecord,
} from '../../../../src/commands/loop/test/adopt.ts';
import { computeProofSubjectHash } from '../../../../src/commands/loop/test/proof.ts';

const CHECKS_ROOT = '.forge/checks';

/** `runPromotion`'s own third argument, defaulting to a `checksRoot` with NO real `G-TestAdopt.gate.yaml`
 * under it (the `'gate-not-available'` case) unless the caller writes one first. */
function promotionContext(dir: string, runId = 'test-run'): PromotionContext {
  return { checksRoot: CHECKS_ROOT, projectRoot: dir, resolveRunId: () => Promise.resolve(runId) };
}

async function writeGateFile(dir: string): Promise<void> {
  await mkdir(path.join(dir, CHECKS_ROOT), { recursive: true });
  await writeFile(
    path.join(dir, CHECKS_ROOT, 'G-TestAdopt.gate.yaml'),
    'id: G-TestAdopt\nname: Test adoption gate\nautonomyOverride: null\nchecks:\n  deterministic:\n    - id: test-adoption:approved\n      run: "forge test adopt --check-proof unit --json"\n      parser: forge-json\n      failOn: "unapproved > 0"\n  advisory: []\nopenQuestionsPolicy: block\napproval:\n  required: true\n  roles: [human]\n  quorum: 1\n',
  );
}

/** A real, minimal `.forge/config.yaml` -- `mergeStagedCommandIntoConfig`'s own `readConfig` throws
 * `CFG-020` without one. */
async function writeBaseConfig(dir: string): Promise<void> {
  await mkdir(path.join(dir, '.forge'), { recursive: true });
  await writeFile(path.join(dir, '.forge', 'config.yaml'), YAML.stringify(DEFAULT_CONFIG));
}

/** The real `GateApproved`/`GateRejected` event `isGateApprovedForRun` reads back, written the
 * identical way `gate-commands.ts`'s own `emitGateEvent` does (no `valuePatterns` redaction needed
 * for this fixture's own synthetic text). */
async function recordGateEvent(
  projectRoot: string,
  runId: string,
  gateId: string,
  type: 'GateApproved' | 'GateRejected',
): Promise<void> {
  await appendEvent(projectRoot, runId, {
    type,
    runId,
    ts: '2026-01-01T00:00:00.000Z',
    payload: { gateId },
  });
}

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

const SAMPLE_COMMAND: StructuredTestCommand = {
  run: 'npx vitest run --reporter=json',
  output: { source: 'stdout' },
  format: 'vitest-json',
};

const SAMPLE_RECORD: StagedProposalRecord = {
  layer: 'unit',
  source: 'detected',
  command: SAMPLE_COMMAND,
  reason: 'package.json declares "vitest" as a dependency.',
};

/** The real, passing `subjectHash` for `SAMPLE_COMMAND` (no translator: its own `translate` is
 * unset) -- what `checkTestAdoptionApproved`'s freshness check actually recomputes and compares
 * against, so a test that wants a genuinely CURRENT proof uses this, never a hand-picked placeholder. */
const SAMPLE_COMMAND_HASH = computeProofSubjectHash(SAMPLE_COMMAND);

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

/** A record whose own `proof.subjectHash` really is `computeProofSubjectHash(SAMPLE_RECORD.command)`
 * (no translator -- `SAMPLE_RECORD.command.translate` is unset) -- `checkTestAdoptionApproved`'s own
 * freshness check passes for this one, unlike the hand-picked `'abc'` placeholder the pre-P7 tests
 * above use (which exists only to exercise the OTHER refusal branches, never freshness). */
function passingRecord(subjectHash: string): StagedProposalRecord {
  return {
    ...SAMPLE_RECORD,
    proof: { ok: true, subjectHash, runnerVersion: '1.0.0', checkedAt: '2026-01-01T00:00:00.000Z' },
  };
}

describe('checkTestAdoptionApproved -- G-TestAdopt.gate.yaml\'s own "test-adoption:approved" check (specs/22 M17 P7)', () => {
  it('unapproved=1 when nothing is staged', async () => {
    const dir = await tempDir();
    const result = await checkTestAdoptionApproved(new ProjectPaths(dir), 'unit');
    expect(result).toMatchObject({ v: 1, layer: 'unit', unapproved: 1 });
    expect(result.detail).toContain('no staged proposal');
  });

  it('unapproved=1 when the recorded proof failed', async () => {
    const dir = await tempDir();
    const paths = new ProjectPaths(dir);
    await writeStagedProposal(paths, 'unit', {
      ...SAMPLE_RECORD,
      proof: {
        ok: false,
        failedCheck: 3,
        reason: 'wrong name',
        subjectHash: 'abc',
        runnerVersion: '1.0.0',
        checkedAt: '2026-01-01T00:00:00.000Z',
      },
    });
    const result = await checkTestAdoptionApproved(paths, 'unit');
    expect(result.unapproved).toBe(1);
    expect(result.detail).toContain('check 3');
  });

  it('unapproved=1 when the recorded proof is stale (the proposal changed since it was taken)', async () => {
    const dir = await tempDir();
    const paths = new ProjectPaths(dir);
    // A real, passing proof hash for a DIFFERENT command than the one actually staged below.
    await writeStagedProposal(paths, 'unit', passingRecord('not-the-real-hash'));
    const result = await checkTestAdoptionApproved(paths, 'unit');
    expect(result.unapproved).toBe(1);
    expect(result.detail).toContain('stale');
  });

  it('unapproved=0 when the recorded proof is passing and current', async () => {
    const dir = await tempDir();
    const paths = new ProjectPaths(dir);
    const realHash = SAMPLE_COMMAND_HASH;
    await writeStagedProposal(paths, 'unit', passingRecord(realHash));
    const result = await checkTestAdoptionApproved(paths, 'unit');
    expect(result).toMatchObject({ v: 1, layer: 'unit', unapproved: 0 });
    expect(result.detail).toContain('current');
  });
});

describe('runPromotion -- the full staged-proposal lifecycle, now that G-TestAdopt is real (specs/22 M17 P7)', () => {
  /** `resolveRunId` always throws -- a real critic-round regression: a project with no prior run at
   * all has no `last-run.json` for `resolveDispatchRunId` to default to, so the three refusals below
   * must never actually need a run id to be reached. */
  function neverResolveRunId(): PromotionContext {
    return {
      checksRoot: CHECKS_ROOT,
      projectRoot: '/should-not-be-read',
      resolveRunId: () =>
        Promise.reject(new Error('resolveRunId must not be called for this outcome')),
    };
  }

  it('"no-staged-proposal" when nothing has ever been staged for this layer -- never resolves a runId to say so', async () => {
    const dir = await tempDir();
    const result = await runPromotion(new ProjectPaths(dir), 'unit', neverResolveRunId());
    expect(result).toEqual({ outcome: 'no-staged-proposal', layer: 'unit' });
  });

  it('"proof-not-passing" when a proposal is staged but no proof has been recorded yet -- never resolves a runId to say so', async () => {
    const dir = await tempDir();
    const paths = new ProjectPaths(dir);
    await writeStagedProposal(paths, 'unit', SAMPLE_RECORD);
    const result = await runPromotion(paths, 'unit', neverResolveRunId());
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
    const result = await runPromotion(paths, 'unit', neverResolveRunId());
    expect(result).toMatchObject({ outcome: 'proof-not-passing', layer: 'unit' });
    if (result.outcome === 'proof-not-passing') {
      expect(result.detail).toContain('check 3');
      expect(result.detail).toContain('does not appear at all');
    }
  });

  it('"gate-not-available" when the recorded proof passed but this project has no G-TestAdopt.gate.yaml -- never resolves a runId to say so', async () => {
    const dir = await tempDir();
    const paths = new ProjectPaths(dir);
    const realHash = SAMPLE_COMMAND_HASH;
    await writeStagedProposal(paths, 'unit', passingRecord(realHash));
    // No `writeGateFile(dir)` call: the gate file genuinely does not exist in this project.
    const result = await runPromotion(paths, 'unit', neverResolveRunId());
    expect(result).toEqual({ outcome: 'gate-not-available', layer: 'unit' });
  });

  it('"proof-not-passing" when the gate file exists but the recorded proof is stale -- never resolves a runId to say so', async () => {
    const dir = await tempDir();
    const paths = new ProjectPaths(dir);
    await writeGateFile(dir);
    await writeStagedProposal(paths, 'unit', passingRecord('not-the-real-hash'));
    const result = await runPromotion(paths, 'unit', neverResolveRunId());
    expect(result).toMatchObject({ outcome: 'proof-not-passing' });
    if (result.outcome === 'proof-not-passing') expect(result.detail).toContain('stale');
  });

  it('"not-approved" when the deterministic check passes but no human has recorded approval for this run', async () => {
    const dir = await tempDir();
    const paths = new ProjectPaths(dir);
    await writeGateFile(dir);
    const realHash = SAMPLE_COMMAND_HASH;
    await writeStagedProposal(paths, 'unit', passingRecord(realHash));
    const result = await runPromotion(paths, 'unit', promotionContext(dir, 'run-no-approval'));
    expect(result).toEqual({ outcome: 'not-approved', layer: 'unit' });
  });

  it('"promoted": merges the staged command into the live .forge/config.yaml once a human has recorded real approval for the real run', async () => {
    const dir = await tempDir();
    const paths = new ProjectPaths(dir);
    await writeGateFile(dir);
    await writeBaseConfig(dir);
    const realHash = SAMPLE_COMMAND_HASH;
    await writeStagedProposal(paths, 'unit', passingRecord(realHash));
    const runId = 'run-approved';
    await recordGateEvent(dir, runId, 'G-TestAdopt', 'GateApproved');

    const result = await runPromotion(paths, 'unit', promotionContext(dir, runId));
    expect(result).toEqual({ outcome: 'promoted', layer: 'unit' });

    const written = YAML.parse(await readFile(path.join(dir, '.forge', 'config.yaml'), 'utf8')) as {
      readonly execution: { readonly testCommands: Readonly<Record<string, unknown>> };
    };
    expect(written.execution.testCommands['unit']).toEqual(SAMPLE_RECORD.command);
  });

  it('"promoted" merges the record captured at the start of the call, never a later rewrite of the staged file (specs/22 M17 P7, critic round 2)', async () => {
    const dir = await tempDir();
    const paths = new ProjectPaths(dir);
    await writeGateFile(dir);
    await writeBaseConfig(dir);
    await writeStagedProposal(paths, 'unit', passingRecord(SAMPLE_COMMAND_HASH));
    const runId = 'run-race';
    await recordGateEvent(dir, runId, 'G-TestAdopt', 'GateApproved');

    // A second, internally self-consistent (own real hash, own real proof) staged record for a
    // DIFFERENT command -- written as a side effect of resolving the run id, standing in for a real
    // concurrent rewrite landing after `runPromotion`'s own one real read. `resolveRunId` is the one
    // caller-injectable hook this black-box test has; it runs after BOTH the fixed code's one read
    // and the original double-read bug's own two (the second one, inside the old
    // `checkTestAdoptionApproved` call, happened before `resolveRunId` in either version) -- so this
    // specific rewrite timing cannot, by itself, distinguish the two. What it DOES verify, directly
    // and for real, is the actual invariant the fix establishes: the staged record is captured once,
    // at the top of the call, and reused everywhere after -- a rewrite of the file on disk, at any
    // point once `runPromotion` has started, changes nothing about what gets merged, because nothing
    // downstream of the first read ever consults the file again at all.
    const otherCommand = { ...SAMPLE_COMMAND, run: 'npx jest --json' };
    const otherHash = computeProofSubjectHash(otherCommand);
    const result = await runPromotion(paths, 'unit', {
      checksRoot: CHECKS_ROOT,
      projectRoot: dir,
      resolveRunId: async () => {
        await writeStagedProposal(paths, 'unit', {
          ...SAMPLE_RECORD,
          command: otherCommand,
          proof: {
            ok: true,
            subjectHash: otherHash,
            runnerVersion: '1.0.0',
            checkedAt: '2026-01-01T00:00:00.000Z',
          },
        });
        return runId;
      },
    });
    expect(result).toEqual({ outcome: 'promoted', layer: 'unit' });

    const written = YAML.parse(await readFile(path.join(dir, '.forge', 'config.yaml'), 'utf8')) as {
      readonly execution: { readonly testCommands: Readonly<Record<string, unknown>> };
    };
    // The command `runPromotion` actually checked (SAMPLE_COMMAND), never the one the race wrote
    // afterward (otherCommand) -- the file on disk now holds `otherCommand` as its own STAGED
    // proposal, but the LIVE config must reflect what was verified, not what is there now.
    expect(written.execution.testCommands['unit']).toEqual(SAMPLE_RECORD.command);
    expect(written.execution.testCommands['unit']).not.toEqual(otherCommand);
  });

  it('"not-approved": a LATER GateRejected supersedes an earlier GateApproved for the same run', async () => {
    const dir = await tempDir();
    const paths = new ProjectPaths(dir);
    await writeGateFile(dir);
    const realHash = SAMPLE_COMMAND_HASH;
    await writeStagedProposal(paths, 'unit', passingRecord(realHash));
    const runId = 'run-approved-then-rejected';
    await recordGateEvent(dir, runId, 'G-TestAdopt', 'GateApproved');
    await recordGateEvent(dir, runId, 'G-TestAdopt', 'GateRejected');

    const result = await runPromotion(paths, 'unit', promotionContext(dir, runId));
    expect(result).toEqual({ outcome: 'not-approved', layer: 'unit' });
  });

  it('a malformed staged record surfaces loudly (CFG-518), never treated as "nothing staged"', async () => {
    const dir = await tempDir();
    const paths = new ProjectPaths(dir);
    await writeRawProposalFile(paths, 'unit', 'this: [is, not, a, real, record');
    await expect(runPromotion(paths, 'unit', promotionContext(dir))).rejects.toMatchObject({
      code: 'CFG-518',
    });
  });
});
