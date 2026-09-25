/**
 * A tainted step's effective grant (`PLAN-M13.md` P28, `SPEC-QUESTIONS.md` Q222; `20` §20.5 points 3 and 4: "a step
 * whose context includes untrusted content is marked `taint: external` and loses privileged actions", "capability
 * restriction is the control"; `20` §20.1: the effective permission is the intersection of the agent grant, the step
 * grant and the runtime policy, and the runtime policy includes taint; `20` §20.10 S6).
 *
 * Before this, `taint: 'external'` reached `context.json` and gate approval and nothing else: the panel synthesiser
 * and the debate decider, which read other sessions' output, kept the agent's whole grant, exec and network
 * included (`SPEC-QUESTIONS.md` Q203 D8, Q215). Here the request the adapter actually receives is checked, through
 * the real dispatch paths and the fake adapter, against a control that is identical but untainted.
 */
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import type { SessionRequest, ToolGrant } from '@forge/adapter-kit';
import { slugifyStepId } from '@forge/vcs';
import { kbEntrySchema, type KbTree } from '@forge/kb';
import { FakePlatformAdapter } from '@forge/testkit';
import { describe, expect, it } from 'vitest';

import { TAINTED_ADR_STATUS_NOTE } from '../../src/dispatch/assemble.ts';
import { executeStep } from '../../src/dispatch/execute.ts';
import { createVcsFacade } from '../../src/dispatch/facades.ts';
import { resolveStepClaim } from '../../src/dispatch/outputs.ts';
import type { KbAccess, LaneHandle } from '../../src/dispatch/types.ts';
import { dispatchAgentStep } from '../../src/interaction/dispatch-agent-step.ts';
import { compilePlan, toAgentId, type StepNode } from '../../src/plan/index.ts';
import { restrictGrantForTaint } from '../../src/security/taint-guard.ts';
import { parseWorkflow } from '../../src/workflow/index.ts';
import {
  createFixtureAssembly,
  createTestContext,
  fixtureAgent,
  node,
} from '../dispatch/helpers.ts';

/** The real, shipped `adopt`/`migrate` workflows (`packages/templates/templates/workflows/`), read
 * directly by path rather than through `@forge/templates`: `@forge/engine` has no dependency edge to
 * that package, in `src/` or `test/` (`test/workflows.test.ts`'s own doc comment has the fuller
 * boundary reasoning), so this reads the same real file that package ships by raw path instead —
 * the identical pattern `run/budget-refusal.test.ts`'s own `RETRO_SOURCE` already establishes. */
const REPO = path.resolve(import.meta.dirname, '../../../..');
const ADOPT_SOURCE = await readFile(
  path.join(REPO, 'packages/templates/templates/workflows/adopt.workflow.yaml'),
  'utf8',
);
const MIGRATE_SOURCE = await readFile(
  path.join(REPO, 'packages/templates/templates/workflows/migrate.workflow.yaml'),
  'utf8',
);

/** The real, compiled `StepNode` for `stepId`, from the real shipped `source` text — `parseWorkflow`
 * then `compilePlan`, the same real pipeline `forge run` itself goes through (`PLAN-M14.md` P27), not a
 * hand-built `node()`. `externalKbIds` (`PLAN-M14.md` P30) is threaded through to `compilePlan`'s own
 * third argument, identically to how a real `forge run` would (`RunEngineContext.externalKbIds`). */
function compiledStep(
  source: string,
  stepId: string,
  externalKbIds?: ReadonlySet<string>,
): StepNode {
  const parsed = parseWorkflow(source);
  if (!parsed.success) {
    throw new Error(`failed to parse: ${parsed.issues.map((issue) => issue.message).join('; ')}`);
  }
  const plan = compilePlan(parsed.workflow, {}, { taint: { externalKbIds } });
  if (!plan.success) throw new Error(`failed to compile: ${JSON.stringify(plan.issues)}`);
  const found = plan.nodes.find((candidate) => candidate.id === stepId);
  if (found === undefined) {
    throw new Error(`no compiled step "${stepId}"; got ${plan.nodes.map((n) => n.id).join(', ')}`);
  }
  return found;
}

