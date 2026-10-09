/**
 * `G-Parity`, wired into the real, shipped `refactor`/`migrate` workflows (`specs/22` M16 P9, `10`
 * §10.3 rule 8) — Decision 11's own three "Required of P9" real-run proofs (`SPEC-QUESTIONS.md` Q294),
 * run for real: a real git repository, the real shipped `G-Parity.gate.yaml` and
 * `refactor.workflow.yaml` content (read straight from `@forge/templates`, never retyped), the real
 * engine via `runWorkflow` (parse, compile, scheduler, dispatch — exactly what `forge run` itself
 * calls), a real nested `forge parity check`/`forge test run` subprocess through the real launcher
 * shim, and a real `vitest` test command. Only the model sessions are the fake adapter's.
 *
 * Decision 11 names exactly what a prior critic round could verify only by reading or with an
 * in-process session double, never by running: (1) a lane no `merge` step lands is integrated between
 * ticks, so the gate after `refactor-code` sees it, and this still holds after an earlier run's gate
 * failure; (2) one gate id referenced by two steps of one workflow (`preflight-parity`,
 * `verify-parity`) works in a real run; (3) end to end, a lane that rewrites `.forge/parity/`,
 * including a session that commits its own work, makes `verify-parity` fail in that run, and a second
 * run keeps failing until trunk and the tree agree.
 *
 * @see specs/13 §13.1 F-TEST-9
 * @see specs/10 §10.3 rule 8
 * @see SPEC-QUESTIONS.md Q294 Decision 11
 * @see PLAN-M16.md P9
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { execa, execaSync } from 'execa';
import { FakePlatformAdapter } from '@forge/testkit';
import type { SessionRequest } from '@forge/adapter-kit/types';
import { ProjectPaths } from '@forge/core/fs';
import { evaluateGate, type CheckRunner, type GateDefinition } from '@forge/engine/gates';
import { compileRunPlan } from '@forge/engine/plan';
import { parseWorkflow } from '@forge/engine/workflow';
import { readEvents, type ForgeEvent } from '@forge/telemetry/events';
import { DEFAULT_CONFIG, type ForgeConfig } from '@forge/schemas/config';
import { afterEach, describe, expect, it } from 'vitest';
import * as YAML from 'yaml';

import { runParityCapture } from '../../../src/commands/parity/capture-command.ts';
import { runParityCheck } from '../../../src/commands/parity/check-command.ts';
import { buildReport } from '../../../src/commands/report.ts';
import { gateApprove, type GateCommandContext } from '../../../src/commands/run/gate-commands.ts';
import type { LauncherSpec } from '../../../src/commands/run/launcher-shim.ts';
import { runWorkflow } from '../../../src/commands/run/run.ts';
import { FIXTURE_MODELS, writeFixtureAgent } from '../loop/helpers.ts';
import { cleanupAll, registerCleanup } from './helpers.ts';

afterEach(cleanupAll);

const TEMPLATES_ROOT = fileURLToPath(new URL('../../../../templates/templates', import.meta.url));
const PARITY_FIXTURE_ROOT = fileURLToPath(
  new URL('../../../../../fixtures/parity-refactor', import.meta.url),
);

/** A real `LauncherSpec` naming the real `forge` entry point directly (`packages/cli/bin/forge.mjs`) —
 * `run.test.ts`'s own identical `REAL_FORGE_LAUNCHER`, reproduced here for the identical reason (this
 * file's own command/gate steps genuinely spawn a nested `forge` subprocess: `forge test run --json`,
 * `forge parity check --json --no-record --trusted refs/heads/main`). */
const REAL_FORGE_LAUNCHER: LauncherSpec = {
  execPath: process.execPath,
  execArgv: [],
  entry: fileURLToPath(new URL('../../../bin/forge.mjs', import.meta.url)),
  env: process.env,
};

function resolveRealBinEntry(pkgName: string, binName: string): string {
  const require = createRequire(import.meta.url);
  const packageJsonPath = require.resolve(`${pkgName}/package.json`);
  const packageJson = require(packageJsonPath) as {
    readonly bin?: Readonly<Record<string, string>>;
  };
  const binRelative = packageJson.bin?.[binName];
  if (binRelative === undefined)
    throw new Error(`${pkgName}/package.json has no real "${binName}" bin entry.`);
  return path.join(path.dirname(packageJsonPath), binRelative);
}

/** A real, passing test command (`gate-integration.test.ts`'s own established recipe): real `vitest`,
 * resolved from this monorepo's own installed dependency, against one trivial passing test file each
 * project below writes at its own root. Makes `verify-invariants`'s real `forge test run --json` step
 * pass for real, rather than the `failed: 1` a project with no configured test command reports
 * (`loop/test/run.ts`'s own `runDefaultRule`). */
const REAL_VITEST_CMD = `${process.execPath} ${resolveRealBinEntry('vitest', 'vitest')} run --root .`;

/** A `GateCommandContext.commandEnv` whose `PATH` resolves `forge` to this repo's own real entry
 * point (`REAL_FORGE_LAUNCHER`) -- `gateApprove`'s own `evaluateFresh` (`gate-commands.ts`) runs a
 * gate's deterministic check through a real shell (`runShellCommand`), never the vetted
 * `CheckRunner` the direct `evaluateGate` tests below use, so `G-Parity`'s own real `forge parity
 * check ...` check line needs a real `forge` on `PATH` to find -- the identical trick
 * `fixtureWithRealForgeOnPath`'s own local helper already gives those tests (that helper is nested
 * inside its own describe callback, below, and not reachable from here). `execa`'s own `env` option
 * extends `process.env` by default (never replaces it), so handing this back alone as `commandEnv`
 * overrides only `PATH`, exactly as that helper's identical `env` object does for its own
 * `CheckRunner`. */
async function realForgeCommandEnv(): Promise<Readonly<Record<string, string>>> {
  const binDir = await mkdtemp(path.join(tmpdir(), 'forge-p9-gate-approve-bin-'));
  registerCleanup(binDir);
  const wrapperPath = path.join(binDir, 'forge');
  await writeFile(
    wrapperPath,
    `#!/usr/bin/env sh\nexec "${REAL_FORGE_LAUNCHER.execPath}" "${REAL_FORGE_LAUNCHER.entry}" "$@"\n`,
    'utf8',
  );
  await execa('chmod', ['755', wrapperPath]);
  return { PATH: `${binDir}:${process.env['PATH'] ?? ''}` };
}

