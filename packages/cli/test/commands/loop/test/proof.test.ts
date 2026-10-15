/**
 * `runTranslatorProof` (`13` F-TEST-11) -- real subprocess runs throughout: a real `node --test`
 * invocation for the happy path, and real `node -e` translator subprocesses (never hand-built
 * payloads) for each of the five checks' own failure modes.
 *
 * @see specs/13 F-TEST-11
 * @see specs/22 M17 P6
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ProjectPaths } from '@forge/core/fs';
import type { StructuredTestCommand } from '@forge/schemas/config';
import { afterEach, describe, expect, it } from 'vitest';

import {
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

/** Fixed, injected clock (`QUALITY-BAR.md` R10) -- every test passes the identical value, so nothing
 * here ever reads a real wall clock. */
const NOW = () => '2026-01-01T00:00:00.000Z';

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