async function repo(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), `forge-taint-${prefix}-`));
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

/** A capable agent: writes, runs `git *` and `ls*`, reaches the network (`network: true` resolves to `allowlist`). Everything a tainted step must lose. */
const CAPABLE = fixtureAgent('po', {
  tools: {
    read: true,
    write: true,
    exec: ['git *', 'ls*'],
    network: true,
    git_commit: 'lane',
    deploy: false,
  },
});

function recorder(requests: SessionRequest[]): FakePlatformAdapter {
  const adapter = new FakePlatformAdapter({}, { strict: true });
  adapter.script(
    (request) => {
      requests.push(request);
      return true;
    },
    { text: ['done'], structured: { findings: [], checked: ['x'] } },
  );
  return adapter;
}

function grantOf(requests: readonly SessionRequest[], match: (id: string) => boolean): ToolGrant {
  const request = requests.find((candidate) => match(candidate.stepId));
  if (request === undefined)
    throw new Error(`no session matched; saw ${requests.map((r) => r.stepId).join(', ')}`);
  return request.tools;
}

async function dispatch(
  taint: 'external' | undefined,
  overrides: Parameters<typeof node>[0] extends infer P ? Partial<P> : never = {},
): Promise<ToolGrant> {
  const projectRoot = await repo('agent');
  const requests: SessionRequest[] = [];
  const ctx = createTestContext({
    projectRoot,
    adapter: recorder(requests),
    assembly: createFixtureAssembly(projectRoot, { loadAgent: () => Promise.resolve(CAPABLE) }),
  });
  await executeStep(
    node({
      id: 'wf:step',
      kind: 'agent',
      agent: toAgentId('po'),
      brief: 'write the summary',
      ...(taint === undefined ? {} : { taint }),
      ...overrides,
    }),
    ctx,
  );
  return grantOf(requests, (id) => id === 'wf:step');
}

describe('restrictGrantForTaint (the pure rule)', () => {
  const grant: ToolGrant = {
    read: true,
    write: true,
    exec: ['git *'],
    network: 'allowlist',
    allowlistHosts: ['registry.example'],
    extra: ['mcp__tickets__search'],
  };

  it('an untainted step gets its grant back, the same object', () => {
    expect(restrictGrantForTaint(grant, undefined, { mayWrite: false })).toBe(grant);
  });

  it('a tainted step keeps read; loses exec, network, the host list and the adapter-specific tools; keeps write only with a claim to write in', () => {
    expect(restrictGrantForTaint(grant, 'external', { mayWrite: true })).toEqual({
      read: true,
      write: true,
      exec: false,
      network: 'none',
    });
    expect(restrictGrantForTaint(grant, 'external', { mayWrite: false })).toEqual({
      read: true,
      write: false,
      exec: false,
      network: 'none',
    });
  });

  it('never widens: a grant that could not write still cannot, claim or no claim', () => {
    expect(
      restrictGrantForTaint({ ...grant, write: false }, 'external', { mayWrite: true }).write,
    ).toBe(false);
  });

  it('is idempotent', () => {
    const once = restrictGrantForTaint(grant, 'external', { mayWrite: true });
    expect(restrictGrantForTaint(once, 'external', { mayWrite: true })).toEqual(once);
  });
});

