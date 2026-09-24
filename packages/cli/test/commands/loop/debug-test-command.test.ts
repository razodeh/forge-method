/**
 * `forge debug` REPRODUCE runs the project's own configured test command (`PLAN-M13.md` P23, `SPEC-QUESTIONS.md` Q230,
 * `Q222` D2; `13` §13.2 F-DEBUG-1 step 2 "an existing failing test"; `20` §20.1).
 *
 * Through the real `debugSymptom` (the real RCA loop, a real lane, the real confined runner) with only the model faked. The
 * fixture diagnostician declares `exec: ['true']`, so `node test-unit.mjs` is in its grant ONLY because the project set
 * `execution.testCommands.unit`. The control runs the identical proposal with the config key unset.
 */
import { createRequire } from 'node:module';
import { chmod, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { execa } from 'execa';
import { readArtifact } from '@forge/core/artifacts';
import type { SessionRequest } from '@forge/adapter-kit';
import { DEFAULT_CONFIG } from '@forge/schemas/config';
import { FakePlatformAdapter } from '@forge/testkit';
import { afterEach, describe, expect, it } from 'vitest';
import * as YAML from 'yaml';

import { debugSymptom, type DebugDeps } from '../../../src/commands/loop/debug.ts';
import {
  AGENTS_ROOT,
  CHECKS_ROOT,
  cleanupAll,
  createTestProject,
  writeFixtureAgent,
} from './helpers.ts';

afterEach(cleanupAll);

type Project = Awaited<ReturnType<typeof createTestProject>>;

const TEST_COMMAND = 'node test-unit.mjs';

/** PROVE's own real `forge test run` re-check (`loop.ts`) shells the literal string `"forge test run"`,
 * which assumes a real, installed `forge` binary — not true inside this monorepo's own dev/test
 * environment. A tiny, real, executable shim on `PATH` (the identical technique `debug.test.ts`'s own
 * `installForgeShim` already establishes) makes it genuinely resolvable, so a scenario that reaches PROVE
 * (this file's own new `<command> <path>` full-flow test) does not escalate for want of a `forge` binary
 * rather than a real fix decision. Only needed once this file has a scenario that reaches FIX/PROVE at all. */
async function installForgeShim(): Promise<{ readonly restorePath: () => void }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-shim-'));
  const launcher = fileURLToPath(new URL('../../../bin/forge.mjs', import.meta.url));
  const shimPath = path.join(dir, 'forge');
  await writeFile(shimPath, `#!/bin/sh\nexec "${process.execPath}" "${launcher}" "$@"\n`, 'utf8');
  await chmod(shimPath, 0o755);
  const originalPath = process.env['PATH'];
  process.env['PATH'] = `${dir}${path.delimiter}${originalPath ?? ''}`;
  return {
    restorePath: () => {
      process.env['PATH'] = originalPath;
    },
  };
}

/** `debug.test.ts`'s own established technique, re-used here: `execution.testCommands.unit` pointed at
 * this monorepo's own real, installed vitest, resolved by absolute path so it runs regardless of the
 * target directory's own `node_modules` — the only reliable way to make PROVE's own real `forge test run`
 * layer re-check genuinely pass (`layer.ts`'s ecosystem-aware runner expects a real test-reporter shaped
 * command; a hand-written fake script is not one). */
function resolveRealVitestEntry(): string {
  const require = createRequire(import.meta.url);
  const packageJsonPath = require.resolve('vitest/package.json');
  const packageJson = require(packageJsonPath) as {
    readonly bin?: Readonly<Record<string, string>>;
  };
  const binRelative = packageJson.bin?.['vitest'];
  if (binRelative === undefined)
    throw new Error('vitest/package.json has no real "vitest" bin entry.');
  return path.join(path.dirname(packageJsonPath), binRelative);
}
const REAL_VITEST_CMD = `${process.execPath} ${resolveRealVitestEntry()} run --root .`;

