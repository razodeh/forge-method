/**
 * `runTranslatorProof` (`13` F-TEST-11) -- real subprocess runs throughout: a real `node --test`
 * invocation for the happy path, and real `node -e` translator subprocesses (never hand-built
 * payloads) for each of the five checks' own failure modes.
 *
 * @see specs/13 F-TEST-11
 * @see specs/22 M17 P6
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';

import { ProjectPaths } from '@forge/core/fs';
import type { StructuredTestCommand } from '@forge/schemas/config';
import { afterEach, describe, expect, it } from 'vitest';

import {
  captureRunnerVersion,
  computeProofSubjectHash,
  runTranslatorProof,
  type InjectedProbe,
} from '../../../../src/commands/loop/test/proof.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-proof-'));
  dirs.push(dir);
  return dir;
}

let tempCounter = 0;
function makeCreateTempPath(dir: string): () => string {
  return () => path.join(dir, `tmp-output-${String((tempCounter += 1))}.raw`);
}

/** Writes a real `package.json` whose `"test"` script is a tiny program that echoes back its own
 * received `argv` -- the one way to tell, FOR REAL, whether a package manager genuinely intercepted
 * a trailing version flag (the real script never runs at all) or forwarded it through untouched (the
 * real script runs, and its own printed `argv` proves exactly what it received). This is the exact
 * methodology `SPEC-QUESTIONS.md` Q333's own round 5 used to re-derive `PACKAGE_MANAGER_VERSION_TRAP_FLAGS`
 * (`proof.ts`) from real execution rather than from assumption -- these tests use the identical
 * fixture, never a mock. */
async function writeArgvEchoProject(dir: string): Promise<void> {
  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name: 'argv-echo-fixture',
      version: '1.0.0',
      private: true,
      scripts: { test: 'node script.js' },
    }),
    'utf8',
  );
  await writeFile(
    path.join(dir, 'script.js'),
    "console.log('REAL_SCRIPT_RAN ARGV=' + JSON.stringify(process.argv.slice(2)));\n",
    'utf8',
  );
}

/** Fixed, injected clock (`QUALITY-BAR.md` R10) -- every test passes the identical value, so nothing
 * here ever reads a real wall clock. */
const NOW = () => '2026-01-01T00:00:00.000Z';

/** A real `git init` repo at `dir` -- M17 P21 live-run fix 9's own tracked-vs-untracked distinction
 * (`reclaimLaneLeftoverProbe`, `proof.ts`) only ever activates inside a real git repository, so
 * these tests need one, unlike every other fixture in this file. */