interface ParityProject {
  readonly dir: string;
  readonly paths: ProjectPaths;
  readonly config: ForgeConfig;
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await execa('git', args, { cwd })).stdout;
}

async function commitAll(dir: string, message: string): Promise<string> {
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', message], { cwd: dir });
  return (await git(dir, 'rev-parse', 'HEAD')).trim();
}

/** A real git repository with the real, shipped `G-Parity.gate.yaml` and `refactor.workflow.yaml`
 * installed (read verbatim from `@forge/templates`, never retyped), a real passing test command, and
 * real `architect`/`backend` agents + briefs for the two agent steps `refactor.workflow.yaml` names —
 * everything `runWorkflow` needs to run the real, current workflow end to end. `sum.mjs` starts equal
 * to `fixtures/parity-refactor/reference/sum.mjs`, committed as the project's first real commit, so a
 * declaration can later name that exact commit as its own `reference.ref`. No `.forge/parity/`
 * declaration is written here — callers that need one call `declareAndCapture` next.
 */
async function createRefactorProject(): Promise<ParityProject> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-p9-parity-'));
  registerCleanup(dir);
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 'fixture@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 'Fixture'], { cwd: dir });

  await writeFile(path.join(dir, '.gitignore'), '.forge/state/\n', 'utf8');
  await writeFile(path.join(dir, 'package.json'), '{}\n', 'utf8');
  await writeFile(
    path.join(dir, 'sample.test.js'),
    "import { test, expect } from 'vitest';\ntest('passes', () => { expect(1).toBe(1); });\n",
    'utf8',
  );
  await writeFile(
    path.join(dir, 'sum.mjs'),
    await readFile(path.join(PARITY_FIXTURE_ROOT, 'reference/sum.mjs'), 'utf8'),
    'utf8',
  );

  const config: ForgeConfig = {
    ...DEFAULT_CONFIG,
    execution: {
      ...DEFAULT_CONFIG.execution,
      testCommands: { ...DEFAULT_CONFIG.execution.testCommands, unit: REAL_VITEST_CMD },
      retainLaneWorktrees: 'always',
    },
    models: FIXTURE_MODELS,
  };
  await mkdir(path.join(dir, '.forge'), { recursive: true });
  await writeFile(path.join(dir, '.forge/config.yaml'), YAML.stringify(config), 'utf8');

  await mkdir(path.join(dir, '.forge/workflows'), { recursive: true });
  await writeFile(
    path.join(dir, '.forge/workflows/refactor.workflow.yaml'),
    await readFile(path.join(TEMPLATES_ROOT, 'workflows/refactor.workflow.yaml'), 'utf8'),
    'utf8',
  );
  await mkdir(path.join(dir, '.forge/checks'), { recursive: true });
  await writeFile(
    path.join(dir, '.forge/checks/G-Parity.gate.yaml'),
    await readFile(path.join(TEMPLATES_ROOT, 'checks/G-Parity.gate.yaml'), 'utf8'),
    'utf8',
  );

  await writeFixtureAgent(dir, 'architect', 'Architect', { write: true, code: true });
  await writeFixtureAgent(dir, 'backend', 'Backend', { write: true, code: true });
  await mkdir(path.join(dir, '.forge/briefs'), { recursive: true });
  await writeFile(
    path.join(dir, '.forge/briefs/state-refactor-invariants.md'),
    'State the refactor invariants for sum.mjs: the observable output must not change.\n',
    'utf8',
  );
  await writeFile(
    path.join(dir, '.forge/briefs/refactor.md'),
    'Refactor sum.mjs, preserving its observable behaviour.\n',
    'utf8',
  );

  await commitAll(dir, 'fixture project: reference sum.mjs, refactor workflow, G-Parity gate');

  return { dir, paths: new ProjectPaths(dir), config };
}

/** Authors `.forge/parity/behavior.parity.yaml` naming this project's own HEAD as `reference.ref`,
 * commits it, runs the real `forge parity capture` library call (`capture-command.ts`, the same one
 * `exit-test-fixtures.test.ts` already proves against this identical fixture), and commits the real
 * capture it writes — the identical real recipe that file's own `buildFixtureRepo` already
 * establishes, reused here against a real *workflow*, not only a bare `forge parity check` call. */
async function declareAndCapture(project: ParityProject): Promise<void> {
  const referenceSha = (await git(project.dir, 'rev-parse', 'HEAD')).trim();
  const declarationTemplate = await readFile(
    path.join(PARITY_FIXTURE_ROOT, 'declaration/behavior.parity.yaml'),
    'utf8',
  );
  const declaration = declarationTemplate.replace('__REFERENCE_SHA__', referenceSha);
  await mkdir(path.join(project.dir, '.forge/parity'), { recursive: true });
  await writeFile(
    path.join(project.dir, '.forge/parity/behavior.parity.yaml'),
    declaration,
    'utf8',
  );
  await commitAll(project.dir, 'declare parity for sum.mjs');

  await runParityCapture({
    projectRoot: project.dir,
    parentEnv: { ...process.env, FORGE_RUN_ID: undefined },
  });
  await commitAll(project.dir, 'capture reference behaviour');
}

/** `state-invariants` declares `outputs: [{type: HandoffRecord, subtype: refactor-invariants}]`
 * (the real, shipped `refactor.workflow.yaml`) -- `RUN-083` fails the step unless a real file at the
 * one conventional path (`docs/forge/reports/handoffs.md`) is added or changed by the session. No
 * wrapper schema exists for this register (`SPEC-QUESTIONS.md` Q23, `packages/engine/test/dispatch/
 * artifact-fixtures.ts`'s own identical `handoffsFileText` fixture), so this is the minimal real shape
 * that satisfies the output-produced check, not a schema-validated artifact. */
