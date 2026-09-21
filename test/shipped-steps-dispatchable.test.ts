/**
 * Every step of every shipped workflow is either run by the engine or named, with its reason, in a pinned
 * exclusion set (`PLAN-M13.md` P20, `SPEC-QUESTIONS.md` Q227).
 *
 * For twelve milestones `elicit` and `subworkflow` were refused (`RUN-039`) while the first workflow shipped two
 * `elicit` steps, and nothing said so until a live run tried. This suite enumerates the workflows that ship
 * (`@forge/templates`' `WORKFLOW_INDEX` plus `modules/*\/workflows`, as `test/agent-prompts-all-workflows.test.ts`
 * does), compiles each against a representative context, and asks the ENGINE which kinds it refuses (it runs
 * `executeStep` on a node of each kind and sees what throws `RUN-039`), rather than trusting a list: the exclusion
 * set fails as soon as it names a step whose kind the engine now runs, and a new refused step fails until it is
 * named here.
 *
 * Also pinned: the `onComplete` hook steps the compiler leaves out of the plan (`compilePlan`'s own doc comment,
 * P11 register D11). They are excluded by name; the suite fails if the compiler starts compiling them (the entry is
 * then stale). And every `$FORGE_ANSWER_<name>` a command reads names a question of an `elicit` step the command
 * depends on, so a misspelt answer cannot silently be empty.
 *
 * Lives at the repository root for the reason `test/workflows.test.ts` documents.
 */
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { execa } from 'execa';
import { describe, expect, it } from 'vitest';

import { executeStep } from '@forge/engine/dispatch';
import { compileRunPlan, type StepNode, type StepNodeKind } from '@forge/engine/plan';
import { parseWorkflow, type Workflow } from '@forge/engine/workflow';
import { WORKFLOW_INDEX } from '@forge/templates';

import { createTestContext, node } from '../packages/engine/test/dispatch/helpers.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modulesDir = path.join(repoRoot, 'modules');
const templatesRoot = path.join(repoRoot, 'packages', 'templates');

/**
 * The step kinds the engine refuses today (`RUN-039`), as the ENGINE reports them (the probe below). `subworkflow`
 * needs recursive workflow invocation, which is deferred past M13 (owner decision 2026-09-20).
 */
const REFUSED_KINDS: readonly StepNodeKind[] = ['subworkflow'];

/**
 * The shipped steps of a refused kind, by `<workflow>:<step id>`: the ones no run gets past. Each entry is checked
 * against the engine (its kind must still be refused) and against the workflows (the step must still exist).
 * `build-stage:deliver` is the only one: it is the stage's last step, and nothing depends on it.
 *
 * `build-stage:standup` (Q221 open item (j)) is deliberately NOT here: it is a `session` step with a roster
 * (`facilitator`/`participants` in `@forge/engine/interaction`), and `test/agent-prompts-all-workflows.test.ts`
 * dispatches it. Its note in Q221 described a project with no `.forge/agents` roster.
 */
const EXCLUDED_STEPS: Readonly<Record<string, string>> = {
  'build-stage:deliver':
    'a subworkflow step (deliver-stage): the engine has no nested workflow invocation (deferred past M13)',
};

/** Workflows whose `onComplete` hook steps the compiler leaves out of the plan (P11 register D11: deferred). The
 * only such workflow that shipped `onComplete` and could not be rewritten as ordinary steps is `build-stage`
 * (`stage-retro` needs the `em`'s output check, and its last step `deliver` is refused anyway). `intake`'s
 * `forge kb sync` is now the compiled last step `sync-kb`. */
const ON_COMPLETE_NOT_COMPILED: readonly string[] = ['build-stage'];

/** One value for every `fanout.over` target and workflow input any shipped workflow reads (the
 * `test/agent-prompts-all-workflows.test.ts` precedent); a workflow that needs another fails to compile here,
 * naming it. */
const FIXTURE_CONTEXT = {
  stage: {
    stories: [
      {
        id: 'story-1',
        owner_role: 'backend',
        test_paths: 'test/story-1.test.ts',
        files_expected: 'src/story-1.ts',
      },
    ],
  },
  run: {
    findings: [{ id: 'defect-1' }],
    testPaths: 'test/story-1.test.ts',
    filesExpected: 'src/story-1.ts',
  },
  vars: { integration_branch: 'forge/integration/stage-1' },
  stageId: 'stage-1',
  storyId: 'story-1',
  ownerRole: 'backend',
  defectId: 'defect-1',
  migrationGoal: 'expand the users table',
  changeSummary: 'add a new field',
  goal: 'extract a shared helper',
  interfaceName: 'orders-api',
  buildTarget: 'ios',
};

interface Shipped {
  readonly origin: string;
  readonly workflow: Workflow;
  readonly nodes: readonly StepNode[];
}