async function initGitRepo(dir: string): Promise<void> {
  await execa('git', ['init', '--quiet'], { cwd: dir });
  await execa('git', ['config', 'user.email', 'proof-test@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 'Proof Test'], { cwd: dir });
}

/** Writes `relativePath` and genuinely commits it -- the one way a file is TRACKED in `dir`'s own
 * git state, the identical real signal `reclaimLaneLeftoverProbe` reads (`git ls-files
 * --error-unmatch`), mirroring `adopt-agent.test.ts`'s own `commitRealFile` helper. */
async function commitRealFile(dir: string, relativePath: string, content: string): Promise<void> {
  await writeFile(path.join(dir, relativePath), content, 'utf8');
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', `add ${relativePath}`], { cwd: dir });
}

describe('runTranslatorProof -- happy path, a real "node --test" run, TAP, no translator (specs/22 M17 P6)', () => {
  it('passes all five checks for a real baseline + a real injected-failure probe', async () => {
    const dir = await tempDir();
    await writeFile(
      path.join(dir, 'baseline.test.js'),
      `
const test = require('node:test');
const assert = require('node:assert');
test('baseline passes', () => { assert.strictEqual(1 + 1, 2); });
`,
      'utf8',
    );
    const command: StructuredTestCommand = {
      run: `${process.execPath} --test`,
      output: { source: 'stdout' },
      format: 'tap',
    };
    const probe: InjectedProbe = {
      path: 'probe.test.js',
      content: `
const test = require('node:test');
const assert = require('node:assert');
test('PROBE deliberately fails', () => { assert.strictEqual(1, 2); });
`,
      expectedName: 'PROBE deliberately fails',
    };
    const result = await runTranslatorProof({
      command,
      cwd: dir,
      paths: new ProjectPaths(dir),
      createTempPath: makeCreateTempPath(dir),
      probe,
      runnerVersion: process.version,
      runnerVersionCommand: 'node --version',
      now: NOW,
    });
    expect(result).toMatchObject({
      ok: true,
      runnerVersion: process.version,
      checkedAt: '2026-01-01T00:00:00.000Z',
    });
    if (result.ok) {
      expect(result.subjectHash).toBe(computeProofSubjectHash(command));
    }
    // The probe is removed afterwards -- the real project tree is left exactly as it was found.
    await expect(readFile(path.join(dir, 'probe.test.js'), 'utf8')).rejects.toThrow();
  });
});

describe('runTranslatorProof -- check 1, schema validity (specs/22 M17 P6)', () => {
  it('a declared format that does not match the real raw output fails on check 1', async () => {
    const dir = await tempDir();
    await writeFile(
      path.join(dir, 'baseline.test.js'),
      "require('node:test')('b',()=>{});",
      'utf8',
    );
    const command: StructuredTestCommand = {
      run: `${process.execPath} --test`,
      output: { source: 'stdout' },
      format: 'forge-json', // Real output is TAP, not forge-json -- a real mismatch, not contrived.
    };
    const probe: InjectedProbe = {
      path: 'probe.test.js',
      content: "require('node:test')('PROBE', () => { throw new Error('x'); });",
      expectedName: 'PROBE',
    };
    const result = await runTranslatorProof({
      command,
      cwd: dir,
      paths: new ProjectPaths(dir),
      createTempPath: makeCreateTempPath(dir),
      probe,
      runnerVersion: '1.0.0',
      runnerVersionCommand: 'node --version',
      now: NOW,
    });
    expect(result).toMatchObject({ ok: false, failedCheck: 1 });
  });
});

/** Writes a translator script at `dir/translate.js` -- `body` is the literal body of a function
 * `(raw) => ({forgeTestReport:1, tests:[...]})`'s worth of JS, inlined directly (not a template
 * string the translator evaluates) so each fixture below stays a real, independent Node subprocess. */
async function writeTranslator(dir: string, body: string): Promise<void> {
  await writeFile(
    path.join(dir, 'translate.js'),
    `
const fs = require('fs');
const raw = fs.readFileSync(process.argv[2], 'utf8');
${body}
`,
    'utf8',
  );
}

function translatorCommand(runExitsNonZeroOnProbe: boolean): StructuredTestCommand {
  return {
    run: runExitsNonZeroOnProbe
      ? `${process.execPath} --test`
      : `${process.execPath} -e "process.stdout.write('ran'); process.exit(0)"`,
    output: { source: 'stdout' },
    format: 'tap',
    translate: `${process.execPath} translate.js {output}`,
  };
}

async function baselineTestFile(dir: string): Promise<void> {
  await writeFile(
    path.join(dir, 'baseline.test.js'),
    `
const test = require('node:test');
const assert = require('node:assert');
test('baseline passes', () => { assert.strictEqual(1 + 1, 2); });
`,
    'utf8',
  );
}

const REAL_PROBE: InjectedProbe = {
  path: 'probe.test.js',
  content: `
const test = require('node:test');
const assert = require('node:assert');
test('PROBE deliberately fails', () => { assert.strictEqual(1, 2); });
`,
  expectedName: 'PROBE deliberately fails',
};

describe('runTranslatorProof -- check 2, count reconciliation (specs/22 M17 P6)', () => {
  it('a translator that reports every test as "pass" fails check 2 against a real non-zero exit', async () => {
    const dir = await tempDir();
    await baselineTestFile(dir);
    await writeTranslator(
      dir,
      `
const lines = raw.split('\\n');
const tests = lines
  .filter((l) => l.startsWith('ok ') || l.startsWith('not ok '))
  .map((l) => ({ name: l.replace(/^(ok|not ok) \\d+ - /, ''), status: 'pass' }));
process.stdout.write(JSON.stringify({ forgeTestReport: 1, tests }));
`,
    );
    const result = await runTranslatorProof({
      command: translatorCommand(true),
      cwd: dir,
      paths: new ProjectPaths(dir),
      createTempPath: makeCreateTempPath(dir),
      probe: REAL_PROBE,
      runnerVersion: '1.0.0',
      runnerVersionCommand: 'node --version',
      now: NOW,
    });
    expect(result).toMatchObject({ ok: false, failedCheck: 2 });
    if (!result.ok) expect(result.reason).toContain('exited');
  });

  it('a translator whose counts disagree with the real printed TAP summary fails check 2', async () => {
    const dir = await tempDir();
    await baselineTestFile(dir);
    // Reports ONLY the probe's own failure, silently dropping the baseline pass -- the real exit
    // code/fail-presence reconciliation (above) is satisfied, but the real TAP summary line (`#
    // pass 1` / `# fail 1`) disagrees with this translator's own undercounted pass=0/fail=1.
    await writeTranslator(
      dir,
      `
process.stdout.write(JSON.stringify({
  forgeTestReport: 1,
  tests: [{ name: 'PROBE deliberately fails', status: 'fail' }],
}));
`,
    );
    const result = await runTranslatorProof({
      command: translatorCommand(true),
      cwd: dir,
      paths: new ProjectPaths(dir),
      createTempPath: makeCreateTempPath(dir),
      probe: REAL_PROBE,
      runnerVersion: '1.0.0',
      runnerVersionCommand: 'node --version',
      now: NOW,
    });
    expect(result).toMatchObject({ ok: false, failedCheck: 2 });
    if (!result.ok) expect(result.reason).toContain('summary');
  });
});

describe('runTranslatorProof -- check 3, the injected-failure probe (specs/22 M17 P6)', () => {
  it('a translator that never reports the probe by its exact name fails check 3, not check 2', async () => {
    const dir = await tempDir();
    await baselineTestFile(dir);
    // Reports the real baseline pass AND one real fail -- matching the real TAP summary's own
    // pass=1/fail=1 totals exactly (satisfying check 2 in full, not merely its exit-code half) --
    // but the fail is under a name that is not the probe's own.
    await writeTranslator(
      dir,
      `
process.stdout.write(JSON.stringify({
  forgeTestReport: 1,
  tests: [
    { name: 'baseline passes', status: 'pass' },
    { name: 'some unrelated failure', status: 'fail' },
  ],
}));
`,
    );
    const result = await runTranslatorProof({
      command: translatorCommand(true),
      cwd: dir,
      paths: new ProjectPaths(dir),
      createTempPath: makeCreateTempPath(dir),
      probe: REAL_PROBE,
      runnerVersion: '1.0.0',
      runnerVersionCommand: 'node --version',
      now: NOW,
    });
    expect(result).toMatchObject({ ok: false, failedCheck: 3 });
    if (!result.ok) expect(result.reason).toContain('does not appear');
  });

  it('a translator that reports the probe by name but as "pass" fails check 3', async () => {
    const dir = await tempDir();
    await baselineTestFile(dir);
    await writeTranslator(
      dir,
      `
process.stdout.write(JSON.stringify({
  forgeTestReport: 1,
  tests: [
    { name: 'PROBE deliberately fails', status: 'pass' },
    { name: 'a different, synthetic failure', status: 'fail' },
  ],
}));
`,
    );
    const result = await runTranslatorProof({
      command: translatorCommand(true),
      cwd: dir,
      paths: new ProjectPaths(dir),
      createTempPath: makeCreateTempPath(dir),
      probe: REAL_PROBE,
      runnerVersion: '1.0.0',
      runnerVersionCommand: 'node --version',
      now: NOW,
    });
    expect(result).toMatchObject({ ok: false, failedCheck: 3 });
    if (!result.ok) expect(result.reason).toContain('not "fail"');
  });

  it('a translator that attributes the probe to the wrong file fails check 3', async () => {
    const dir = await tempDir();
    await baselineTestFile(dir);
    // Matches the real TAP summary's own pass=1/fail=1 totals exactly -- only the probe's own `file`
    // is wrong, not the counts.
    await writeTranslator(
      dir,
      `
process.stdout.write(JSON.stringify({
  forgeTestReport: 1,
  tests: [
    { name: 'baseline passes', status: 'pass' },
    { name: 'PROBE deliberately fails', status: 'fail', file: 'wrong/file.js' },
  ],
}));
`,
    );
    const probeWithFile: InjectedProbe = { ...REAL_PROBE, expectedFile: 'right/file.js' };
    const result = await runTranslatorProof({
      command: translatorCommand(true),
      cwd: dir,
      paths: new ProjectPaths(dir),
      createTempPath: makeCreateTempPath(dir),
      probe: probeWithFile,
      runnerVersion: '1.0.0',
      runnerVersionCommand: 'node --version',
      now: NOW,
    });
    expect(result).toMatchObject({ ok: false, failedCheck: 3 });
    if (!result.ok) expect(result.reason).toContain('file attribution');
  });

  it('a format that structurally cannot attribute files (TAP) never fails on file mismatch', async () => {
    // The happy-path fixture already proves this positively (no `expectedFile` at all, TAP, passes);
    // this restates it as its own named check-3 case: `expectedFile` given, but the real reported
    // outcome carries no `file` of its own at all -- the comparison must be skipped, not failed.
    const dir = await tempDir();
    await baselineTestFile(dir);
    const probeWithFile: InjectedProbe = { ...REAL_PROBE, expectedFile: 'does/not/matter.js' };
    const result = await runTranslatorProof({
      command: { run: `${process.execPath} --test`, output: { source: 'stdout' }, format: 'tap' },
      cwd: dir,
      paths: new ProjectPaths(dir),
      createTempPath: makeCreateTempPath(dir),
      probe: probeWithFile,
      runnerVersion: process.version,
      runnerVersionCommand: 'node --version',
      now: NOW,
    });
    expect(result.ok).toBe(true);
  });

  /** Three real fixture files whose own real, intended status a translator could get wrong by
   * swapping, independent of what `files.readdirSync('.')` (sorted) happens to return once the
   * probe exists too -- shared by the two tests below, which differ only in WHICH kind of swap bug
   * the translator has. */
  async function writeThreeRealFiles(dir: string): Promise<void> {
    await writeFile(
      path.join(dir, 'a-passes.test.js'),
      '// stands in for a real passing test\n',
      'utf8',
    );
    await writeFile(
      path.join(dir, 'b-fails.test.js'),
      '// stands in for a real, genuinely failing test\n',
      'utf8',
    );
    await writeFile(
      path.join(dir, 'c-passes.test.js'),
      '// stands in for a real passing test\n',
      'utf8',
    );
  }

  const SWAP_PROBE: InjectedProbe = {
    path: 'zzz-probe.test.js',
    content: '// a real probe file -- sorts after the three fixtures above alphabetically\n',
    expectedName: 'zzz-probe.test.js',
  };

  it("a critic-built fixture: a translator that swaps two UNRELATED tests' own statuses, by shifting array position, is caught by the baseline comparison -- the probe itself is reported correctly throughout", async () => {
    const dir = await tempDir();
    await writeThreeRealFiles(dir);
    // The real exit code is always 1 ("b-fails" always genuinely fails) -- independent of the probe,
    // so check 2's mandatory exit-code half is satisfied either way and cannot be what catches this.
    // The translator reads the real files directly (never anything hardcoded, so this result
    // genuinely depends on which files are really on disk) and swaps the status at the SECOND-TO-LAST
    // and THIRD-TO-LAST positions -- skipping the true last position (always the probe, when
    // present) entirely, so the probe's own status is never directly touched by the bug, only
    // whichever two real, unrelated tests happen to sit just before it.
    await writeTranslator(
      dir,
      `
const files = fs.readdirSync('.').filter((f) => f.endsWith('.test.js')).sort();
const REAL_STATUS = { 'a-passes.test.js': 'pass', 'b-fails.test.js': 'fail', 'c-passes.test.js': 'pass' };
const statuses = files.map((f) => REAL_STATUS[f] ?? 'fail');
const n = statuses.length;
if (n >= 3) {
  const i = n - 3;
  const j = n - 2;
  const tmp = statuses[i];
  statuses[i] = statuses[j];
  statuses[j] = tmp;
}
process.stdout.write(JSON.stringify({
  forgeTestReport: 1,
  tests: files.map((f, idx) => ({ name: f, status: statuses[idx] })),
}));
`,
    );
    const result = await runTranslatorProof({
      command: {
        run: `${process.execPath} -e "process.exitCode = 1"`,
        output: { source: 'stdout' },
        format: 'tap',
        translate: `${process.execPath} translate.js {output}`,
      },
      cwd: dir,
      paths: new ProjectPaths(dir),
      createTempPath: makeCreateTempPath(dir),
      probe: SWAP_PROBE,
      runnerVersion: '1.0.0',
      runnerVersionCommand: 'node --version',
      now: NOW,
    });
    expect(result).toMatchObject({ ok: false, failedCheck: 3 });
    if (!result.ok) {
      expect(result.reason).toContain('real baseline run taken before the probe existed');
    }
  });

  it("DISCLOSED, NOT SOLVED: a translator whose swap is keyed by stable NAME, not array position, produces the identical wrong result with or without the probe -- the baseline comparison cannot see it (proof.ts's own doc comment, point 3)", async () => {
    const dir = await tempDir();
    await writeThreeRealFiles(dir);
    // The bug targets "a-passes.test.js" and "b-fails.test.js" BY NAME, not by position -- it fires
    // identically whether or not the probe exists, so a baseline taken without the probe shows the
    // IDENTICAL wrong values this run does, and the check added above has nothing to compare against
    // that would ever differ.
    await writeTranslator(
      dir,
      `
const files = fs.readdirSync('.').filter((f) => f.endsWith('.test.js')).sort();
const REAL_STATUS = { 'a-passes.test.js': 'pass', 'b-fails.test.js': 'fail', 'c-passes.test.js': 'pass' };
const SWAP_BY_NAME = { 'a-passes.test.js': 'fail', 'b-fails.test.js': 'pass' };
process.stdout.write(JSON.stringify({
  forgeTestReport: 1,
  tests: files.map((f) => ({ name: f, status: SWAP_BY_NAME[f] ?? REAL_STATUS[f] ?? 'fail' })),
}));
`,
    );
    const result = await runTranslatorProof({
      command: {
        run: `${process.execPath} -e "process.exitCode = 1"`,
        output: { source: 'stdout' },
        format: 'tap',
        translate: `${process.execPath} translate.js {output}`,
      },
      cwd: dir,
      paths: new ProjectPaths(dir),
      createTempPath: makeCreateTempPath(dir),
      probe: SWAP_PROBE,
      runnerVersion: '1.0.0',
      runnerVersionCommand: 'node --version',
      now: NOW,
    });
    // This is the disclosed, documented residual limit -- NOT the desired behaviour of a real
    // translator, but the honest, proven boundary of what this harness's checks can ever catch
    // without asking whoever proposes a configuration to also hand-verify a sample of the real
    // suite, which `13` F-TEST-11 does not ask of them.
    expect(result.ok).toBe(true);
  });

  it(
    'MUTATION EVIDENCE: a broken custom runner that always exits 0, paired with a translator that ' +
      'reports every FOUND file as "pass", is caught by the dedicated probe check (check 3) alone -- ' +
      "check 2 is blind to it (process/plans/PLAN-M17.md P6's own named mutation). The run command " +
      'genuinely lists the real files on disk (`fs.readdirSync`), so this result GENUINELY depends ' +
      'on the probe having actually been written to the project tree, not on anything hard-coded in ' +
      "the translator script -- exactly what this piece's own mutation evidence (proof.ts copied to " +
      'the scratchpad, injection commented out, confirmed to flip this exact test to `ok: true`, then ' +
      'restored and `cmp`-verified) exercises.',
    async () => {
      const dir = await tempDir();
      await baselineTestFile(dir);
      // A deliberately permissive custom "runner": lists the real `*.test.js` files present on disk
      // and always exits 0, regardless of which files are there -- the realistic "broken runner that
      // swallows failures in its own exit code" check 2 alone cannot see through (0 exit + "pass" is
      // internally consistent from check 2's own point of view; no parseable summary line exists at
      // all for check 2's best-effort half to catch either).
      const command: StructuredTestCommand = {
        run: `${process.execPath} -e "const fs=require('fs'); for (const f of fs.readdirSync('.').filter(f=>f.endsWith('.test.js'))) process.stdout.write('FOUND:'+f+String.fromCharCode(10)); process.exit(0);"`,
        output: { source: 'stdout' },
        format: 'tap', // Irrelevant: translate always wins (reporter.ts's own precedent).
        translate: `${process.execPath} translate.js {output}`,
      };
      // The translator's own real bug: for every real "FOUND:<file>" line it actually reads, it
      // always reports "pass" -- never deriving a real "fail" from anything, no matter what is
      // genuinely found.
      await writeTranslator(
        dir,
        `
const tests = raw
  .split('\\n')
  .filter((l) => l.startsWith('FOUND:'))
  .map((l) => ({ name: l.slice('FOUND:'.length), status: 'pass' }));
process.stdout.write(JSON.stringify({ forgeTestReport: 1, tests }));
`,
      );
      const probe: InjectedProbe = {
        path: 'probe.test.js',
        content: '// a real probe file -- its own content is irrelevant to this fixture\n',
        expectedName: 'probe.test.js',
      };
      const result = await runTranslatorProof({
        command,
        cwd: dir,
        paths: new ProjectPaths(dir),
        createTempPath: makeCreateTempPath(dir),
        probe,
        runnerVersion: '1.0.0',
        runnerVersionCommand: 'node --version',
        now: NOW,
      });
      expect(result).toMatchObject({ ok: false, failedCheck: 3 });
      if (!result.ok) expect(result.reason).toContain('not "fail"');
    },
  );
});

describe('runTranslatorProof -- check 4, determinism (specs/22 M17 P6)', () => {
  it('a translator whose output flips between the two runs fails check 4', async () => {
    const dir = await tempDir();
    await baselineTestFile(dir);
    // A real, external counter file -- the translator script's own state, persisted across every
    // real, independent subprocess invocation `runTranslatorProof` makes. Only increments (and
    // flips) once the real probe file actually exists on disk, so `runTranslatorProof`'s own,
    // separate pre-injection BASELINE call (check 3's own baseline half) never consumes a flip of its
    // own -- the FIRST post-injection run still reports "fail" deterministically, and only the
    // SECOND one flips, isolating this test to check 4 alone.
    await writeTranslator(
      dir,
      `
const path = require('path');
const probeExists = fs.existsSync(path.join(__dirname, 'probe.test.js'));
const counterPath = path.join(__dirname, 'counter.txt');
let count = 0;
try { count = Number(fs.readFileSync(counterPath, 'utf8')); } catch {}
if (probeExists) fs.writeFileSync(counterPath, String(count + 1));
const status = !probeExists || count === 0 ? 'fail' : 'pass';
process.stdout.write(JSON.stringify({
  forgeTestReport: 1,
  tests: [
    { name: 'baseline passes', status: 'pass' },
    { name: 'PROBE deliberately fails', status },
  ],
}));
`,
    );
    const result = await runTranslatorProof({
      command: translatorCommand(true),
      cwd: dir,
      paths: new ProjectPaths(dir),
      createTempPath: makeCreateTempPath(dir),
      probe: REAL_PROBE,
      runnerVersion: '1.0.0',
      runnerVersionCommand: 'node --version',
      now: NOW,
    });
    expect(result).toMatchObject({ ok: false, failedCheck: 4 });
  });
});

describe('runTranslatorProof -- check 5, the zero-tests guard (specs/22 M17 P6)', () => {
  it('a translator that always reports zero tests fails check 5, not check 3', async () => {
    const dir = await tempDir();
    await baselineTestFile(dir);
    await writeTranslator(
      dir,
      `process.stdout.write(JSON.stringify({ forgeTestReport: 1, tests: [] }));`,
    );
    const result = await runTranslatorProof({
      command: translatorCommand(true),
      cwd: dir,
      paths: new ProjectPaths(dir),
      createTempPath: makeCreateTempPath(dir),
      probe: REAL_PROBE,
      runnerVersion: '1.0.0',
      runnerVersionCommand: 'node --version',
      now: NOW,
    });
    expect(result).toMatchObject({ ok: false, failedCheck: 5 });
  });
});

describe('runTranslatorProof -- computeProofSubjectHash (specs/22 M17 P6)', () => {
  it("hashes the translator's own real content when one is declared", () => {
    const command: StructuredTestCommand = {
      run: 'x',
      output: { source: 'stdout' },
      format: 'tap',
      translate: 'y',
    };
    const a = computeProofSubjectHash(command, 'translator body v1');
    const b = computeProofSubjectHash(command, 'translator body v1');
    const c = computeProofSubjectHash(command, 'translator body v2');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("falls back to the proposed command's own JSON when there is no translator to hash", () => {
    const commandA: StructuredTestCommand = {
      run: 'x',
      output: { source: 'stdout' },
      format: 'tap',
    };
    const commandB: StructuredTestCommand = {
      run: 'y',
      output: { source: 'stdout' },
      format: 'tap',
    };
    expect(computeProofSubjectHash(commandA)).not.toBe(computeProofSubjectHash(commandB));
  });
});

describe('runTranslatorProof -- the probe is refused, never silently overwritten (specs/22 M17 P6)', () => {
  it("refuses (RUN-158, naming the real cause -- not RUN-114's own append-only wording) when the probe path already names a real file", async () => {
    const dir = await tempDir();
    await baselineTestFile(dir);
    await writeFile(
      path.join(dir, 'probe.test.js'),
      'not a probe at all -- a real, pre-existing file',
      'utf8',
    );
    await expect(
      runTranslatorProof({
        command: { run: `${process.execPath} --test`, output: { source: 'stdout' }, format: 'tap' },
        cwd: dir,
        paths: new ProjectPaths(dir),
        createTempPath: makeCreateTempPath(dir),
        probe: REAL_PROBE,
        runnerVersion: process.version,
        runnerVersionCommand: 'node --version',
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'RUN-158', cause: { code: 'RUN-114' } });
    // The pre-existing file is untouched -- never clobbered, never deleted by this function's own
    // cleanup (which only ever runs once ITS OWN injection has actually succeeded).
    expect(await readFile(path.join(dir, 'probe.test.js'), 'utf8')).toBe(
      'not a probe at all -- a real, pre-existing file',
    );
  });
});

describe('runTranslatorProof -- an UNTRACKED, same-round leftover at the probe path is reclaimed automatically, never refused (specs/22 M17 P21) (live-run fix 9)', () => {
  it('a real git repo whose probe path is already occupied by a file that was never git-added is cleaned up before writing, and the proof passes on its own merits', async () => {
    const dir = await tempDir();
    await initGitRepo(dir);
    await commitRealFile(
      dir,
      'baseline.test.js',
      `
const test = require('node:test');
const assert = require('node:assert');
test('baseline passes', () => { assert.strictEqual(1 + 1, 2); });
`,
    );
    // Simulates the real live-run defect this fix closes: a live agent session already created
    // this exact file during its own investigation (per the brief: a deliberately-failing probe,
    // watched run for real), then genuinely could not delete it again -- `rm`/`git clean` are not
    // in its own granted exec patterns, and non-interactive mode has no escalation path -- so the
    // leftover sits on disk, UNTRACKED (written directly with `fs`, never `git add`), exactly as a
    // real denied `rm` would leave it.
    await writeFile(
      path.join(dir, 'probe.test.js'),
      '// a leftover from a live session that could not delete its own probe -- never git-added\n',
      'utf8',
    );
    const result = await runTranslatorProof({
      command: { run: `${process.execPath} --test`, output: { source: 'stdout' }, format: 'tap' },
      cwd: dir,
      paths: new ProjectPaths(dir),
      createTempPath: makeCreateTempPath(dir),
      probe: REAL_PROBE,
      runnerVersion: process.version,
      runnerVersionCommand: 'node --version',
      now: NOW,
    });
    // Reclaimed, not refused: this runs to real completion exactly like the happy-path test at the
    // top of this file -- no RUN-158, because the leftover is confirmed untracked and removed
    // before `writeNewFileAtomic` ever has a chance to see it there.
    expect(result).toMatchObject({ ok: true, runnerVersion: process.version });
    // Left exactly as every other passing run leaves it -- the probe itself (now the REAL one this
    // call wrote, not the leftover) is removed afterwards, same as always.
    await expect(readFile(path.join(dir, 'probe.test.js'), 'utf8')).rejects.toThrow();
  });

  it('a real git repo with no collision at all still passes -- the ordinary case, now actually exercised against a real git worktree-shaped lane, not only a bare non-git temp dir', async () => {
    const dir = await tempDir();
    await initGitRepo(dir);
    await commitRealFile(
      dir,
      'baseline.test.js',
      `
const test = require('node:test');
const assert = require('node:assert');
test('baseline passes', () => { assert.strictEqual(1 + 1, 2); });
`,
    );
    const result = await runTranslatorProof({
      command: { run: `${process.execPath} --test`, output: { source: 'stdout' }, format: 'tap' },
      cwd: dir,
      paths: new ProjectPaths(dir),
      createTempPath: makeCreateTempPath(dir),
      probe: REAL_PROBE,
      runnerVersion: process.version,
      runnerVersionCommand: 'node --version',
      now: NOW,
    });
    expect(result).toMatchObject({ ok: true, runnerVersion: process.version });
  });
});

describe('runTranslatorProof -- a TRACKED, genuinely pre-existing project file at the probe path is NEVER reclaimed; RUN-158 still refuses exactly as before (specs/22 M17 P21) (live-run fix 9)', () => {
  it('a real git repo with the collision file actually committed (the Q348 shape) still refuses with RUN-158, and the real file is left completely untouched', async () => {
    const dir = await tempDir();
    await initGitRepo(dir);
    await commitRealFile(
      dir,
      'baseline.test.js',
      `
const test = require('node:test');
const assert = require('node:assert');
test('baseline passes', () => { assert.strictEqual(1 + 1, 2); });
`,
    );
    // A real, pre-existing project file, genuinely committed -- the exact `Q348` shape
    // (`process/SPEC-QUESTIONS.md`): a model reporting a real, already-committed file as its probe
    // path. This must NEVER be reclaimed, no matter how this fix reads the lane's own git state --
    // reclaiming it would silently reopen the already-disclosed, already-fixed incident `RUN-158`
    // exists to prevent.
    await commitRealFile(
      dir,
      'already-exists.test.js',
      "// a real file this project already ships -- never the proof's own probe\n",
    );
    await expect(
      runTranslatorProof({
        command: { run: `${process.execPath} --test`, output: { source: 'stdout' }, format: 'tap' },
        cwd: dir,
        paths: new ProjectPaths(dir),
        createTempPath: makeCreateTempPath(dir),
        probe: { ...REAL_PROBE, path: 'already-exists.test.js' },
        runnerVersion: process.version,
        runnerVersionCommand: 'node --version',
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'RUN-158', cause: { code: 'RUN-114' } });
    // Completely unchanged: the real, tracked file is never touched by this fix's own new
    // untracked-leftover cleanup, exactly as it was never touched before this fix existed.
    expect(await readFile(path.join(dir, 'already-exists.test.js'), 'utf8')).toBe(
      "// a real file this project already ships -- never the proof's own probe\n",
    );
  });
});

describe('runTranslatorProof -- an untracked DIRECTORY at the probe path is never reclaimed either, and never crashes the round (specs/22 M17 P21) (live-run fix 9, round 2)', () => {
  it('a real git repo whose probe path names an untracked directory (not a file) still refuses with RUN-158, the identical shape every other collision gets -- never an uncaught EISDIR', async () => {
    const dir = await tempDir();
    await initGitRepo(dir);
    await commitRealFile(
      dir,
      'baseline.test.js',
      `
const test = require('node:test');
const assert = require('node:assert');
test('baseline passes', () => { assert.strictEqual(1 + 1, 2); });
`,
    );
    // The one real regression two independent critics each found by direct, reproduced experiment
    // in this fix's own first attempt: a live session's own tool-use can only ever write a FILE as
    // its probe (per the brief), but nothing stopped this new reclaim step from also matching a
    // directory that merely happens to be untracked (a test runner's own cache dir, for instance) --
    // `rm` with no `recursive: true` throws `ERR_FS_EISDIR`, uncaught by any of RUN-114/RUN-158/
    // CFG-003/CFG-004, crashing the whole round loop. Worse than this fix's own starting point: that
    // exact collision used to reach `writeNewFileAtomic` and refuse cleanly, the same as any other.
    await mkdir(path.join(dir, 'probe.test.js'));
    await expect(
      runTranslatorProof({
        command: { run: `${process.execPath} --test`, output: { source: 'stdout' }, format: 'tap' },
        cwd: dir,
        paths: new ProjectPaths(dir),
        createTempPath: makeCreateTempPath(dir),
        probe: REAL_PROBE,
        runnerVersion: process.version,
        runnerVersionCommand: 'node --version',
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'RUN-158', cause: { code: 'RUN-114' } });
  });
});

describe('captureRunnerVersion -- exactly the CONFIRMED-TRAP "(npm|pnpm|yarn) (run )?test ..." shapes are refused, and nothing else (SPEC-QUESTIONS.md Q333, critic round 4; re-verified and rebuilt round 5 against a real argv-echoing package.json, never assumed)', () => {
  it("refuses every confirmed npm trap -- both forms, --version and -v -- including with one harmless extra token on either side of the flag (the exact bypass two independent critics confirmed live against round 4's own exact-tail-length check)", async () => {
    const dir = await tempDir();
    await writeArgvEchoProject(dir);
    for (const command of [
      'npm test --version',
      'npm test -v',
      'npm run test --version',
      'npm run test -v',
      'npm test --version --extra',
      'npm test --extra --version',
      'npm test -v --extra',
      'npm run test --version extra',
      'npm run test extra --version',
      'npm run test a b -v c',
    ]) {
      // A 5s bound is generous: a refused command never reaches `runShellCommand` at all, so this
      // can never itself time out -- a real timeout here would mean the refusal did NOT fire.
      const result = await captureRunnerVersion(command, dir, 5_000);
      expect(result.ok, command).toBe(false);
      if (!result.ok) {
        expect(result.reason, command).toContain('ITS OWN version');
        expect(result.timedOut, command).toBeUndefined();
      }
    }
  });

  it("refuses every confirmed pnpm BARE-form trap -- --version and -v (pnpm's own version leaks, the identical mechanism npm uses) AND -V (pnpm's own CLI errors \"Unknown option: 'V'\" instead -- a different mechanism, the real script still never runs) -- including with an extra token in either order", async () => {
    const dir = await tempDir();
    await writeArgvEchoProject(dir);
    for (const command of [
      'pnpm test --version',
      'pnpm test -v',
      'pnpm test -V',
      'pnpm test --version --extra',
      'pnpm test -x --version',
      'pnpm test --version -x',
      'pnpm test -v -x',
      'pnpm test -x -v',
      'pnpm test --extra -V',
      'pnpm test a b --version c',
    ]) {
      const result = await captureRunnerVersion(command, dir, 5_000);
      expect(result.ok, command).toBe(false);
      if (!result.ok) {
        expect(result.reason, command).toContain('ITS OWN version');
        expect(result.timedOut, command).toBeUndefined();
      }
    }
  });

  it('does NOT refuse npm\'s "-V" in either form -- npm recognises only lowercase "-v"/"--version" as its own global version flag; capital "-V" is not one of npm\'s own flags at all (confirmed separately: a bare top-level "npm -V" prints usage, not a version), so the real script genuinely runs -- confirmed by this real argv-echoing project, not merely by the absence of a refusal (npm silently drops the unrecognised flag rather than forwarding it, so the real script sees an EMPTY argv, not "-V" itself)', async () => {
    const dir = await tempDir();
    await writeArgvEchoProject(dir);
    for (const command of ['npm test -V', 'npm run test -V']) {
      const result = await captureRunnerVersion(command, dir, 30_000);
      expect(result.ok, command).toBe(true);
      if (result.ok) {
        expect(result.runnerVersion, command).toContain('REAL_SCRIPT_RAN ARGV=[]');
      }
    }
  }, 60_000);

  it("does NOT refuse pnpm's explicit \"run test\" form, for any of --version/-v/-V -- round 4's own blanket refusal of this form was over-broad: pnpm forwards the flag to the real script correctly here, unlike its bare form above, confirmed by the real script's own printed argv", async () => {
    const dir = await tempDir();
    await writeArgvEchoProject(dir);
    for (const [command, expectedArg] of [
      ['pnpm run test --version', '"--version"'],
      ['pnpm run test -v', '"-v"'],
      ['pnpm run test -V', '"-V"'],
      ['pnpm run test --version --extra', '"--version","--extra"'],
      ['pnpm run test extra -V', '"extra","-V"'],
    ] as const) {
      const result = await captureRunnerVersion(command, dir, 30_000);
      expect(result.ok, command).toBe(true);
      if (result.ok) {
        expect(result.runnerVersion, command).toContain('REAL_SCRIPT_RAN');
        expect(result.runnerVersion, command).toContain(expectedArg);
      }
    }
  }, 60_000);

  it('does NOT refuse yarn, in either form, for any of --version/-v/-V -- round 4\'s own claim that this was "confirmed live for all three" package managers was false for yarn: no test in that round ever actually executed "yarn test --version" and checked whose version came out. Yarn classic (1.22.22, the version installed in this repo) forwards the flag to the real script correctly in BOTH forms, confirmed by the real script\'s own printed argv', async () => {
    const dir = await tempDir();
    await writeArgvEchoProject(dir);
    for (const [command, expectedArg] of [
      ['yarn test --version', '"--version"'],
      ['yarn test -v', '"-v"'],
      ['yarn test -V', '"-V"'],
      ['yarn run test --version', '"--version"'],
      ['yarn run test -v', '"-v"'],
      ['yarn run test -V', '"-V"'],
      ['yarn test --version --extra', '"--version","--extra"'],
      ['yarn test -v -V --version', '"-v","-V","--version"'],
    ] as const) {
      const result = await captureRunnerVersion(command, dir, 30_000);
      expect(result.ok, command).toBe(true);
      if (result.ok) {
        expect(result.runnerVersion, command).toContain('REAL_SCRIPT_RAN');
        expect(result.runnerVersion, command).toContain(expectedArg);
      }
    }
  }, 60_000);

  it('a literal "--" separator always forwards the flag to the real script, for every package manager and form, never refused -- the pre-existing safe-passthrough design intent, re-verified unchanged by this round\'s rebuild', async () => {
    const dir = await tempDir();
    await writeArgvEchoProject(dir);
    for (const command of [
      'npm test -- --version',
      'npm run test -- --version',
      'pnpm test -- --version',
      'pnpm run test -- --version',
      'yarn test -- --version',
      'yarn run test -- --version',
    ]) {
      const result = await captureRunnerVersion(command, dir, 30_000);
      expect(result.ok, command).toBe(true);
      if (result.ok) {
        expect(result.runnerVersion, command).toContain('REAL_SCRIPT_RAN');
        expect(result.runnerVersion, command).toContain('--version');
      }
    }
  }, 60_000);

  it('does not refuse an ordinary "npm test"/"pnpm run test"/"yarn test" -- the real run/filter shape this field never actually receives in production, with no trailing version flag -- real execution still happens (each package manager prints its own real, deterministic "no package.json here" error, proving the command reached a real shell rather than being turned away by the version-probe check)', async () => {
    const dir = await tempDir();
    for (const command of ['npm test', 'pnpm run test', 'yarn test']) {
      const result = await captureRunnerVersion(command, dir, 30_000);
      expect(result.ok, command).toBe(true);
    }
  }, 60_000);
});