describe('an agent step marked taint: external, through the real dispatch path', () => {
  it('control: the identical untainted step gets the agent’s whole grant (so the restriction below is not vacuous)', async () => {
    expect(await dispatch(undefined, { produces: ['docs/summary.md'] })).toMatchObject({
      read: true,
      write: true,
      exec: ['git *', 'ls*'],
      network: 'allowlist',
    });
  });

  it('with a claim (`produces`): write survives, exec and network do not', async () => {
    const grant = await dispatch('external', { produces: ['docs/summary.md'] });
    expect(grant).toEqual({ read: true, write: true, exec: false, network: 'none' });
  });

  it('with no claim at all: it keeps NO write access it did not need', async () => {
    const grant = await dispatch('external');
    expect(grant).toEqual({ read: true, write: false, exec: false, network: 'none' });
  });

  it('the prompt the model reads states the restricted grant, so the agent is not told it may run what it cannot', async () => {
    const projectRoot = await repo('prompt');
    const requests: SessionRequest[] = [];
    const ctx = createTestContext({
      projectRoot,
      adapter: recorder(requests),
      assembly: createFixtureAssembly(projectRoot, { loadAgent: () => Promise.resolve(CAPABLE) }),
    });
    await executeStep(
      node({
        id: 'wf:t',
        kind: 'agent',
        agent: toAgentId('po'),
        brief: 'summarise',
        taint: 'external',
      }),
      ctx,
    );
    const text = requests[0]?.systemPrompt.text ?? '';
    expect(text).not.toContain('git *');
    expect(text).not.toContain('ls*');
  });

  it("block [6] states PLAN-M14.md P31's own ADR-status rule for a tainted step, and only for one", async () => {
    const projectRoot = await repo('adr-note');
    const requests: SessionRequest[] = [];
    const ctx = createTestContext({
      projectRoot,
      adapter: recorder(requests),
      assembly: createFixtureAssembly(projectRoot, { loadAgent: () => Promise.resolve(CAPABLE) }),
    });
    await executeStep(
      node({
        id: 'wf:tainted-note',
        kind: 'agent',
        agent: toAgentId('po'),
        brief: 'rule on it',
        taint: 'external',
      }),
      ctx,
    );
    expect(requests[0]?.systemPrompt.text ?? '').toContain(TAINTED_ADR_STATUS_NOTE);

    const control = await repo('adr-note-control');
    const controlRequests: SessionRequest[] = [];
    const controlCtx = createTestContext({
      projectRoot: control,
      adapter: recorder(controlRequests),
      assembly: createFixtureAssembly(control, { loadAgent: () => Promise.resolve(CAPABLE) }),
    });
    await executeStep(
      node({ id: 'wf:untainted-note', kind: 'agent', agent: toAgentId('po'), brief: 'rule on it' }),
      controlCtx,
    );
    expect(controlRequests[0]?.systemPrompt.text ?? '').not.toContain(TAINTED_ADR_STATUS_NOTE);
  });
});

describe('the real, shipped adopt/migrate workflows, compiled and dispatched (PLAN-M14.md P27)', () => {
  it('adopt:reverse-derive-specs, through executeStep: {read, write, exec: false, network: none}, externalContent: true, no test commands', async () => {
    const stepNode = compiledStep(ADOPT_SOURCE, 'adopt:reverse-derive-specs');
    expect(stepNode.taint).toBe('external');

    const projectRoot = await repo('adopt-reverse-derive');
    const requests: SessionRequest[] = [];
    const ctx = createTestContext({
      projectRoot,
      adapter: recorder(requests),
      assembly: createFixtureAssembly(projectRoot, {
        loadAgent: () =>
          Promise.resolve(
            fixtureAgent('architect', {
              tools: {
                read: true,
                write: true,
                exec: ['git *'],
                network: true,
                git_commit: 'lane',
                deploy: false,
              },
            }),
          ),
      }),
    });
    // The eventual output check (a real ADR/DataModel pair) is not this test's concern -- the grant and
    // `context.json` are both real before that check ever runs (`assemble.ts`'s own doc comment: "context.json
    // is written first ... immediately before it hands the session to the adapter"), so `outcome.status` is
    // deliberately not asserted here.
    await executeStep(stepNode, ctx);

    const grant = grantOf(requests, (id) => id === stepNode.id);
    expect(grant).toEqual({ read: true, write: true, exec: false, network: 'none' });

    const contextJson = JSON.parse(
      await readFile(
        path.join(
          projectRoot,
          '.forge',
          'state',
          'runs',
          ctx.runId,
          'steps',
          slugifyStepId(stepNode.id),
          'context.json',
        ),
        'utf8',
      ),
    ) as { externalContent: boolean; testCommands?: unknown };
    expect(contextJson.externalContent).toBe(true);
    expect('testCommands' in contextJson).toBe(false);
  });

  it('migrate:expand (backend, real exec: ["git *"]) has exec: false once compiled and dispatched for real', async () => {
    const stepNode = compiledStep(MIGRATE_SOURCE, 'migrate:expand');
    expect(stepNode.taint).toBe('external');

    const projectRoot = await repo('migrate-expand');
    const requests: SessionRequest[] = [];
    const ctx = createTestContext({
      projectRoot,
      adapter: recorder(requests),
      assembly: createFixtureAssembly(projectRoot, {
        loadAgent: () =>
          Promise.resolve(
            fixtureAgent('backend', {
              tools: {
                read: true,
                write: true,
                exec: ['git *'],
                network: true,
                git_commit: 'lane',
                deploy: false,
              },
            }),
          ),
      }),
    });
    const outcome = await executeStep(stepNode, ctx);
    // No claim was written outside `produces: ['**', '!@protected']`, and nothing was written at all --
    // this step genuinely succeeds too, not only the grant restriction.
    expect(outcome.status).toBe('succeeded');

    const grant = grantOf(requests, (id) => id === stepNode.id);
    expect(grant).toEqual({ read: true, write: true, exec: false, network: 'none' });
  });
});

