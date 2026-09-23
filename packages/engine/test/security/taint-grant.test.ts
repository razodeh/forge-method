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
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import type { SessionRequest, ToolGrant } from '@forge/adapter-kit';
import { FakePlatformAdapter } from '@forge/testkit';
import { describe, expect, it } from 'vitest';

import { executeStep } from '../../src/dispatch/execute.ts';
import { createVcsFacade } from '../../src/dispatch/facades.ts';
import { resolveStepClaim } from '../../src/dispatch/outputs.ts';
import type { LaneHandle } from '../../src/dispatch/types.ts';
import { dispatchAgentStep } from '../../src/interaction/dispatch-agent-step.ts';
import { toAgentId } from '../../src/plan/index.ts';
import { restrictGrantForTaint } from '../../src/security/taint-guard.ts';
import {
  createFixtureAssembly,
  createTestContext,
  fixtureAgent,
  node,
} from '../dispatch/helpers.ts';

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