/** A project whose single real vitest test (`bug.test.js`) tracks `fixed.marker`'s own presence, exactly
 * the way `debug.test.ts`'s `seedReproducibleProject` does — so `forge test run` (PROVE's own full-layer
 * re-check) and a `<REAL_VITEST_CMD> bug.test.js` reproduction (REPRODUCE's own `<command> <path>`
 * proposal, `PLAN-M14.md` P24) both genuinely fail before the fix and genuinely pass after it. A REAL,
 * committed `.forge/config.yaml` (not just the in-memory `DebugDeps.config` this file's other fixtures get
 * away with) is required here specifically: PROVE's `forge test run` re-check shells a SEPARATE real `forge`
 * subprocess (`createRcaShell`'s `'engine'` origin, via `installForgeShim`) inside the lane, which reads
 * `execution.testCommands` back off disk — an in-memory-only config would leave that subprocess seeing no
 * configured test command at all, failing the layer check for a reason that has nothing to do with this
 * piece's own `<command> <path>` extension. */
async function projectWithRealVitestProject(exec: readonly string[] = ['true']): Promise<Project> {
  const project = await createTestProject();
  await writeFixtureAgent(project.dir, 'diagnostician', 'Diagnostician', { write: true, exec });
  const config = {
    ...DEFAULT_CONFIG,
    execution: { ...DEFAULT_CONFIG.execution, testCommands: { unit: REAL_VITEST_CMD } },
  };
  await mkdir(path.join(project.dir, '.forge'), { recursive: true });
  await writeFile(path.join(project.dir, '.forge', 'config.yaml'), YAML.stringify(config), 'utf8');
  await writeFile(path.join(project.dir, 'package.json'), '{}', 'utf8');
  await writeFile(
    path.join(project.dir, 'bug.test.js'),
    `import { test, expect } from 'vitest';
import { existsSync } from 'node:fs';
test('the real fix has landed', () => { expect(existsSync('fixed.marker')).toBe(true); });
`,
    'utf8',
  );
  await execa('git', ['add', '-A'], { cwd: project.dir });
  await execa('git', ['commit', '--quiet', '-m', 'seed a real, reproducible defect'], {
    cwd: project.dir,
  });
  return project;
}

async function projectWithTestScript(exec: readonly string[] = ['true']): Promise<Project> {
  const project = await createTestProject();
  await writeFixtureAgent(project.dir, 'diagnostician', 'Diagnostician', {
    write: true,
    exec,
  });
  // The fake test command: fails, and leaves a record of every run in a file the lane owns.
  await writeFile(
    path.join(project.dir, 'test-unit.mjs'),
    "import { appendFileSync } from 'node:fs';\nappendFileSync('runs.log', 'run\\n');\nprocess.exit(1);\n",
  );
  await execa('git', ['add', '-A'], { cwd: project.dir });
  await execa('git', ['commit', '--quiet', '-m', 'seed a failing unit suite'], {
    cwd: project.dir,
  });
  return project;
}

/** Like `projectWithTestScript`, but the fake command ALSO records its own real argv (one JSON line per
 * run) to an absolute path OUTSIDE the lane worktree (`project.dir` itself, baked into the committed script
 * before any lane is created) — the RCA loop's own real `runShell` runs the script with the LANE as its cwd,
 * so a relative log path would land in a worktree this test cannot easily locate; an absolute one survives
 * whichever lane runs it, real ground truth for whether REPRODUCE and PROVE proposed/ran the identical string
 * (`PLAN-M14.md` P24). Fails until `fixed.marker` exists (relative to cwd — the lane), so a scripted FIX can
 * make it pass. */
async function projectWithArgvRecordingTestScript(
  exec: readonly string[] = ['true'],
): Promise<Project> {
  const project = await createTestProject();
  await writeFixtureAgent(project.dir, 'diagnostician', 'Diagnostician', { write: true, exec });
  const argvLog = path.join(project.dir, 'argv.log');
  await writeFile(
    path.join(project.dir, 'test-unit.mjs'),
    [
      "import { appendFileSync, existsSync } from 'node:fs';",
      `appendFileSync(${JSON.stringify(argvLog)}, JSON.stringify(process.argv.slice(2)) + '\\n');`,
      "process.exit(existsSync('fixed.marker') ? 0 : 1);",
      '',
    ].join('\n'),
  );
  await mkdir(path.join(project.dir, 'tests'), { recursive: true });
  await writeFile(path.join(project.dir, 'tests', 'x.test.ts'), '');
  await execa('git', ['add', '-A'], { cwd: project.dir });
  await execa('git', ['commit', '--quiet', '-m', 'seed an argv-recording failing unit suite'], {
    cwd: project.dir,
  });
  return project;
}