describe('panel synthesis and the debate decider (the two steps the workflow engine marks tainted)', () => {
  async function run(
    mode: 'panel' | 'debate',
    overrides: Parameters<typeof node>[0] extends infer P ? Partial<P> : never = {},
  ) {
    const projectRoot = await repo(mode);
    const requests: SessionRequest[] = [];
    const ctx = createTestContext({
      projectRoot,
      adapter: recorder(requests),
      assembly: createFixtureAssembly(projectRoot, { loadAgent: () => Promise.resolve(CAPABLE) }),
    });
    await dispatchAgentStep(
      node({
        id: `wf:${mode}`,
        kind: 'agent',
        agent: toAgentId('po'),
        brief: 'Which database?',
        ...overrides,
      }),
      CAPABLE,
      ctx,
      mode,
      mode === 'panel' ? { perspectives: ['cost', 'risk'] } : { maxDebateRounds: 1 },
    );
    return requests;
  }

  it.each(['panel', 'debate'] as const)(
    '%s: the synthesising/deciding session has no exec, no network and no write it did not need',
    async (mode) => {
      const requests = await run(mode);
      // The last session is the synthesis / the decision (participants are read-only already).
      const last = requests.at(-1);
      expect(last?.tools).toEqual({ read: true, write: false, exec: false, network: 'none' });
      for (const request of requests) expect(request.tools.exec).toBe(false);
    },
  );

  it.each(['panel', 'debate'] as const)(
    '%s: a step that declares somewhere to write (`produces`) keeps write, and only write',
    async (mode) => {
      const requests = await run(mode, { produces: ['docs/forge/kb/decisions/*.md'] });
      expect(requests.at(-1)?.tools).toEqual({
        read: true,
        write: true,
        exec: false,
        network: 'none',
      });
    },
  );
});