const HANDOFF_RECORD_CONTENT = `---
type: HandoffRecord
handoffs:
  - id: HO-0001
    from: architect
    to: backend
    step: refactor-code
    timestamp: '2026-01-01T00:00:00Z'
    delivered: ['subtype: refactor-invariants', 'observable output must not change']
    open_questions: []
    assumptions: []
    constraints_for_receiver: []
    acceptance_for_receiver: []
---
`;

function testRunDepsFor(
  project: ParityProject,
  adapter: FakePlatformAdapter,
): {
  readonly paths: ProjectPaths;
  readonly projectRoot: string;
  readonly config: ForgeConfig;
  readonly adapter: FakePlatformAdapter;
  readonly workflowsRoot: string;
  readonly checksRoot: string;
  readonly agentsRoot: string;
  readonly launcher: LauncherSpec;
} {
  return {
    paths: project.paths,
    projectRoot: project.dir,
    config: project.config,
    adapter,
    workflowsRoot: '.forge/workflows',
    checksRoot: '.forge/checks',
    agentsRoot: '.forge/agents',
    launcher: REAL_FORGE_LAUNCHER,
  };
}

/** A fake adapter scripted for `refactor`'s own two agent steps: `state-invariants` (writes the one
 * declared `HandoffRecord` output `RUN-083` requires) and `refactor-code`, which overlays `sum.mjs`
 * with `variant`'s own real content (`fixtures/parity-refactor/{preserving,changing}/sum.mjs`). */
async function refactorAdapter(variant: 'preserving' | 'changing'): Promise<FakePlatformAdapter> {
  const adapter = new FakePlatformAdapter();
  adapter.script((request) => request.stepId.endsWith(':state-invariants'), {
    text: ['stated the refactor invariants: observable output must not change'],
    writeFiles: [
      { relativePath: 'docs/forge/reports/handoffs.md', content: HANDOFF_RECORD_CONTENT },
    ],
  });
  const content = await readFile(path.join(PARITY_FIXTURE_ROOT, variant, 'sum.mjs'), 'utf8');
  adapter.script((request) => request.stepId.endsWith(':refactor-code'), {
    text: [`refactored sum.mjs (${variant})`],
    writeFiles: [{ relativePath: 'sum.mjs', content }],
  });
  return adapter;
}

/** A fake adapter whose `refactor-code` step rewrites AND commits `.forge/parity/behavior.parity.yaml`
 * directly, inside its own lane worktree, bypassing the declarative `writeFiles`/claim path entirely —
 * the real shape of Decision 2's own disclosed gap ("claim enforcement is skipped for a self-
 * committing session"): `.forge/**` is in `NEVER_WRITABLE_GLOBS`, so a `writeFiles` entry under it
 * would be reverted by the floor; a real `git commit` made directly in the lane's own working
 * directory, never reported to the engine as a changed file, is not. The commit happens as a
 * synchronous side effect of the SESSION-REQUEST MATCHER itself (never claiming the request — it
 * returns `false` — so the real, separately-registered script below still answers it), the identical
 * "side-channel observation via a matcher that always returns false" technique
 * `packages/engine/test/run/lane-integration.test.ts`'s own `scriptedAdapter` already establishes for
 * a different purpose (recording what files a lane's cwd already holds). */
function selfCommittingRewriteAdapter(): FakePlatformAdapter {
  const adapter = new FakePlatformAdapter();
  adapter.script((request) => request.stepId.endsWith(':state-invariants'), {
    text: ['stated the refactor invariants'],
    writeFiles: [
      { relativePath: 'docs/forge/reports/handoffs.md', content: HANDOFF_RECORD_CONTENT },
    ],
  });
  adapter.script((request: SessionRequest) => {
    if (!request.stepId.endsWith(':refactor-code')) return false;
    const declPath = path.join(request.cwd, '.forge/parity/behavior.parity.yaml');
    const rewritten = `${readFileSync(declPath, 'utf8')}# rewritten by a self-committing session\n`;
    writeFileSync(declPath, rewritten, 'utf8');
    execaSync('git', ['config', 'user.email', 'agent@example.com'], { cwd: request.cwd });
    execaSync('git', ['config', 'user.name', 'Agent'], { cwd: request.cwd });
    execaSync('git', ['add', '-A'], { cwd: request.cwd });
    execaSync('git', ['commit', '--quiet', '-m', 'self-committing session: rewrite the oracle'], {
      cwd: request.cwd,
    });
    return false;
  }, {});
  adapter.script((request) => request.stepId.endsWith(':refactor-code'), {
    text: ['refactored sum.mjs'],
  });
  return adapter;
}

// Not `: ExpressionContext` -- an explicit annotation on this literal would trigger TypeScript's
// excess-property check against `ExpressionContext`'s own narrower declared shape, which has no
// `goal` member of its own (`resolvePath` walks any own property at runtime; `test/workflows.test.ts`'s
// own identical `FIXTURE_CONTEXT` doc comment has the fuller reasoning). Left inferred and passed as a
// variable (never inline), excess properties are tolerated; `vars: {}` (one of `ExpressionContext`'s
// own seven known fields) keeps TS's separate "weak type" check (TS2559: no properties at all in
// common) from firing on an object that would otherwise share zero keys with it.
const REFACTOR_EXPRESSION_CONTEXT = { goal: 'extract a shared helper', vars: {} };

async function runRefactor(project: ParityProject, adapter: FakePlatformAdapter, runId: string) {
  return runWorkflow(testRunDepsFor(project, adapter), {
    workflowId: 'refactor',
    expressionContext: REFACTOR_EXPRESSION_CONTEXT,
    runId,
    host: 'test-host',
  });
}

async function gateEvaluatedEvents(project: ParityProject, runId: string) {
  const events: { readonly stepId: string; readonly passed: boolean; readonly gateId: string }[] =
    [];
  for await (const event of readEvents(project.dir, runId)) {
    if (event.type === 'GateEvaluated') {
      const payload = event.payload as { readonly gateId: string; readonly passed: boolean };
      events.push({ stepId: event.stepId ?? '', gateId: payload.gateId, passed: payload.passed });
    }
  }
  return events;
}