async function listWorkflowFiles(dir: string): Promise<readonly string[]> {
  const entries = await readdir(dir).catch(() => [] as string[]);
  return entries
    .filter((name) => name.endsWith('.workflow.yaml'))
    .sort()
    .map((name) => path.join(dir, name));
}

async function loadShipped(): Promise<readonly Shipped[]> {
  const files = [
    ...Object.values(WORKFLOW_INDEX).map((relative) => path.join(templatesRoot, relative)),
  ];
  for (const name of (await readdir(modulesDir)).sort()) {
    files.push(...(await listWorkflowFiles(path.join(modulesDir, name, 'workflows'))));
  }
  const loaded: Shipped[] = [];
  for (const file of files) {
    const parsed = parseWorkflow(await readFile(file, 'utf8'));
    if (!parsed.success)
      throw new Error(`${file} does not parse: ${JSON.stringify(parsed.issues)}`);
    const compiled = compileRunPlan(parsed.workflow, FIXTURE_CONTEXT);
    if (!compiled.success) {
      throw new Error(`${file} does not compile: ${JSON.stringify(compiled.issues)}`);
    }
    loaded.push({
      origin: path.relative(repoRoot, file),
      workflow: parsed.workflow,
      nodes: compiled.nodes,
    });
  }
  return loaded;
}

const shipped = await loadShipped();

/** `<workflow>:<step id>`, without a fanout item suffix. */
function keyOf(workflow: Workflow, compiledId: string): string {
  const rest = compiledId.slice(workflow.id.length + 1);
  return `${workflow.id}:${rest.split(':')[0] ?? rest}`;
}

/** Asks the engine whether it runs a step of `kind`: `executeStep` on a bare node, and whether it is refused with
 * `RUN-039` naming that kind. Only kinds cheap to probe are asked (a bare `agent`, `gate` or `session` node needs a
 * whole assembly context and is not what is in doubt): each of those has its own real handler and is dispatched, per
 * step, by `test/agent-prompts-all-workflows.test.ts`. */
async function engineRefuses(kind: StepNodeKind): Promise<boolean> {
  const projectRoot = await mkdtemp(path.join(tmpdir(), `forge-probe-${kind}-`));
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: projectRoot });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: projectRoot });
  try {
    await executeStep(
      node({
        id: `probe:${kind}`,
        kind,
        ...(kind === 'command' ? { run: 'true', laneAffinity: 'inline' as const } : {}),
        ...(kind === 'elicit' ? { questions: [{ name: 'q', prompt: 'q?' }] } : {}),
        ...(kind === 'subworkflow' ? { workflow: 'other' } : {}),
      }),
      createTestContext({ projectRoot }),
    );
    return false;
  } catch (error) {
    const failure = error as { code?: string; details?: { kind?: string } };
    return failure.code === 'RUN-039' && failure.details?.kind === kind;
  }
}

const PROBED_KINDS: readonly StepNodeKind[] = ['subworkflow', 'elicit', 'command', 'checkpoint'];

describe('what the engine runs, asked of the engine', () => {
  it('refuses exactly the pinned kinds among those it can be asked cheaply', async () => {
    const refused: StepNodeKind[] = [];
    for (const kind of PROBED_KINDS) if (await engineRefuses(kind)) refused.push(kind);
    expect(refused).toEqual(REFUSED_KINDS.filter((kind) => PROBED_KINDS.includes(kind)));
  });

  it('elicit is not refused any more (P20)', async () => {
    expect(await engineRefuses('elicit')).toBe(false);
  });
});