async function argvCalls(project: Project): Promise<readonly (readonly string[])[]> {
  try {
    const text = await readFile(path.join(project.dir, 'argv.log'), 'utf8');
    return text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as readonly string[]);
  } catch {
    return [];
  }
}

function deps(
  project: Project,
  adapter: FakePlatformAdapter,
  unit: string | undefined,
  testRoots?: readonly string[],
): DebugDeps {
  return {
    paths: project.paths,
    projectRoot: project.dir,
    config: {
      ...project.config,
      execution: {
        ...project.config.execution,
        testCommands: unit === undefined ? {} : { unit },
        ...(testRoots === undefined ? {} : { testRoots: [...testRoots] }),
      },
    },
    adapter,
    checksRoot: CHECKS_ROOT,
    agentsRoot: AGENTS_ROOT,
    env: process.env,
  };
}

function proposeAlways(adapter: FakePlatformAdapter, command: string): SessionRequest[] {
  const seen: SessionRequest[] = [];
  adapter.script(
    (request: SessionRequest) => {
      seen.push(request);
      return request.systemPrompt.text.includes('REPRODUCE attempt');
    },
    { structured: { command } },
  );
  return seen;
}

async function events(project: Project): Promise<string> {
  const runs = await readdir(path.join(project.dir, '.forge', 'state', 'runs'));
  const texts = await Promise.all(
    runs.map((run) =>
      readFile(path.join(project.dir, '.forge', 'state', 'runs', run, 'events.ndjson'), 'utf8'),
    ),
  );
  return texts.join('\n');
}