describe('evaluateGate against the real, shipped G-Parity.gate.yaml (specs/22 M16 P9)', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  /** `gate-integration.test.ts`'s own established `fixtureWithRealForgeOnPath`: this environment has
   * no `forge` on `PATH` (it is not a workspace-root dependency), so a tiny real wrapper script,
   * prepended onto `PATH` for this fixture's own real `CheckRunner` only, makes the real, verbatim
   * `G-Parity.gate.yaml` runnable without editing it. */
  async function fixtureWithRealForgeOnPath(): Promise<{
    readonly dir: string;
    readonly runner: CheckRunner;
  }> {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-p9-gate-e2e-'));
    dirs.push(dir);
    const binDir = await mkdtemp(path.join(tmpdir(), 'forge-p9-gate-e2e-bin-'));
    dirs.push(binDir);
    const wrapperPath = path.join(binDir, 'forge');
    await writeFile(
      wrapperPath,
      `#!/usr/bin/env sh\nexec "${REAL_FORGE_LAUNCHER.execPath}" "${REAL_FORGE_LAUNCHER.entry}" "$@"\n`,
      'utf8',
    );
    await execa('chmod', ['755', wrapperPath]);
    const env = { PATH: `${binDir}:${process.env['PATH'] ?? ''}` };
    const runner: CheckRunner = async (check, cwd) => {
      const result = await execa(check.run, { cwd, shell: true, env, reject: false });
      return { stdout: result.stdout, exitCode: result.exitCode ?? 1, stderr: result.stderr };
    };
    return { dir, runner };
  }

  async function loadRealGParity(): Promise<GateDefinition> {
    const raw = YAML.parse(
      await readFile(path.join(TEMPLATES_ROOT, 'checks/G-Parity.gate.yaml'), 'utf8'),
    ) as {
      readonly id: string;
      readonly checks: {
        readonly deterministic: GateDefinition['checks']['deterministic'];
        readonly advisory?: GateDefinition['checks']['advisory'];
      };
      readonly openQuestionsPolicy?: 'block' | 'warn';
    };
    return {
      id: raw.id,
      checks: { deterministic: raw.checks.deterministic, advisory: raw.checks.advisory ?? [] },
      openQuestionsPolicy: raw.openQuestionsPolicy ?? 'warn',
    };
  }

  /** The shared half of `exit-test-fixtures.test.ts`'s own `buildFixtureRepo`, reused verbatim here
   * against the real gate (that file proves the real `runParityCheck` library call; this proves the
   * real, shipped `.gate.yaml`'s own `failOn`/`parser` against the identical real subprocess). */
  async function buildFixtureRepo(): Promise<string> {
    const { dir } = await fixtureWithRealForgeOnPath();
    await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
    await execa('git', ['config', 'user.email', 't@example.com'], { cwd: dir });
    await execa('git', ['config', 'user.name', 't'], { cwd: dir });
    await writeFile(path.join(dir, '.gitignore'), '.forge/state/\n', 'utf8');
    await writeFile(
      path.join(dir, 'sum.mjs'),
      await readFile(path.join(PARITY_FIXTURE_ROOT, 'reference/sum.mjs'), 'utf8'),
      'utf8',
    );
    const referenceSha = await commitAll(dir, 'reference implementation');

    const declarationTemplate = await readFile(
      path.join(PARITY_FIXTURE_ROOT, 'declaration/behavior.parity.yaml'),
      'utf8',
    );
    const declaration = declarationTemplate.replace('__REFERENCE_SHA__', referenceSha);
    await mkdir(path.join(dir, '.forge/parity'), { recursive: true });
    await writeFile(path.join(dir, '.forge/parity/behavior.parity.yaml'), declaration, 'utf8');
    await commitAll(dir, 'declare parity for sum.mjs');
    return dir;
  }

  it('the behaviour-preserving refactor passes the real behavior:parity check', async () => {
    const dir = await buildFixtureRepo();
    await runParityCapture({
      projectRoot: dir,
      parentEnv: { ...process.env, FORGE_RUN_ID: undefined },
    });
    await commitAll(dir, 'capture reference behaviour');
    await writeFile(
      path.join(dir, 'sum.mjs'),
      await readFile(path.join(PARITY_FIXTURE_ROOT, 'preserving/sum.mjs'), 'utf8'),
      'utf8',
    );
    const { runner } = await fixtureWithRealForgeOnPath();
    const gate = await loadRealGParity();

    const result = await evaluateGate(gate, dir, runner);

    expect(result.passed).toBe(true);
    const check = result.checks.find((c) => c.checkId === 'behavior:parity');
    expect(check?.passed).toBe(true);
  });

  it('the behaviour-changing refactor fails the real behavior:parity check, naming the surface', async () => {
    const dir = await buildFixtureRepo();
    await runParityCapture({
      projectRoot: dir,
      parentEnv: { ...process.env, FORGE_RUN_ID: undefined },
    });
    await commitAll(dir, 'capture reference behaviour');
    await writeFile(
      path.join(dir, 'sum.mjs'),
      await readFile(path.join(PARITY_FIXTURE_ROOT, 'changing/sum.mjs'), 'utf8'),
      'utf8',
    );
    const { runner } = await fixtureWithRealForgeOnPath();
    const gate = await loadRealGParity();

    const result = await evaluateGate(gate, dir, runner);

    expect(result.passed).toBe(false);
    const check = result.checks.find((c) => c.checkId === 'behavior:parity');
    expect(check?.passed).toBe(false);
    expect(check?.reason).toBeUndefined(); // failOn fired on well-formed data, not a refusal.
    const parsed = JSON.parse(check?.stdout ?? '{}') as { declarations?: { reason?: string }[] };
    expect(parsed.declarations?.[0]?.reason).toMatch(/surface "process"/);
  });

  it('a declaration with no capture fails with a reason naming the missing platform', async () => {
    const dir = await buildFixtureRepo();
    // No `runParityCapture` call at all: the declaration is committed, but no capture exists for it.
    const { runner } = await fixtureWithRealForgeOnPath();
    const gate = await loadRealGParity();

    const result = await evaluateGate(gate, dir, runner);

    expect(result.passed).toBe(false);
    const check = result.checks.find((c) => c.checkId === 'behavior:parity');
    const parsed = JSON.parse(check?.stdout ?? '{}') as {
      declarations?: { verdict?: string; reason?: string }[];
    };
    expect(parsed.declarations?.[0]?.verdict).toBe('missing');
    expect(parsed.declarations?.[0]?.reason).toMatch(
      new RegExp(`${process.platform}-${process.arch}`),
    );
  });
});