describe('every step of every shipped workflow', () => {
  it('enumerates the shipped workflows for real', () => {
    expect(shipped.length).toBeGreaterThanOrEqual(Object.keys(WORKFLOW_INDEX).length);
    expect(new Set(shipped.map((entry) => entry.workflow.id)).size).toBe(shipped.length);
  });

  it('is of a kind the engine runs, or is named in the exclusion set with its reason', () => {
    const problems: string[] = [];
    const seenExcluded = new Set<string>();
    for (const { origin, workflow, nodes } of shipped) {
      for (const compiled of nodes) {
        const key = keyOf(workflow, compiled.id);
        if (REFUSED_KINDS.includes(compiled.kind)) {
          if (Object.hasOwn(EXCLUDED_STEPS, key)) seenExcluded.add(key);
          else
            problems.push(
              `${origin}: ${key} is a ${compiled.kind} step the engine refuses and it is not in EXCLUDED_STEPS`,
            );
        } else if (Object.hasOwn(EXCLUDED_STEPS, key)) {
          problems.push(
            `${key} is in EXCLUDED_STEPS but its kind (${compiled.kind}) is run by the engine: the entry is stale`,
          );
        }
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
    for (const key of Object.keys(EXCLUDED_STEPS)) {
      expect(
        seenExcluded.has(key),
        `EXCLUDED_STEPS names ${key}, which no shipped workflow has`,
      ).toBe(true);
    }
  });

  it('the exclusion set names only steps of a kind the engine, asked now, still refuses', async () => {
    for (const key of Object.keys(EXCLUDED_STEPS)) {
      const [workflowId, stepId] = key.split(':');
      const workflow = shipped.find((entry) => entry.workflow.id === workflowId);
      const compiled = workflow?.nodes.find((entry) => keyOf(workflow.workflow, entry.id) === key);
      expect(compiled, `${key} does not exist`).toBeDefined();
      expect(stepId).toBeDefined();
      expect(
        await engineRefuses(compiled?.kind ?? 'agent'),
        `${key} is runnable now: drop it from EXCLUDED_STEPS`,
      ).toBe(true);
    }
  });

  it('every shipped elicit step is runnable and its questions are unique across its workflow', () => {
    const elicitSteps = shipped.flatMap(({ workflow, nodes }) =>
      nodes
        .filter((compiled) => compiled.kind === 'elicit')
        .map((compiled) => ({ workflow, compiled })),
    );
    // intake (three) and replan (one) today; a change here is deliberate.
    expect(elicitSteps.map(({ compiled }) => compiled.id).sort()).toEqual([
      'intake:confirm-level',
      'intake:elicit-constraints',
      'intake:elicit-idea',
      'replan:approve-change',
    ]);
    for (const { workflow } of shipped) {
      const names = elicitSteps
        .filter((entry) => entry.workflow === workflow)
        .flatMap(({ compiled }) => (compiled.questions ?? []).map((question) => question.name));
      expect(new Set(names).size, `${workflow.id} repeats a question name`).toBe(names.length);
    }
  });
});

describe('answers read by shipped commands', () => {
  it('every $FORGE_ANSWER_<name> names a question of an elicit step the command depends on', () => {
    const problems: string[] = [];
    let reads = 0;
    for (const { workflow, nodes } of shipped) {
      const byId = new Map(nodes.map((compiled) => [compiled.id, compiled]));
      const ancestorsOf = (id: string): Set<string> => {
        const seen = new Set<string>();
        const pending = [...(byId.get(id)?.dependsOn ?? [])];
        for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
          if (seen.has(next)) continue;
          seen.add(next);
          pending.push(...(byId.get(next)?.dependsOn ?? []));
        }
        return seen;
      };
      for (const compiled of nodes) {
        if (compiled.kind !== 'command') continue;
        for (const match of (compiled.run ?? '').matchAll(/FORGE_ANSWER_([A-Za-z0-9_]+)/g)) {
          reads += 1;
          const name = match[1];
          const ancestors = ancestorsOf(compiled.id);
          const asked = nodes.some(
            (entry) =>
              entry.kind === 'elicit' &&
              ancestors.has(entry.id) &&
              (entry.questions ?? []).some((question) => question.name === name),
          );
          if (!asked) {
            problems.push(
              `${workflow.id}: ${compiled.id} reads FORGE_ANSWER_${name ?? ''}, which no elicit step it depends on asks`,
            );
          }
        }
      }
    }
    // `intake:record-level` and `replan:re-derive` read one each; fewer means the guard stopped seeing them.
    expect(reads).toBeGreaterThanOrEqual(2);
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('no shipped command spells an answer as a {{answers...}} placeholder (they compile before any answer exists)', () => {
    for (const { workflow } of shipped) {
      expect(JSON.stringify(workflow)).not.toMatch(/\{\{\s*answers\b/);
    }
  });
});

describe('onComplete hooks, which the compiler leaves out of the plan', () => {
  const withHooks = shipped.filter((entry) => (entry.workflow.onComplete?.length ?? 0) > 0);

  it('only the pinned workflows still declare them', () => {
    expect(withHooks.map((entry) => entry.workflow.id).sort()).toEqual([
      ...ON_COMPLETE_NOT_COMPILED,
    ]);
  });

  it('are still absent from the compiled plan (if they appear, the pin is stale: run them and drop it)', () => {
    for (const { workflow, nodes } of withHooks) {
      const hookAgents = (workflow.onComplete ?? []).flatMap((step) =>
        step.kind === 'agent' ? [step.brief ?? ''] : [],
      );
      const briefs = new Set(nodes.map((compiled) => compiled.brief));
      for (const brief of hookAgents) {
        expect(
          briefs.has(brief),
          `${workflow.id}: the onComplete step using ${brief} is compiled now`,
        ).toBe(false);
      }
    }
  });

  it('intake keeps no onComplete: its kb sync is the compiled last step', () => {
    const intake = shipped.find((entry) => entry.workflow.id === 'intake');
    expect(intake?.workflow.onComplete).toBeUndefined();
    const last = intake?.nodes.at(-1);
    expect(last?.id).toBe('intake:sync-kb');
    expect(last?.run).toBe('forge kb sync');
  });
});