describe('a tainted step is held to its claim at every autonomy level', () => {
  const ROOTS = {
    kb: 'docs/forge/kb',
    specs: 'docs/forge/specs',
    plans: 'docs/forge/plans',
    sessions: 'docs/forge/sessions',
    reports: 'docs/forge/reports',
  };

  it('resolveStepClaim: strict for a tainted step even where the project default is warn; unchanged otherwise', () => {
    const base = { kind: 'agent', outputs: [], produces: ['docs/summary.md'] } as const;
    expect(resolveStepClaim({ ...base, taint: 'external' }, ROOTS, 'warn').policy).toBe('strict');
    expect(resolveStepClaim(base, ROOTS, 'warn').policy).toBe('warn');
    expect(resolveStepClaim({ ...base, taint: 'external' }, ROOTS, 'warn').globs).toEqual([
      'docs/summary.md',
    ]);
  });

  it('end to end (default policy warn): a file the tainted step wrote outside its `produces` is reverted, not kept, and (PLAN-M14.md P3) fails the step -- unlike the untainted control at the same `warn` default', async () => {
    const projectRoot = await repo('claim');
    const adapter = new FakePlatformAdapter({}, { strict: true });
    adapter.script(() => true, {
      text: ['done'],
      writeFiles: [
        { relativePath: 'docs/summary.md', content: 'ok\n' },
        { relativePath: 'src/stray.ts', content: 'export {};\n' },
      ],
    });
    const runId = 'run-taint-claim';
    // Captured at creation, not read back from `ctx.laneRegistry`: `PLAN-M14.md` P3 (`06` §6.7 as amended,
    // `SPEC-QUESTIONS.md` Q232 decision 1) means a real claim violation under the now-forced `strict`
    // policy fails the step, and a failed step's lane is never registered there.
    const real = createVcsFacade(projectRoot, runId);
    let created: LaneHandle | undefined;
    const ctx = createTestContext({
      projectRoot,
      adapter,
      runId,
      claimPolicy: 'warn',
      vcs: {
        ...real,
        createLane: async (stepId, base) => {
          created = await real.createLane(stepId, base);
          return created;
        },
      },
      assembly: createFixtureAssembly(projectRoot, { loadAgent: () => Promise.resolve(CAPABLE) }),
    });
    const stepNode = node({
      id: 'wf:t',
      kind: 'agent',
      agent: toAgentId('po'),
      brief: 'summarise',
      produces: ['docs/summary.md'],
      taint: 'external',
    });
    const outcome = await executeStep(stepNode, ctx);
    // `resolveStepClaim` forces `strict` for a tainted step regardless of the project's own `warn`
    // default (asserted directly above); a real out-of-claim write under `strict` now fails the step.
    expect(outcome.status).toBe('failed');
    expect(outcome.failure).toMatchObject({ source: 'claim', code: 'RUN-104' });
    expect(ctx.laneRegistry.has('wf:t')).toBe(false);
    if (created === undefined) throw new Error('no lane');
    const tree = (
      await execa('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: created.path })
    ).stdout;
    expect(tree).toContain('docs/summary.md');
    expect(tree).not.toContain('src/stray.ts');

    // Control: the same step, untainted, at the same `warn` default, keeps the stray file (that is what `warn` is).
    const control = await repo('claim-control');
    const adapter2 = new FakePlatformAdapter({}, { strict: true });
    adapter2.script(() => true, {
      text: ['done'],
      writeFiles: [
        { relativePath: 'docs/summary.md', content: 'ok\n' },
        { relativePath: 'src/stray.ts', content: 'export {};\n' },
      ],
    });
    const ctx2 = createTestContext({
      projectRoot: control,
      adapter: adapter2,
      runId: 'run-taint-claim-control',
      claimPolicy: 'warn',
      assembly: createFixtureAssembly(control, { loadAgent: () => Promise.resolve(CAPABLE) }),
    });
    await executeStep({ ...stepNode, taint: undefined }, ctx2);
    const lane2 = ctx2.laneRegistry.get('wf:t');
    if (lane2 === undefined) throw new Error('no lane');
    expect(
      (await execa('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: lane2.path })).stdout,
    ).toContain('src/stray.ts');
  });
});

describe('a step tainted by its own declared mcp: input, compiled through the real pipeline end to end (PLAN-M14.md P30, 20 §20.5 point 3)', () => {
  const MCP_INPUT_WORKFLOW = [
    'id: extwf',
    'name: External input workflow',
    'version: 1.0.0',
    'description: d',
    'steps:',
    '  - id: search',
    '    kind: agent',
    '    agent: po',
    "    brief: 'search the tracker for related issues'",
    "    inputs: [ 'mcp:jira/search_issues' ]",
    '',
  ].join('\n');

  it("reaches the adapter with exec: false, network: 'none' -- the identical restriction an authored taint: external gets -- and block [4] lists the external input", async () => {
    const projectRoot = await repo('mcp-input');
    const requests: SessionRequest[] = [];
    const ctx = createTestContext({
      projectRoot,
      adapter: recorder(requests),
      assembly: createFixtureAssembly(projectRoot, { loadAgent: () => Promise.resolve(CAPABLE) }),
    });
    const stepNode = compiledStep(MCP_INPUT_WORKFLOW, 'extwf:search');
    // Sanity: the real compile site (`compilePlan`, `PLAN-M14.md` P30) is what tainted this node --
    // nothing here hand-sets `taint` the way `dispatch()`'s own helper does above.
    expect(stepNode.taint).toBe('external');

    await executeStep(stepNode, ctx);

    const request = requests.find((candidate) => candidate.stepId === 'extwf:search');
    if (request === undefined) throw new Error('no session dispatched for extwf:search');
    // No `produces`/`outputs` claim: `write` is restricted the same way an authored `taint: external`
    // step with nothing to write inside already is (`restrictGrantForTaint`'s own `mayWrite: false` row).
    expect(request.tools).toEqual({ read: true, write: false, exec: false, network: 'none' });
    expect(request.systemPrompt.text).toContain('External inputs for this step');
    expect(request.systemPrompt.text).toContain('mcp:jira/search_issues');
  });
});

describe('a step tainted by a declared kb: input whose id carries external provenance (PLAN-M14.md P30, 20 §20.5 point 1: content is labelled, not only the grant restricted)', () => {
  const KB_INPUT_WORKFLOW = [
    'id: extwf',
    'name: External-provenance KB input workflow',
    'version: 1.0.0',
    'description: d',
    'steps:',
    '  - id: summarize',
    '    kind: agent',
    '    agent: po',
    "    brief: 'summarize the incident'",
    "    inputs: [ 'kb:KB-ARCH-0001' ]",
    '',
  ].join('\n');

  function kbAccessWithExternalEntry(): KbAccess {
    const entry = kbEntrySchema.parse({
      id: 'KB-ARCH-0001',
      type: 'knowledge',
      section: 'architecture',
      title: 'An incident summary pulled from Confluence',
      status: 'active',
      confidence: 'high',
      owner: 'architect',
      sources: [{ kind: 'external', ref: 'mcp:confluence/get_page' }],
      created: '2026-01-05',
      updated: '2026-01-05',
      review_by: '2026-04-05',
      supersedes: [],
      superseded_by: null,
      related: [],
      diagrams: [],
      tags: [],
      applies_to: [],
      body: '## Statement\nThe incident root cause was a stale cache.',
    });
    const tree: KbTree = {
      entries: [{ path: 'architecture/KB-ARCH-0001.md', kind: 'kb-entry', value: entry }],
      errors: [],
    };
    return {
      backend: {
        upsertEntry: () => undefined,
        upsertLinks: () => undefined,
        search: () => [],
        expand: () => [],
        clear: () => undefined,
        close: () => undefined,
      },
      tree,
      parseErrorCount: 0,
      close: () => undefined,
    };
  }

  it('taints (grant: exec false, network none), packs the entry\'s full text AND labels it "EXTERNALLY SOURCED" in block [4] -- not merely an unlabelled ordinary "Declared inputs" entry', async () => {
    const projectRoot = await repo('kb-provenance-input');
    const requests: SessionRequest[] = [];
    const ctx = createTestContext({
      projectRoot,
      adapter: recorder(requests),
      assembly: createFixtureAssembly(projectRoot, {
        loadAgent: () => Promise.resolve(CAPABLE),
        openKb: () => Promise.resolve(kbAccessWithExternalEntry()),
      }),
      // The identical set `collectExternalKbIds` would have produced for this one entry (id + path).
      externalKbIds: new Set(['KB-ARCH-0001', 'architecture/KB-ARCH-0001.md']),
    });
    const stepNode = compiledStep(KB_INPUT_WORKFLOW, 'extwf:summarize', ctx.externalKbIds);
    expect(stepNode.taint).toBe('external');

    await executeStep(stepNode, ctx);

    const request = requests.find((candidate) => candidate.stepId === 'extwf:summarize');
    if (request === undefined) throw new Error('no session dispatched for extwf:summarize');
    expect(request.tools).toEqual({ read: true, write: false, exec: false, network: 'none' });
    // The entry's own full text is still packed (unlike an mcp:/fetch: reference, this one IS real,
    // local, already-on-disk project data) -- 20 §20.5 point 1 asks for it to be labelled, not withheld.
    expect(request.systemPrompt.text).toContain('The incident root cause was a stale cache.');
    expect(request.systemPrompt.text).toContain('External inputs for this step');
    expect(request.systemPrompt.text).toContain('kb:KB-ARCH-0001');
    expect(request.systemPrompt.text).toContain('EXTERNALLY SOURCED');
  });

  it('a step declaring the identical kb: input, when its id is NOT in externalKbIds, is untainted and carries no external label at all (control)', async () => {
    const projectRoot = await repo('kb-provenance-control');
    const requests: SessionRequest[] = [];
    const ctx = createTestContext({
      projectRoot,
      adapter: recorder(requests),
      assembly: createFixtureAssembly(projectRoot, {
        loadAgent: () => Promise.resolve(CAPABLE),
        openKb: () => Promise.resolve(kbAccessWithExternalEntry()),
      }),
      // No externalKbIds at all: the identical KB entry, but nothing marks it external.
    });
    const stepNode = compiledStep(KB_INPUT_WORKFLOW, 'extwf:summarize');
    expect('taint' in stepNode).toBe(false);

    await executeStep(stepNode, ctx);

    const request = requests.find((candidate) => candidate.stepId === 'extwf:summarize');
    if (request === undefined) throw new Error('no session dispatched for extwf:summarize');
    expect(request.tools).toMatchObject({ exec: ['git *', 'ls*'], network: 'allowlist' });
    expect(request.systemPrompt.text).toContain('The incident root cause was a stale cache.');
    expect(request.systemPrompt.text).not.toContain('EXTERNALLY SOURCED');
    expect(request.systemPrompt.text).not.toContain('External inputs for this step');
  });

  // Round-2 gauntlet critic finding: the GLOB half of round-1's own glob-taint fix (kb:architecture/**,
  // 10 §10.1's own worked example) tainted the step correctly (grant restricted) but this describe
  // block's own two tests above only ever exercise an EXACT kb:<id> reference, so the glob case's own
  // block [4]/[3] labelling was never proved -- and, independently checked here, was not actually wired.
  it("taints a step declaring a GLOB kb: input (kb:architecture/**, 10 §10.1's own worked example) whose pattern overlaps an external-provenance path, and names it in block [4] even though (Q203's own standing limit) the glob is never packed as a single declared-input entry", async () => {
    const GLOB_INPUT_WORKFLOW = [
      'id: extwf',
      'name: Glob KB input workflow',
      'version: 1.0.0',
      'description: d',
      'steps:',
      '  - id: freeze',
      '    kind: agent',
      '    agent: po',
      "    brief: 'freeze the contracts'",
      "    inputs: [ 'kb:architecture/**' ]",
      '',
    ].join('\n');
    const projectRoot = await repo('kb-provenance-glob');
    const requests: SessionRequest[] = [];
    const ctx = createTestContext({
      projectRoot,
      adapter: recorder(requests),
      assembly: createFixtureAssembly(projectRoot, {
        loadAgent: () => Promise.resolve(CAPABLE),
        openKb: () => Promise.resolve(kbAccessWithExternalEntry()),
      }),
      externalKbIds: new Set(['KB-ARCH-0001', 'architecture/KB-ARCH-0001.md']),
    });
    const stepNode = compiledStep(GLOB_INPUT_WORKFLOW, 'extwf:freeze', ctx.externalKbIds);
    expect(stepNode.taint).toBe('external');

    await executeStep(stepNode, ctx);

    const request = requests.find((candidate) => candidate.stepId === 'extwf:freeze');
    if (request === undefined) throw new Error('no session dispatched for extwf:freeze');
    expect(request.tools).toEqual({ read: true, write: false, exec: false, network: 'none' });
    expect(request.systemPrompt.text).toContain('kb:architecture/**');
    expect(request.systemPrompt.text).toContain('EXTERNALLY SOURCED');
    expect(request.systemPrompt.text).toContain('External inputs for this step');
    // Q203's own standing limit (a glob is never resolved to one exact id) is unrelated to and unchanged
    // by this fix: the glob still names no single packed entry, so the body text itself never appears.
    expect(request.systemPrompt.text).not.toContain('The incident root cause was a stale cache.');
  });
});