describe('the real refactor workflow, wired to G-Parity, through a real forge run (specs/22 M16 P9) (SPEC-QUESTIONS.md Q294 Decision 11)', () => {
  it('refuses at preflight-parity before any agent step runs, when no declaration exists at all', async () => {
    const project = await createRefactorProject();
    const adapter = await refactorAdapter('preserving');

    const result = await runRefactor(project, adapter, 'run-no-decl');

    expect(result.kind).toBe('run');
    if (result.kind !== 'run') throw new Error('unreachable');
    expect(result.runState.runStatus).toBe('failed');
    expect(result.runState.stepStatuses.get('refactor:preflight-parity')).toBe('failed');
    // Nothing downstream of the failed preflight was ever even scheduled.
    expect(result.runState.stepStatuses.has('refactor:state-invariants')).toBe(false);
    expect(result.runState.stepStatuses.has('refactor:refactor-code')).toBe(false);

    const events = await gateEvaluatedEvents(project, 'run-no-decl');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ gateId: 'G-Parity', passed: false });
  });

  // Decision 11's own open question, answered by a real run, not an assumption: a project is not
  // only refused for having NO declaration at all (the test above) -- one that exists but excuses its
  // only surface as `unobservable` has nothing left to compare (`nothing-compared`, Decision 4: "A
  // declaration with no surface that is not exempt is invalid"), and is refused identically.
  //
  // M16 P9 fix-pass round 2 (two independent critics, identical diagnosis): this fixture's own
  // `surfaces:` block is not optional set-dressing. A declaration with an `unobservable` entry but NO
  // `surfaces:` block at all never reaches the real, semantic `nothing-compared` check this test's own
  // name claims to prove -- `declaration.ts`'s own structural validation (`readUnobservableEntry`)
  // refuses any `unobservable` entry naming a surface that is not ALSO fully declared under
  // `surfaces:`, with its own, earlier, differently-worded refusal: `"process" names no surface of
  // this declaration (its "surfaces" block has no "process" entry to excuse)`. The outer
  // `preflight-parity: 'failed'` assertion below still happened to pass, for that wrong, structural
  // reason, so a prior round never caught this as red. The `process` surface below is real and fully
  // declared (the identical shape to this file's own default fixture,
  // `PARITY_FIXTURE_ROOT/declaration/behavior.parity.yaml`) precisely so `unobservable` can validly
  // excuse it -- this run now genuinely exercises `nothing-compared`, not the structural refusal.
  it('refuses at preflight-parity when a declaration exists but excuses its only surface as unobservable (nothing left to compare)', async () => {
    const project = await createRefactorProject();
    const referenceSha = (await git(project.dir, 'rev-parse', 'HEAD')).trim();
    await mkdir(path.join(project.dir, '.forge/parity'), { recursive: true });
    await writeFile(
      path.join(project.dir, '.forge/parity/behavior.parity.yaml'),
      `name: behavior
reference:
  ref: ${referenceSha}
review:
  by: fixture-author
  basis: read reference/sum.mjs by hand; it is three lines
  at: 2026-01-01
expires: 2999-01-01
surfaces:
  process:
    run: "node sum.mjs"
    stability:
      runs: 2
    cases:
      - args: ["2", "3"]
      - args: ["10", "-4"]
unobservable:
  - surface: process
    reason: nothing to compare for this fixture
    owner: fixture-author
    expiry: 2999-01-01
`,
      'utf8',
    );
    await commitAll(project.dir, 'declare parity for sum.mjs, excusing its only surface');

    const result = await runRefactor(
      project,
      await refactorAdapter('preserving'),
      'run-nothing-compared',
    );

    expect(result.kind).toBe('run');
    if (result.kind !== 'run') throw new Error('unreachable');
    expect(result.runState.runStatus).toBe('failed');
    expect(result.runState.stepStatuses.get('refactor:preflight-parity')).toBe('failed');
    expect(result.runState.stepStatuses.has('refactor:state-invariants')).toBe(false);
  });

  // The complementary real-run proof both critics independently built alongside the fix above:
  // `nothing-compared` fires only when EVERY declared surface is exempt (Decision 4 again, read the
  // other way) -- a declaration with one real, non-exempt surface AND one properly-excused surface
  // has something real left to compare, and must reach `commit` exactly as a declaration with no
  // exemptions at all would, never refused as nothing-compared merely for having an exemption at all.
  it(
    'with one real, non-exempt surface AND one properly-excused surface, preflight-parity correctly ' +
      'distinguishes "something real plus some exemptions" from nothing-compared, and the run ' +
      'reaches commit',
    async () => {
      const project = await createRefactorProject();
      const referenceSha = (await git(project.dir, 'rev-parse', 'HEAD')).trim();
      await mkdir(path.join(project.dir, '.forge/parity'), { recursive: true });
      await writeFile(
        path.join(project.dir, '.forge/parity/behavior.parity.yaml'),
        `name: behavior
reference:
  ref: ${referenceSha}
review:
  by: fixture-author
  basis: read reference/sum.mjs by hand; it is three lines
  at: 2026-01-01
expires: 2999-01-01
surfaces:
  process:
    run: "node sum.mjs"
    stability:
      runs: 2
    cases:
      - args: ["2", "3"]
      - args: ["10", "-4"]
  file:
    run: "true"
    stability:
      runs: 2
    cases:
      - {}
unobservable:
  - surface: file
    reason: a deliberate no-op second surface, declared only to prove a real surface and a properly-excused one coexist without tripping nothing-compared
    owner: fixture-author
    expiry: 2999-01-01
`,
        'utf8',
      );
      await commitAll(project.dir, 'declare parity for sum.mjs: one real surface, one excused');
      await runParityCapture({
        projectRoot: project.dir,
        parentEnv: { ...process.env, FORGE_RUN_ID: undefined },
      });
      await commitAll(project.dir, 'capture reference behaviour (two surfaces)');

      const result = await runRefactor(
        project,
        await refactorAdapter('preserving'),
        'run-mixed-surfaces',
      );

      expect(result.kind).toBe('run');
      if (result.kind !== 'run') throw new Error('unreachable');
      expect(result.runState.stepStatuses.get('refactor:preflight-parity')).toBe('succeeded');
      expect(result.runState.stepStatuses.get('refactor:refactor-code')).toBe('succeeded');
      expect(result.runState.stepStatuses.get('refactor:verify-parity')).toBe('succeeded');
      expect(result.runState.stepStatuses.get('refactor:commit')).toBe('succeeded');
      expect(result.runState.runStatus).toBe('completed');
    },
  );

  // `PLAN-M16.md` P9's own mutation-evidence text, end to end rather than only at the direct
  // `evaluateGate` level above: the real `refactor` workflow genuinely stops a behaviour-changing
  // refactor at `verify-parity` -- it never reaches `commit` uncaught.
  it('a behaviour-changing refactor reaches verify-parity and fails there, never reaching commit', async () => {
    const project = await createRefactorProject();
    await declareAndCapture(project);

    const result = await runRefactor(project, await refactorAdapter('changing'), 'run-changing');

    expect(result.kind).toBe('run');
    if (result.kind !== 'run') throw new Error('unreachable');
    expect(result.runState.stepStatuses.get('refactor:preflight-parity')).toBe('succeeded');
    expect(result.runState.stepStatuses.get('refactor:refactor-code')).toBe('succeeded');
    expect(result.runState.stepStatuses.get('refactor:verify-invariants')).toBe('succeeded');
    expect(result.runState.stepStatuses.get('refactor:verify-parity')).toBe('failed');
    expect(result.runState.stepStatuses.has('refactor:commit')).toBe(false);
    expect(result.runState.runStatus).toBe('failed');

    const events = await gateEvaluatedEvents(project, 'run-changing');
    const verifyParity = events.find((e) => e.stepId === 'refactor:verify-parity');
    expect(verifyParity).toMatchObject({ gateId: 'G-Parity', passed: false });
  });

  it(
    'with a valid declaration, a behaviour-preserving refactor reaches commit; GateEvaluated is ' +
      'keyed by BOTH preflight-parity and verify-parity, naming G-Parity each time (one gate id, two ' +
      'steps of one workflow, confirmed by a real run — Decision 11 Required (2))',
    async () => {
      const project = await createRefactorProject();
      await declareAndCapture(project);
      const adapter = await refactorAdapter('preserving');

      const result = await runRefactor(project, adapter, 'run-two-step-gate');

      expect(result.kind).toBe('run');
      if (result.kind !== 'run') throw new Error('unreachable');
      expect(result.runState.stepStatuses.get('refactor:preflight-parity')).toBe('succeeded');
      expect(result.runState.stepStatuses.get('refactor:state-invariants')).toBe('succeeded');
      expect(result.runState.stepStatuses.get('refactor:refactor-code')).toBe('succeeded');
      expect(result.runState.stepStatuses.get('refactor:verify-invariants')).toBe('succeeded');
      expect(result.runState.stepStatuses.get('refactor:verify-parity')).toBe('succeeded');
      expect(result.runState.stepStatuses.get('refactor:commit')).toBe('succeeded');
      expect(result.runState.runStatus).toBe('completed');

      const events = await gateEvaluatedEvents(project, 'run-two-step-gate');
      expect(events.map((e) => e.stepId).sort()).toEqual(
        ['refactor:preflight-parity', 'refactor:verify-parity'].sort(),
      );
      for (const event of events) {
        expect(event.gateId).toBe('G-Parity');
        expect(event.passed).toBe(true);
      }
    },
  );

  it(
    'a lane no merge step lands is integrated between ticks, so verify-parity (the gate after ' +
      'refactor-code) sees it, and this still holds after an earlier RUN failed at preflight-parity ' +
      '(Decision 11 Required (1))',
    async () => {
      const project = await createRefactorProject();

      // Run 1: no declaration at all -- preflight-parity fails, nothing else ever runs.
      const run1 = await runRefactor(
        project,
        await refactorAdapter('preserving'),
        'run-1-fails-early',
      );
      if (run1.kind !== 'run') throw new Error('unreachable');
      expect(run1.runState.runStatus).toBe('failed');
      expect(run1.runState.stepStatuses.has('refactor:refactor-code')).toBe(false);

      // Fix it: author and capture the declaration, exactly as a human would after Run 1's own
      // remedy.
      await declareAndCapture(project);

      // Run 2: a real, FRESH run. refactor-code's own lane (no `merge` step in this workflow at all)
      // must still be integrated into the integration branch before verify-parity (two steps later)
      // runs -- the real `forge parity check` this gate shells out to runs in the INTEGRATION
      // worktree, never the lane's own, so it can only see the preserving sum.mjs if the engine's own
      // automatic lane integration (06 §6.4 rule 4) genuinely put it there first.
      const run2 = await runRefactor(
        project,
        await refactorAdapter('preserving'),
        'run-2-succeeds',
      );
      if (run2.kind !== 'run') throw new Error('unreachable');
      expect(run2.runState.runStatus).toBe('completed');
      expect(run2.runState.stepStatuses.get('refactor:refactor-code')).toBe('succeeded');
      expect(run2.runState.stepStatuses.get('refactor:verify-parity')).toBe('succeeded');

      const events2 = await gateEvaluatedEvents(project, 'run-2-succeeds');
      const verifyParity = events2.find((e) => e.stepId === 'refactor:verify-parity');
      // The decisive signal: verify-parity's own real `forge parity check` ran in the integration
      // worktree and reported a real MATCH against the preserving sum.mjs -- it could not have, had
      // refactor-code's own lane commit not already landed there before this gate step ran.
      expect(verifyParity?.passed).toBe(true);
    },
  );

  it(
    'end to end: a lane that rewrites .forge/parity/, including a session that commits its own work, ' +
      'makes verify-parity fail IN THAT RUN, and a second run keeps failing until trunk and the tree ' +
      'agree (Decision 11 Required (3))',
    async () => {
      const project = await createRefactorProject();
      await declareAndCapture(project);
      const trunkBefore = (await git(project.dir, 'rev-parse', 'main')).trim();

      // Run 1: refactor-code's own session rewrites and commits .forge/parity/ directly inside its
      // own lane, bypassing the declarative writeFiles/claim path (Decision 2's own disclosed gap:
      // ".forge/** is in NEVER_WRITABLE_GLOBS, but claim enforcement runs only when the adapter
      // reports changed files... so a session that commits its own work is never reverted").
      const run1 = await runRefactor(project, selfCommittingRewriteAdapter(), 'run-1-rewrite');
      if (run1.kind !== 'run') throw new Error('unreachable');
      expect(run1.runState.stepStatuses.get('refactor:refactor-code')).toBe('succeeded');
      expect(run1.runState.stepStatuses.get('refactor:verify-parity')).toBe('failed');
      expect(run1.runState.runStatus).toBe('failed');

      const events1 = await gateEvaluatedEvents(project, 'run-1-rewrite');
      const verifyParity1 = events1.find((e) => e.stepId === 'refactor:verify-parity');
      expect(verifyParity1?.passed).toBe(false);

      // Trunk itself was never touched by the rewrite (only the integration branch, which a lane with
      // no merge step still lands on): main's own tip is unchanged.
      expect((await git(project.dir, 'rev-parse', 'main')).trim()).toBe(trunkBefore);

      // Run 2: a real, FRESH run. The integration branch is never reset to trunk when it is ahead of
      // it (Decision 3: "a rewrite that lands in run N is run N+1's starting tip"), so the SAME
      // rewrite is still there before any agent step of Run 2 even starts -- preflight-parity itself
      // now fails, before refactor-code runs a second time.
      const run2 = await runRefactor(
        project,
        await refactorAdapter('preserving'),
        'run-2-still-dirty',
      );
      if (run2.kind !== 'run') throw new Error('unreachable');
      expect(run2.runState.stepStatuses.get('refactor:preflight-parity')).toBe('failed');
      expect(run2.runState.stepStatuses.has('refactor:refactor-code')).toBe(false);
      expect(run2.runState.runStatus).toBe('failed');

      // The resolution half of Decision 11's own claim: once trunk and the (rewritten) tree agree --
      // here, by landing the identical rewrite on trunk itself, exactly what a human review would do
      // -- a real forge parity check against the same integration worktree stops reading
      // oracle-changed.
      const integrationPath = path.join(
        project.dir,
        '.forge/state/worktrees/integration-forge-integration-current',
      );
      const rewrittenDeclaration = await readFile(
        path.join(integrationPath, '.forge/parity/behavior.parity.yaml'),
        'utf8',
      );
      await writeFile(
        path.join(project.dir, '.forge/parity/behavior.parity.yaml'),
        rewrittenDeclaration,
        'utf8',
      );
      await commitAll(project.dir, 'land the reviewed rewrite on trunk');
      const resolved = await runParityCheck({
        projectRoot: integrationPath,
        trusted: 'refs/heads/main',
        reportsRoot: 'docs/forge/reports',
        noRecord: true,
        parentEnv: { ...process.env, FORGE_RUN_ID: undefined },
      });
      expect(resolved.reason).toBeUndefined();
      expect(resolved.verdict).not.toBe('invalid');
    },
  );
});