describe('forge debug: REPRODUCE runs the project’s configured test command', () => {
  it('the configured unit command is accepted, run in the lane, its non-zero exit is the reproduction, and the loop goes on to ISOLATE with it', async () => {
    const project = await projectWithTestScript();
    const adapter = new FakePlatformAdapter();
    const seen = proposeAlways(adapter, TEST_COMMAND);
    // One distinct hypothesis: the loop ends here with a typed refusal, after it has used the reproduction.
    adapter.script((request) => request.systemPrompt.text.includes('ISOLATE for'), {
      structured: { scope: 'test-unit.mjs' },
    });
    adapter.script((request) => request.systemPrompt.text.includes('HYPOTHESISE for'), {
      structured: { claims: ['only one'] },
    });

    await expect(
      debugSymptom(deps(project, adapter, TEST_COMMAND), 'the unit suite fails'),
    ).rejects.toMatchObject({
      code: 'RUN-060',
    });

    // The loop reached ISOLATE, whose input is the reproduction command: it was a usable, non-zero reproduction.
    const isolate = seen.find((request) => request.systemPrompt.text.includes('ISOLATE for'));
    expect(isolate?.prompt).toContain(TEST_COMMAND);
    // REPRODUCE was told which commands run as written, so a read-only session can propose the right one.
    const reproduce = seen.find((request) =>
      request.systemPrompt.text.includes('REPRODUCE attempt 1'),
    );
    expect(reproduce?.systemPrompt.text).toContain(`\`${TEST_COMMAND}\``);
    // No proposal was refused.
    expect(await events(project)).not.toContain('proposed-command-refused');
  }, 120_000);

  it('control: the identical proposal with execution.testCommands.unit unset is refused as not in the grant, five times, and the loop never reaches ISOLATE', async () => {
    const project = await projectWithTestScript();
    const adapter = new FakePlatformAdapter();
    const seen = proposeAlways(adapter, TEST_COMMAND);

    const result = await debugSymptom(deps(project, adapter, undefined), 'the unit suite fails');

    expect(result.outcome).toBe('needs-more-evidence');
    if (result.outcome !== 'needs-more-evidence') throw new Error('unreachable');
    expect(result.refusedCommands?.map((entry) => [entry.code, entry.reason])).toEqual(
      Array.from({ length: 5 }, () => ['RUN-095', 'not-in-grant']),
    );
    expect(seen.some((request) => request.systemPrompt.text.includes('ISOLATE for'))).toBe(false);
    // Not told about commands it does not have.
    const reproduce = seen.find((request) =>
      request.systemPrompt.text.includes('REPRODUCE attempt 1'),
    );
    expect(reproduce?.systemPrompt.text).not.toContain('test commands run exactly');
  }, 120_000);

  it('one argument more than the configured command is refused as not in the grant, and recorded as a refused command', async () => {
    const project = await projectWithTestScript();
    const adapter = new FakePlatformAdapter();
    proposeAlways(adapter, `${TEST_COMMAND} --watch`);

    const result = await debugSymptom(deps(project, adapter, TEST_COMMAND), 'the unit suite fails');

    expect(result.outcome).toBe('needs-more-evidence');
    if (result.outcome !== 'needs-more-evidence') throw new Error('unreachable');
    expect(result.refusedCommands?.every((entry) => entry.reason === 'not-in-grant')).toBe(true);
    expect(await events(project)).toContain('proposed-command-refused');
  }, 120_000);

  it('a diagnostician that may run no command is neither told about the test commands nor granted them: the derivation never turns "no exec" into "some exec"', async () => {
    const project = await projectWithTestScript([]);
    const adapter = new FakePlatformAdapter();
    const seen = proposeAlways(adapter, TEST_COMMAND);

    const result = await debugSymptom(deps(project, adapter, TEST_COMMAND), 'the unit suite fails');

    expect(result.outcome).toBe('needs-more-evidence');
    if (result.outcome !== 'needs-more-evidence') throw new Error('unreachable');
    expect(result.refusedCommands?.map((entry) => entry.reason)).toEqual(
      Array.from({ length: 5 }, () => 'not-in-grant'),
    );
    const reproduce = seen.find((request) =>
      request.systemPrompt.text.includes('REPRODUCE attempt 1'),
    );
    expect(reproduce?.systemPrompt.text).not.toContain('test commands run exactly');
  }, 120_000);
});

