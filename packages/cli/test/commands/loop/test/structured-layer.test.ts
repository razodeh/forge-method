/**
 * `runStructuredTestLayer` — the structured `execution.testCommands.<layer>` form (`18` §18.3, `13`
 * F-TEST-7 point 2, F-TEST-11): built-in parsers, the `translate` escape hatch, and the `{output}`
 * lifecycle FORGE itself owns.
 *
 * @see specs/09 §9.5
 * @see specs/18 §18.3
 * @see specs/22 M17 P3
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ProjectPaths } from '@forge/core/fs';
import type { StructuredTestCommand } from '@forge/schemas/config';
import { afterEach, describe, expect, it } from 'vitest';

import { runStructuredTestLayer } from '../../../../src/commands/loop/test/reporter.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-structured-layer-'));
  dirs.push(dir);
  return dir;
}

let tempCounter = 0;
function makeCreateTempPath(dir: string): () => string {
  return () => path.join(dir, `tmp-output-${String((tempCounter += 1))}.raw`);
}

describe('runStructuredTestLayer -- stdout source, built-in format, no translate (specs/22 M17 P3)', () => {
  it('a real node --test TAP run over stdout is read correctly end to end', async () => {
    const dir = await tempDir();
    await writeFile(
      path.join(dir, 'sample.test.js'),
      `
const test = require('node:test');
const assert = require('node:assert');
test('AC-014-2 returns 422 for an empty invoice', () => { assert.strictEqual(1 + 1, 2); });
test('AC-014-3 fails on purpose', () => { assert.strictEqual(1, 2); });
`,
      'utf8',
    );
    const command: StructuredTestCommand = {
      run: `${process.execPath} --test --test-reporter=tap sample.test.js`,
      output: { source: 'stdout' },
      format: 'tap',
    };
    const result = await runStructuredTestLayer(
      command,
      dir,
      new ProjectPaths(dir),
      makeCreateTempPath(dir),
    );
    if (result.outcome !== 'ran') throw new Error(`expected 'ran', got ${result.outcome}`);
    const byName = new Map(result.report.outcomes.map((o) => [o.name, o]));
    expect(byName.get('AC-014-2 returns 422 for an empty invoice')).toMatchObject({
      acId: 'AC-014-2',
      status: 'pass',
    });
    expect(byName.get('AC-014-3 fails on purpose')).toMatchObject({
      acId: 'AC-014-3',
      status: 'fail',
    });
  });

  it('a forge-json acId, when present, is used verbatim instead of re-extracting from the name', async () => {
    const dir = await tempDir();
    const command: StructuredTestCommand = {
      run: `echo '${JSON.stringify({ forgeTestReport: 1, tests: [{ name: 'something else entirely', status: 'pass', acId: 'AC-999' }] })}'`,
      output: { source: 'stdout' },
      format: 'forge-json',
    };
    const result = await runStructuredTestLayer(
      command,
      dir,
      new ProjectPaths(dir),
      makeCreateTempPath(dir),
    );
    if (result.outcome !== 'ran') throw new Error(`expected 'ran', got ${result.outcome}`);
    expect(result.report.outcomes[0]).toMatchObject({
      acId: 'AC-999',
      name: 'something else entirely',
    });
  });

  it('a forge-json "message", when present, reaches the real TestOutcome unchanged (Q346) -- round 2 critic: outcomeFromReportEntry was silently dropping it', async () => {
    const dir = await tempDir();
    const command: StructuredTestCommand = {
      run: `echo '${JSON.stringify({ forgeTestReport: 1, tests: [{ name: 'AC-014-3 fails on purpose', status: 'fail', kind: 'assertion', message: 'expected 4, got 5' }] })}'`,
      output: { source: 'stdout' },
      format: 'forge-json',
    };
    const result = await runStructuredTestLayer(
      command,
      dir,
      new ProjectPaths(dir),
      makeCreateTempPath(dir),
    );
    if (result.outcome !== 'ran') throw new Error(`expected 'ran', got ${result.outcome}`);
    expect(result.report.outcomes[0]).toMatchObject({
      name: 'AC-014-3 fails on purpose',
      status: 'fail',
      message: 'expected 4, got 5',
    });
  });

  it('output that does not parse as the declared format is a real, diagnosable tool-error', async () => {
    const dir = await tempDir();
    const command: StructuredTestCommand = {
      run: 'echo "not valid tap or anything else"',
      output: { source: 'stdout' },
      format: 'forge-json',
    };
    const result = await runStructuredTestLayer(
      command,
      dir,
      new ProjectPaths(dir),
      makeCreateTempPath(dir),
    );
    expect(result.outcome).toBe('tool-error');
  });
});

describe('runStructuredTestLayer -- file source, the {output} lifecycle FORGE owns (specs/22 M17 P3) (18 §18.3)', () => {
  it('a real run that writes its declared output.path is read correctly', async () => {
    const dir = await tempDir();
    const command: StructuredTestCommand = {
      run: `node -e "require('fs').writeFileSync('report.json', JSON.stringify({forgeTestReport:1,tests:[{name:'AC-014-2 ok',status:'pass'}]}))"`,
      output: { source: 'file', path: 'report.json' },
      format: 'forge-json',
    };
    const result = await runStructuredTestLayer(
      command,
      dir,
      new ProjectPaths(dir),
      makeCreateTempPath(dir),
    );
    if (result.outcome !== 'ran') throw new Error(`expected 'ran', got ${result.outcome}`);
    expect(result.report.outcomes).toEqual([
      { name: 'AC-014-2 ok', status: 'pass', acId: 'AC-014-2' },
    ]);
  });

  it('MUTATION EVIDENCE: a stale report left over from an earlier run is never read -- FORGE deletes output.path before every run', async () => {
    const dir = await tempDir();
    // A sentinel from a "previous run" the real run below does NOT rewrite (a bare `true`).
    await writeFile(
      path.join(dir, 'report.json'),
      JSON.stringify({
        forgeTestReport: 1,
        tests: [{ name: 'STALE-SENTINEL-MUST-NEVER-BE-READ', status: 'pass' }],
      }),
      'utf8',
    );
    const command: StructuredTestCommand = {
      run: 'true',
      output: { source: 'file', path: 'report.json' },
      format: 'forge-json',
    };
    const result = await runStructuredTestLayer(
      command,
      dir,
      new ProjectPaths(dir),
      makeCreateTempPath(dir),
    );
    // The stale file is gone (deleted pre-run) and `true` never recreates it -- a real, typed
    // tool-error ("did not produce its declared output file"), never the stale sentinel content.
    expect(result.outcome).toBe('tool-error');
    if (result.outcome === 'ran') {
      expect(
        result.report.outcomes.some((o) => o.name === 'STALE-SENTINEL-MUST-NEVER-BE-READ'),
      ).toBe(false);
    }
  });

  it('a declared output.path is actually absent on disk immediately before the real run starts', async () => {
    const dir = await tempDir();
    await writeFile(path.join(dir, 'report.json'), 'stale content that must be deleted', 'utf8');
    const command: StructuredTestCommand = {
      // Checks for the stale file's own presence *inside* the run itself, before this run could
      // possibly have rewritten it yet -- proves the delete happens strictly before `run` starts,
      // not merely before this function returns.
      run: `node -e "process.exit(require('fs').existsSync('report.json') ? 1 : 0)"`,
      output: { source: 'file', path: 'report.json' },
      format: 'forge-json',
    };
    const result = await runStructuredTestLayer(
      command,
      dir,
      new ProjectPaths(dir),
      makeCreateTempPath(dir),
    );
    // The command above exits 0 (file was absent) and never writes report.json itself -- so this is
    // a tool-error (did not produce the output), proving deletion happened, not a thrown assertion.
    expect(result.outcome).toBe('tool-error');
  });

  it('output.path escaping the project is a real CFG-003, not a silent tool-error', async () => {
    const dir = await tempDir();
    const command = {
      run: 'true',
      output: { source: 'file', path: '../escape.json' },
      format: 'forge-json',
    } as unknown as StructuredTestCommand;
    await expect(
      runStructuredTestLayer(command, dir, new ProjectPaths(dir), makeCreateTempPath(dir)),
    ).rejects.toMatchObject({ code: 'CFG-003' });
  });
});

describe('runStructuredTestLayer -- the translate escape hatch (specs/22 M17 P3) (13 F-TEST-11)', () => {
  it('a real translator (file-sourced {output}) converts a custom raw format into forge-test-report', async () => {
    const dir = await tempDir();
    await writeFile(
      path.join(dir, 'translate.js'),
      `
const fs = require('fs');
const raw = fs.readFileSync(process.argv[2], 'utf8');
const lines = raw.trim().split('\\n');
const tests = lines.map((line) => {
  const [status, name] = line.split('|');
  return { name, status: status === 'PASS' ? 'pass' : 'fail' };
});
process.stdout.write(JSON.stringify({ forgeTestReport: 1, tests }));
`,
      'utf8',
    );
    const command: StructuredTestCommand = {
      run: `node -e "require('fs').writeFileSync('raw.log', 'PASS|AC-014-1 one\\nFAIL|AC-014-2 two\\n')"`,
      output: { source: 'file', path: 'raw.log' },
      format: 'junit-xml', // Irrelevant: translate, when present, always wins over format.
      translate: `${process.execPath} translate.js {output}`,
    };
    const result = await runStructuredTestLayer(
      command,
      dir,
      new ProjectPaths(dir),
      makeCreateTempPath(dir),
    );
    if (result.outcome !== 'ran') throw new Error(`expected 'ran', got ${result.outcome}`);
    const byName = new Map(result.report.outcomes.map((o) => [o.name, o]));
    expect(byName.get('AC-014-1 one')?.status).toBe('pass');
    expect(byName.get('AC-014-2 two')?.status).toBe('fail');
  });

  it('a real translator (stdout-sourced {output}): FORGE materialises the captured stdout into a file for it', async () => {
    const dir = await tempDir();
    await writeFile(
      path.join(dir, 'translate.js'),
      `
const fs = require('fs');
const raw = fs.readFileSync(process.argv[2], 'utf8');
process.stdout.write(JSON.stringify({ forgeTestReport: 1, tests: [{ name: raw.trim(), status: 'pass' }] }));
`,
      'utf8',
    );
    const command: StructuredTestCommand = {
      run: `node -e "process.stdout.write('AC-014-7 came from stdout')"`,
      output: { source: 'stdout' },
      format: 'tap',
      translate: `${process.execPath} translate.js {output}`,
    };
    const result = await runStructuredTestLayer(
      command,
      dir,
      new ProjectPaths(dir),
      makeCreateTempPath(dir),
    );
    if (result.outcome !== 'ran') throw new Error(`expected 'ran', got ${result.outcome}`);
    expect(result.report.outcomes).toEqual([
      { name: 'AC-014-7 came from stdout', status: 'pass', acId: 'AC-014-7' },
    ]);
  });

  it('a translator-reported "message" reaches the real TestOutcome unchanged too (Q346): both outcomeFromReportEntry call sites are covered', async () => {
    const dir = await tempDir();
    await writeFile(
      path.join(dir, 'translate.js'),
      `
process.stdout.write(JSON.stringify({
  forgeTestReport: 1,
  tests: [{ name: 'AC-014-9 translated failure', status: 'fail', kind: 'assertion', message: 'boom from the translator' }],
}));
`,
      'utf8',
    );
    const command: StructuredTestCommand = {
      run: 'true',
      output: { source: 'stdout' },
      format: 'tap',
      translate: `${process.execPath} translate.js {output}`,
    };
    const result = await runStructuredTestLayer(
      command,
      dir,
      new ProjectPaths(dir),
      makeCreateTempPath(dir),
    );
    if (result.outcome !== 'ran') throw new Error(`expected 'ran', got ${result.outcome}`);
    expect(result.report.outcomes[0]).toMatchObject({
      name: 'AC-014-9 translated failure',
      status: 'fail',
      message: 'boom from the translator',
    });
  });

  it('a translator that exits non-zero is a typed tool-error, even though its stdout happens to be valid forge-json', async () => {
    const dir = await tempDir();
    const command: StructuredTestCommand = {
      run: 'true',
      output: { source: 'stdout' },
      format: 'tap',
      translate: `node -e "process.stdout.write(JSON.stringify({forgeTestReport:1,tests:[]})); process.exit(1)"`,
    };
    const result = await runStructuredTestLayer(
      command,
      dir,
      new ProjectPaths(dir),
      makeCreateTempPath(dir),
    );
    expect(result.outcome).toBe('tool-error');
  });

  it('a translator whose stdout does not parse as forge-test-report is a typed tool-error', async () => {
    const dir = await tempDir();
    const command: StructuredTestCommand = {
      run: 'true',
      output: { source: 'stdout' },
      format: 'tap',
      translate: 'node -e "process.stdout.write(\'garbage, not json\')"',
    };
    const result = await runStructuredTestLayer(
      command,
      dir,
      new ProjectPaths(dir),
      makeCreateTempPath(dir),
    );
    expect(result.outcome).toBe('tool-error');
  });

  it('MUTATION EVIDENCE: a translator that reports a genuinely empty report is passed through faithfully, never read as a pass', async () => {
    const dir = await tempDir();
    const command: StructuredTestCommand = {
      run: 'true',
      output: { source: 'stdout' },
      format: 'tap',
      translate: `node -e "process.stdout.write(JSON.stringify({forgeTestReport:1,tests:[]}))"`,
    };
    const result = await runStructuredTestLayer(
      command,
      dir,
      new ProjectPaths(dir),
      makeCreateTempPath(dir),
    );
    // The zero-tests guard (loop/test/run.ts) is what turns this into a real "problems" entry once a
    // caller runs it through that layer -- this function's own job, proven here, is to never mask
    // the emptiness itself: no fabricated outcome, no silent "ok" sentinel, just the real, empty list.
    if (result.outcome !== 'ran') throw new Error(`expected 'ran', got ${result.outcome}`);
    expect(result.outcome).toBe('ran');
    expect(result.report.outcomes).toEqual([]);
  });

  it('a translator that times out is reported as the single typed timeout outcome, not a hang', async () => {
    const dir = await tempDir();
    const command: StructuredTestCommand = {
      run: 'true',
      output: { source: 'stdout' },
      format: 'tap',
      translate: `node -e "setTimeout(() => {}, 60000)"`,
      timeoutMs: 300,
    };
    const result = await runStructuredTestLayer(
      command,
      dir,
      new ProjectPaths(dir),
      makeCreateTempPath(dir),
    );
    if (result.outcome !== 'ran') throw new Error(`expected 'ran', got ${result.outcome}`);
    expect(result.report.outcomes).toHaveLength(1);
    expect(result.report.outcomes[0]?.kind).toBe('timeout');
  }, 10_000);
});

describe('runStructuredTestLayer -- run itself times out: the process tree is dead before anything downstream could see partial output (specs/22 M17 P3)', () => {
  it('a translator is never invoked when "run" itself times out -- no marker file from the translator ever appears', async () => {
    const dir = await tempDir();
    const command: StructuredTestCommand = {
      run: `node -e "setTimeout(() => {}, 60000)"`,
      output: { source: 'stdout' },
      format: 'tap',
      translate: `node -e "require('fs').writeFileSync('translator-ran.marker', 'yes')"`,
      timeoutMs: 300,
    };
    const result = await runStructuredTestLayer(
      command,
      dir,
      new ProjectPaths(dir),
      makeCreateTempPath(dir),
    );
    if (result.outcome !== 'ran') throw new Error(`expected 'ran', got ${result.outcome}`);
    expect(result.report.outcomes).toEqual([
      expect.objectContaining({ status: 'fail', kind: 'timeout' }),
    ]);
    await expect(readFile(path.join(dir, 'translator-ran.marker'), 'utf8')).rejects.toThrow();
  }, 10_000);
});

describe('runStructuredTestLayer -- commandToRun override (specs/22 M17 P3)', () => {
  it('when given, runs commandToRun instead of command.run -- the seam a future scope/filter rendering step uses', async () => {
    const dir = await tempDir();
    const command: StructuredTestCommand = {
      run: 'echo "should not run this one"',
      output: { source: 'stdout' },
      format: 'forge-json',
    };
    const result = await runStructuredTestLayer(
      command,
      dir,
      new ProjectPaths(dir),
      makeCreateTempPath(dir),
      `echo '${JSON.stringify({ forgeTestReport: 1, tests: [{ name: 'from override', status: 'pass' }] })}'`,
    );
    if (result.outcome !== 'ran') throw new Error(`expected 'ran', got ${result.outcome}`);
    expect(result.report.outcomes[0]?.name).toBe('from override');
  });
});