// Same reason as `REFACTOR_EXPRESSION_CONTEXT` above: left inferred, passed as a variable, `vars: {}`.
const MIGRATE_EXPRESSION_CONTEXT = { migrationGoal: 'expand the users table', vars: {} };

describe('the real migrate workflow, wired to G-Parity (specs/22 M16 P9)', () => {
  // `forge migrate run` itself is not wired into `bin.ts` at all (`test/command-steps.test.ts`'s own
  // `KNOWN_UNACCEPTED` pin: "Q213 / Q202 finding 8 ... Deferred by P11-TRIAGE.md §5", pre-existing and
  // not this piece's job to close) -- migrate-data therefore cannot pass for real, so verify-parity
  // cannot be reached end to end. What IS real here: the compiled plan orders verify-parity after
  // verify-migration and before nothing else, naming G-Parity, exactly as `test/workflows.test.ts`'s
  // own generic compile/gate-id tests already confirm for all 20 shipped workflows including this one.
  it('compiles with verify-parity (kind: gate, gate: G-Parity) depending on verify-migration, as its own real, last step', async () => {
    const source = await readFile(
      path.join(TEMPLATES_ROOT, 'workflows/migrate.workflow.yaml'),
      'utf8',
    );
    const parsed = parseWorkflow(source);
    if (!parsed.success) throw new Error('migrate.workflow.yaml failed to parse');
    const verifyParity = parsed.workflow.steps.find((step) => step.id === 'verify-parity');
    expect(verifyParity).toMatchObject({
      kind: 'gate',
      gate: 'G-Parity',
      dependsOn: ['verify-migration'],
    });

    const compiled = compileRunPlan(parsed.workflow, MIGRATE_EXPRESSION_CONTEXT);
    if (!compiled.success)
      throw new Error(`migrate failed to compile: ${JSON.stringify(compiled.issues)}`);
    const node = compiled.nodes.find((n) => n.id === 'migrate:verify-parity');
    expect(node?.kind).toBe('gate');
    expect(node && 'gate' in node ? node.gate : undefined).toBe('G-Parity');
    // No step depends on verify-parity: it is the real last step of the real, shipped workflow.
    expect(compiled.nodes.some((n) => n.dependsOn.includes('migrate:verify-parity'))).toBe(false);
  });
});