describe('forge debug REPRODUCE/PROVE run <command> <path> (PLAN-M14.md P24)', () => {
  it('execution.testRoots narrows the extension end to end: a path outside the one configured root is refused as test-path; a path inside it is accepted', async () => {
    const project = await projectWithArgvRecordingTestScript();
    await writeFile(path.join(project.dir, 'outside.test.ts'), '');
    await execa('git', ['add', '-A'], { cwd: project.dir });
    await execa('git', ['commit', '--quiet', '-m', 'add a test file outside the configured root'], {
      cwd: project.dir,
    });

    const outsideAdapter = new FakePlatformAdapter();
    proposeAlways(outsideAdapter, `${TEST_COMMAND} outside.test.ts`);
    const outside = await debugSymptom(
      deps(project, outsideAdapter, TEST_COMMAND, ['tests']),
      'the unit suite fails',
    );
    expect(outside.outcome).toBe('needs-more-evidence');
    if (outside.outcome !== 'needs-more-evidence') throw new Error('unreachable');
    expect(outside.refusedCommands?.map((entry) => entry.reason)).toEqual(
      Array.from({ length: 5 }, () => 'test-path'),
    );
    expect(await argvCalls(project)).toEqual([]);

    const insideAdapter = new FakePlatformAdapter();
    const seenInside = proposeAlways(insideAdapter, `${TEST_COMMAND} tests/x.test.ts`);
    // One distinct hypothesis: the loop refuses at HYPOTHESISE with a typed RUN-060, AFTER it has
    // already used a real, usable, non-zero reproduction — proving the path itself was accepted this
    // time, unlike the "outside" proposal above.
    insideAdapter.script((request) => request.systemPrompt.text.includes('ISOLATE for'), {
      structured: { scope: 'test-unit.mjs' },
    });
    insideAdapter.script((request) => request.systemPrompt.text.includes('HYPOTHESISE for'), {
      structured: { claims: ['only one'] },
    });
    await expect(
      debugSymptom(deps(project, insideAdapter, TEST_COMMAND, ['tests']), 'the unit suite fails'),
    ).rejects.toMatchObject({ code: 'RUN-060' });
    expect(seenInside.some((request) => request.systemPrompt.text.includes('ISOLATE for'))).toBe(
      true,
    );
    expect(await argvCalls(project)).toEqual([['tests/x.test.ts']]);
  }, 120_000);

  it('PROVE never runs the bare layer alone once a <path> was proposed: real ten-phase loop end to end, and the recorded RCA holds the exact expanded reproduction, never the bare command', async () => {
    const project = await projectWithRealVitestProject();
    const adapter = new FakePlatformAdapter();
    const proposal = `${REAL_VITEST_CMD} bug.test.js`;
    proposeAlways(adapter, proposal);
    adapter.script((request) => request.systemPrompt.text.includes('ISOLATE for'), {
      structured: { scope: 'bug.test.js' },
    });
    adapter.script((request) => request.systemPrompt.text.includes('HYPOTHESISE for'), {
      structured: { claims: ['hyp-alpha', 'hyp-beta', 'hyp-gamma'] },
    });
    adapter.script(
      (request) =>
        request.systemPrompt.text.includes('FALSIFY for') && request.prompt.includes('hyp-alpha'),
      { structured: { refuted: true, refutedBy: 'ruled out' } },
    );
    adapter.script(
      (request) =>
        request.systemPrompt.text.includes('FALSIFY for') && request.prompt.includes('hyp-beta'),
      { structured: { refuted: true, refutedBy: 'ruled out' } },
    );
    adapter.script(
      (request) =>
        request.systemPrompt.text.includes('FALSIFY for') && request.prompt.includes('hyp-gamma'),
      { structured: { refuted: false } },
    );
    adapter.script((request) => request.systemPrompt.text.includes('DIAGNOSE for'), {
      structured: { why: 'a missing marker file check', satisfiesStopRule: true },
    });
    adapter.script((request) => request.systemPrompt.text.includes('FIX for'), {
      writeFiles: [{ relativePath: 'fixed.marker', content: 'fixed\n' }],
      structured: { description: 'wrote the missing marker file' },
    });
    adapter.script((request) => request.systemPrompt.text.includes('PREVENT for'), {
      structured: { actions: ['add a regression test'] },
    });

    // PROVE's own `forge test run` re-check (`origin: 'engine'`) shells a literal, real `forge` binary.
    const shim = await installForgeShim();
    let result: Awaited<ReturnType<typeof debugSymptom>>;
    try {
      result = await debugSymptom(deps(project, adapter, REAL_VITEST_CMD), 'the unit suite fails');
    } finally {
      shim.restorePath();
    }

    expect(result.outcome).toBe('recorded');
    if (result.outcome !== 'recorded') throw new Error('unreachable');
    const sessionsFiles = await readdir(path.join(project.dir, 'docs/forge/sessions/rca'));
    const rcaFile = sessionsFiles.find((name) => name.startsWith(result.rcaId));
    if (rcaFile === undefined) throw new Error('unreachable');
    const rcaDoc = await readArtifact(project.paths, `docs/forge/sessions/rca/${rcaFile}`);
    // The recorded reproduction is the EXPANDED string REPRODUCE proposed (the command plus the one file's
    // path) — not the bare, whole-layer `REAL_VITEST_CMD` alone, which `record.reproduction`/PROVE’s own
    // re-run (the identical `state.reproductionCommand`, `loop.ts`) would otherwise silently fall back to.
    expect(rcaDoc.get(['reproduction'])).toBe(proposal);
    expect(rcaDoc.get(['reproduction'])).not.toBe(REAL_VITEST_CMD);
  }, 120_000);
});