// M16 P9 fix-pass round 2, Fix 1 (MUST-FIX, HIGH severity, both critics/the orchestrator): `forge
// report`'s own `buildGateMetric` (`report.ts`) used to group `GateRejected`/`GateApproved`/
// `GateWaived` events by `(runId, gateId)` alone, with no `stepId`. `G-Parity` is the first gate id
// this codebase ever references from TWO different steps of one workflow (`preflight-parity`,
// `verify-parity`) -- `preflight-parity`'s own clean pass is structurally always first in `seq` (the
// run could not have reached `verify-parity` at all otherwise), so the old grouping let it satisfy
// this metric's "reached first pass" check for the whole `(runId, gateId)` group before
// `verify-parity`'s own later, genuinely independent rejection was ever examined -- reporting a clean
// pass for a run whose `verify-parity` step had actually failed. This is the real end-to-end
// regression proof: a real `refactor` run where `preflight-parity` passes cleanly and `verify-parity`
// genuinely rejects (the identical real scenario the already-passing "a behaviour-changing refactor
// reaches verify-parity and fails there" test above proves at the workflow-step level), read back
// through the real `buildReport()` projector this time, not `gateEvaluatedEvents`.
describe(
  "forge report's own gate metric, over a real run where G-Parity is evaluated at two different " +
    'steps of one workflow (specs/22 M16 P9)',
  () => {
    it(
      "a real verify-parity rejection is never hidden behind preflight-parity's own, necessarily " +
        'clean, earlier pass of the SAME gate id, in the SAME run',
      async () => {
        const project = await createRefactorProject();
        await declareAndCapture(project);

        const result = await runRefactor(
          project,
          await refactorAdapter('changing'),
          'run-changing-for-report',
        );
        expect(result.kind).toBe('run');
        if (result.kind !== 'run') throw new Error('unreachable');
        expect(result.runState.stepStatuses.get('refactor:preflight-parity')).toBe('succeeded');
        expect(result.runState.stepStatuses.get('refactor:verify-parity')).toBe('failed');

        const report = await buildReport({
          paths: project.paths,
          projectRoot: project.dir,
          reportsRoot: 'docs/forge/reports',
          clock: { now: () => '2026-01-01T00:00:00.000Z' },
        });

        // Two real, independent `(runId, gateId, stepId)` triples -- preflight-parity's own clean
        // pass and verify-parity's own genuine rejection -- never conflated into one `(runId, gateId)`
        // pair just because they share a gate id and a run: exactly ONE triple reached a clean first
        // pass (preflight-parity), and verify-parity's own real rejection is genuinely counted, never
        // hidden behind it. Before this fix: `pairsEvaluated: 1, pairsWithCleanFirstPass: 1,
        // totalRejectionsBeforeFirstPass: 0` -- a clean pass reported for a run that actually failed.
        expect(report.gates).toMatchObject({
          pairsEvaluated: 2,
          pairsWithCleanFirstPass: 1,
          totalRejectionsBeforeFirstPass: 1,
        });
      },
    );
  },
);

// M16 P9 fix-pass round 2, Fix 3 (SHOULD-FIX, both critics independently built and ran these):
// neither test exists in the builder's own 10 tests (zero calls to `gateApprove`/`forge gate approve`
// anywhere in this file before this fix pass) -- closing a real gap in the committed suite for
// `G-Parity.gate.yaml`'s own `evidence: - artifact: ParityEvidence` block.
describe(
  "gateApprove resolving G-Parity's own evidence: block against real, committed ParityEvidence " +
    '(specs/22 M16 P9)',
  () => {
    it('with no ParityEvidence anywhere, gateApprove refuses RUN-112 ("missing") -- never crashes, never silently succeeds', async () => {
      const project = await createRefactorProject();
      const commandEnv = await realForgeCommandEnv();
      const ctx: GateCommandContext = {
        paths: project.paths,
        projectRoot: project.dir,
        checksRoot: '.forge/checks',
        agentsRoot: '.forge/agents',
        runId: 'run-approve-missing-evidence',
        commandEnv,
      };

      // No `.forge/parity/` declaration, no capture, no `forge parity check` ever run: there is no
      // `ParityEvidence` anywhere in this project, committed or not. The gate's own deterministic
      // `behavior:parity` check genuinely runs (real `forge parity check`, via `commandEnv`) and
      // genuinely fails (no declarations at all) -- but evidence resolution (`RUN-112`) is reached
      // and refuses regardless of that check's own pass/fail outcome (`gate-commands.ts`'s own
      // `gateApprove`: evidence is resolved unconditionally, before the pass/fail-gated waiver logic).
      await expect(gateApprove(ctx, 'G-Parity')).rejects.toMatchObject({
        code: 'RUN-112',
        details: { gateId: 'G-Parity', ref: 'ParityEvidence', reason: 'missing' },
      });
    });

    it('with a real, prior, recorded (committed) ParityEvidence from a real forge parity check, gateApprove genuinely resolves and succeeds', async () => {
      const project = await createRefactorProject();
      await declareAndCapture(project);

      // A real, prior, NON `--no-record` `forge parity check` -- the real library call, exactly as
      // `check-command.test.ts`'s own "writes exactly one schema-valid record per invocation" proves,
      // reused here against this fixture's own real refactor project -- writes a real `ParityEvidence`
      // record to disk, then committed, exactly as `resolveGateEvidence` (`gate-commands.ts`) requires
      // ("only ever resolves against committed artifacts," `prune.test.ts`'s own identical finding).
      const checked = await runParityCheck({
        projectRoot: project.dir,
        parentEnv: { ...process.env, FORGE_RUN_ID: undefined },
        reportsRoot: 'docs/forge/reports',
        trusted: 'refs/heads/main',
      });
      expect(checked.verdict).toBe('match');
      expect(checked.evidenceId).toMatch(/^PAR-\d{3}$/);
      await commitAll(project.dir, 'record a real forge parity check (ParityEvidence)');

      const commandEnv = await realForgeCommandEnv();
      const ctx: GateCommandContext = {
        paths: project.paths,
        projectRoot: project.dir,
        checksRoot: '.forge/checks',
        agentsRoot: '.forge/agents',
        runId: 'run-approve-real-evidence',
        commandEnv,
      };

      const summary = await gateApprove(ctx, 'G-Parity');

      expect(summary.gateId).toBe('G-Parity');
      expect(summary.evidence).toEqual([checked.evidenceId]);

      // The real `GateApproved` event this approval appended -- `gateApprove` genuinely resolved and
      // succeeded, not merely "did not throw."
      const events: ForgeEvent[] = [];
      for await (const event of readEvents(project.dir, 'run-approve-real-evidence')) {
        if (event.type === 'GateApproved') events.push(event);
      }
      expect(events).toHaveLength(1);
      expect((events[0]?.payload as { readonly gateId?: string }).gateId).toBe('G-Parity');
    });
  },
);
