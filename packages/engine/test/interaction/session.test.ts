/**
 * `runSessionStep` — `PLAN-M10.md` P10's own Checks, tested against a real `FakePlatformAdapter` and a
 * real tmp-dir git repository (matching this package's own established test convention).
 *
 * @see specs/16 §16.3
 * @see specs/16 §16.6
 * @see PLAN-M10.md P10
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { ForgeError } from '@forge/core/errors';
import { readTextFile, writeFileAtomic, ProjectPaths } from '@forge/core/fs';
import { FakePlatformAdapter } from '@forge/testkit';
import type { PlatformAdapter, SessionRequest } from '@forge/adapter-kit';
import type { SessionRecord } from '@forge/schemas';
import { describe, expect, it } from 'vitest';

import { executeStep } from '../../src/dispatch/execute.ts';
import { createTelemetryFacade } from '../../src/dispatch/facades.ts';
import type { NewDispatchEvent, TelemetryFacade } from '../../src/dispatch/types.ts';
import { runSessionStep, type SessionStepResult } from '../../src/interaction/session.ts';
import { createTestContext, createTestClock, node } from '../dispatch/helpers.ts';

/** `SessionStepResult.record` is only absent for a domain refusal (FRAME/CONVERGE) this test file's
 * own happy-path tests never trigger -- a small, explicit guard beats a forbidden `!` assertion
 * (`@typescript-eslint/no-non-null-assertion`) at every one of this file's own many call sites. */
function requireRecord(result: SessionStepResult): SessionRecord {
  if (result.record === undefined) throw new Error('expected runSessionStep to produce a record');
  return result.record;
}

// R10-restricted node:os in production code; the *.test.ts exemption only covers this file itself,
// matching every other @forge/engine test's own duplicated helper convention.
async function createTempRepo(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), `forge-session-${prefix}-`));
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

/** A real, on-disk `modules/<id>/agents/architect.agent.yaml` -- `05` §5.3's own canonical path,
 * schema-valid, with a real, non-empty `decisions_owned` so `resolveDecisionOwner` (`session.ts`) has
 * a genuine agent to resolve DECIDE's own owner to. */
const ARCHITECT_AGENT_YAML = `
id: architect
name: System Architect
version: 1.0.0
tier: core
mandate: Owns the shape of the system.
decisions_owned:
  - architecture.decomposition
persona:
  voice: precise
  stance: prefers boring, reversible choices
  disagreement_style: names the specific assumption being challenged
inputs:
  required: []
outputs:
  - type: ArchitectureSpec
    schema: architecture-spec.schema.json
    path: docs/forge/kb/architecture/architecture-spec.md
kb_write:
  - architecture/**
tools:
  read: true
  write: true
  network: false
  git_commit: lane
  deploy: false
model:
  tier: balanced
  thinking: medium
limits:
  max_turns: 10
  wall_clock_ms: 600000
  max_cost_usd: 5
parallel_safety:
  file_ownership: []
  exclusive: false
gates:
  produces_evidence_for: []
  may_approve: []
prompt:
  system: prompts/architect.system.md
`;

async function withRealAgentRoster(projectRoot: string): Promise<void> {
  const paths = new ProjectPaths(projectRoot);
  const target = paths.resolveWithin('modules/test-module/agents/architect.agent.yaml');
  await writeFileAtomic(target, ARCHITECT_AGENT_YAML);
}

/** Wraps a real `FakePlatformAdapter`, recording every `startSession` request's own `stepId` -- the
 * one real, inspectable signal proving *which* dispatch calls actually happened (this piece's own
 * Checks text: "confirmed genuinely absent... not merely instructed to stay quiet"). */
function recordingAdapter(adapter: FakePlatformAdapter): {
  readonly wrapped: PlatformAdapter;
  readonly stepIds: string[];
} {
  const stepIds: string[] = [];
  const wrapped: PlatformAdapter = {
    id: adapter.id,
    displayName: adapter.displayName,
    capabilities: () => adapter.capabilities(),
    preflight: () => adapter.preflight(),
    listModels: () => adapter.listModels(),
    startSession: (req: SessionRequest) => {
      stepIds.push(req.stepId);
      return adapter.startSession(req);
    },
    resumeSession: (sessionId, req) => adapter.resumeSession(sessionId, req),
  };
  return { wrapped, stepIds };
}

function recordingTelemetry(
  projectRoot: string,
  runId: string,
  now: () => number,
): {
  readonly telemetry: TelemetryFacade;
  readonly events: NewDispatchEvent[];
} {
  const events: NewDispatchEvent[] = [];
  const real = createTelemetryFacade(projectRoot, runId, now);
  return {
    events,
    telemetry: {
      emit: (event) => {
        events.push(event);
        return real.emit(event);
      },
    },
  };
}

describe('runSessionStep — end to end', () => {
  it('a real brainstorm session run against FakePlatformAdapter produces a real, valid, complete SessionRecord', async () => {
    const projectRoot = await createTempRepo('brainstorm-e2e');
    await withRealAgentRoster(projectRoot);
    const adapter = new FakePlatformAdapter();
    const ctx = createTestContext({ projectRoot, adapter });
    const stepNode = node({
      id: 'wf:brainstorm-onboarding',
      kind: 'session',
      sessionType: 'brainstorm',
      brief: 'How do we cut time-to-first-invoice',
    });

    const result = await runSessionStep(stepNode, ctx);

    expect(result.outcome.status).toBe('succeeded');
    const record = requireRecord(result);
    expect(record.type).toBe('SessionRecord');
    expect(record.sessionType).toBe('brainstorm');
    expect(record.question).toBe('How do we cut time-to-first-invoice');
    // `architect` is the third role in brainstorm's own participant list and the only one this test's
    // roster actually registers with a real decisions_owned entry -- resolving to it, not to a human
    // fallback, is the real, checkable proof DECIDE's own owner resolution ran for real.
    expect(record.participants).toContain('architect');
    // `canComplete` (via `assembleSessionRecord`) only reaches `status: 'complete'` when a real
    // decision carries a real artifactRef -- proving RECORD's own KB write-back actually ran.
    expect(record.status).toBe('complete');

    // The mandatory write-back (`16` §16.5) landed a real KB entry on disk, not just an in-memory
    // artifactRef string.
    const kbFile = new ProjectPaths(projectRoot).resolveWithin(
      `docs/forge/kb/product/session-${stepNode.id.replace(/[^a-zA-Z0-9]+/g, '-')}.md`,
    );
    const kbEntry = await readTextFile(kbFile);
    expect(kbEntry).toContain('Session decision');
  });

  it('a DECIDE-phase owner that resolves to no real agent falls back to a real human-input request, not a silent skip or a thrown error', async () => {
    // No modules/ directory at all -- loadProjectAgentRegistry's own real, honest empty-registry case.
    const projectRoot = await createTempRepo('decide-human-fallback');
    const adapter = new FakePlatformAdapter();
    const clock = createTestClock();
    const { telemetry, events } = recordingTelemetry(projectRoot, 'run-test', clock);
    const ctx = createTestContext({ projectRoot, adapter, now: clock, telemetry });
    const stepNode = node({
      id: 'wf:brainstorm-no-owner',
      kind: 'session',
      sessionType: 'brainstorm',
      brief: 'What should the pricing page say',
    });

    const result = await runSessionStep(stepNode, ctx);

    // Not a thrown error: the call above already returned normally, above this line.
    expect(result.outcome.status).toBe('succeeded');
    // Not a silent skip: the session is honestly inconclusive, with a real, stated reason -- 16 §16.5's
    // own "sessions with zero decisions and zero actions are recorded as inconclusive."
    expect(requireRecord(result).status).toBe('inconclusive');
    // A real human-input request was actually issued, not merely implied.
    const elicitations = events.filter((event) => event.type === 'ElicitationRequested');
    expect(elicitations).toHaveLength(1);
    expect(elicitations[0]?.stepId).toBe('wf:brainstorm-no-owner');
  });

  it('a genuinely failed DECIDE-phase dispatch is reported as a real failure, never fabricated into a successful decision', async () => {
    const projectRoot = await createTempRepo('decide-dispatch-failed');
    await withRealAgentRoster(projectRoot);
    const adapter = new FakePlatformAdapter();
    // The resolved owner is `architect` (see the roster fixture above) -- its own DECIDE dispatch
    // fails outright, never producing a real decision.
    adapter.injectFailure((req) => req.stepId.includes(':decide'), 'error');
    const ctx = createTestContext({ projectRoot, adapter });
    const stepNode = node({
      id: 'wf:brainstorm-decide-fails',
      kind: 'session',
      sessionType: 'brainstorm',
      brief: 'Should we ship the quick-invoice path',
    });

    const result = await runSessionStep(stepNode, ctx);

    // The real failure is reported as data, not swallowed into a fabricated success.
    expect(result.outcome.status).toBe('failed');
    expect(result.outcome.failure).toBeDefined();
    // No decision was invented from the failed session's own empty output -- the record is honestly
    // inconclusive, exactly as the human-fallback path above is.
    expect(requireRecord(result).status).toBe('inconclusive');

    // No KB entry was written for a decision nobody actually made.
    const kbFile = new ProjectPaths(projectRoot).resolveWithin(
      `docs/forge/kb/product/session-${stepNode.id.replace(/[^a-zA-Z0-9]+/g, '-')}.md`,
    );
    await expect(readTextFile(kbFile)).rejects.toThrow();
  });
});

describe('runSessionStep — RECORD persists the real artifact', () => {
  it('writes docs/forge/sessions/SESSION-###.md with the real transcript and decisions, not just the in-memory return value', async () => {
    const projectRoot = await createTempRepo('record-persist');
    await withRealAgentRoster(projectRoot);
    const adapter = new FakePlatformAdapter();
    const ctx = createTestContext({ projectRoot, adapter });
    const stepNode = node({
      id: 'wf:brainstorm-persist',
      kind: 'session',
      sessionType: 'brainstorm',
      brief: 'How do we reduce churn',
    });

    const result = await runSessionStep(stepNode, ctx);

    const target = new ProjectPaths(projectRoot).resolveWithin(
      `docs/forge/sessions/${requireRecord(result).id}.md`,
    );
    const text = await readTextFile(target);
    expect(text).toContain('## Decisions');
    expect(text).toContain('## Diverge');
  });

  it('allocates a different SESSION id for two different session steps run in the same project, even when the naive hash would collide', async () => {
    // `wf:brainstorm-100` and `wf:brainstorm-218` are a real, verified pair whose own
    // `numericSessionId(nodeId#0)` collides on the very first probe (271, computed directly against
    // this file's own hash) -- a genuine exercise of `allocateSessionId`'s own linear probe actually
    // running and finding a second candidate, not merely existing unused.
    const projectRoot = await createTempRepo('id-collision');
    await withRealAgentRoster(projectRoot);
    const adapter = new FakePlatformAdapter();
    const ctx = createTestContext({ projectRoot, adapter });

    const first = await runSessionStep(
      node({
        id: 'wf:brainstorm-100',
        kind: 'session',
        sessionType: 'brainstorm',
        brief: 'Question one',
      }),
      ctx,
    );
    const second = await runSessionStep(
      node({
        id: 'wf:brainstorm-218',
        kind: 'session',
        sessionType: 'brainstorm',
        brief: 'Question two',
      }),
      ctx,
    );

    const firstRecord = requireRecord(first);
    const secondRecord = requireRecord(second);
    expect(firstRecord.id).toBe('SESSION-271');
    expect(secondRecord.id).not.toBe('SESSION-271');
    expect(firstRecord.id).not.toBe(secondRecord.id);
  });

  it('two colliding session steps racing concurrently in the same project still each get a distinct id and a real, un-overwritten record', async () => {
    // Same real, verified collision pair as above, but launched together via Promise.all rather than
    // sequentially -- the one shape that actually exercises `enqueueForProject`'s own serialisation,
    // not merely `allocateSessionId`'s linear probe in isolation.
    const projectRoot = await createTempRepo('id-collision-concurrent');
    await withRealAgentRoster(projectRoot);
    const adapter = new FakePlatformAdapter();
    const ctx = createTestContext({ projectRoot, adapter });

    const [first, second] = await Promise.all([
      runSessionStep(
        node({
          id: 'wf:brainstorm-100',
          kind: 'session',
          sessionType: 'brainstorm',
          brief: 'Question one',
        }),
        ctx,
      ),
      runSessionStep(
        node({
          id: 'wf:brainstorm-218',
          kind: 'session',
          sessionType: 'brainstorm',
          brief: 'Question two',
        }),
        ctx,
      ),
    ]);

    const firstRecord = requireRecord(first);
    const secondRecord = requireRecord(second);
    expect(firstRecord.id).not.toBe(secondRecord.id);
    // Neither persisted file was silently overwritten by the other -- each still carries its own,
    // distinct question.
    const firstText = await readTextFile(
      new ProjectPaths(projectRoot).resolveWithin(`docs/forge/sessions/${firstRecord.id}.md`),
    );
    const secondText = await readTextFile(
      new ProjectPaths(projectRoot).resolveWithin(`docs/forge/sessions/${secondRecord.id}.md`),
    );
    expect(firstText).toContain(firstRecord.question);
    expect(secondText).toContain(secondRecord.question);
  });
});

describe('runSessionStep — persisted record escapes hostile-shaped decision text', () => {
  it('a decision containing a literal pipe and an embedded newline does not corrupt the persisted Markdown table', async () => {
    const projectRoot = await createTempRepo('escape-table-cells');
    await withRealAgentRoster(projectRoot);
    const adapter = new FakePlatformAdapter();
    // Ordinary, real agent prose: a multi-line answer containing a literal "|" -- not hostile input,
    // the everyday shape of LLM output everywhere else in this codebase.
    adapter.script((req) => req.stepId.includes(':decide'), {
      text: ['Ship the A | B rollout.\nRevisit after the next release.'],
    });
    const ctx = createTestContext({ projectRoot, adapter });
    const stepNode = node({
      id: 'wf:brainstorm-escape',
      kind: 'session',
      sessionType: 'brainstorm',
      brief: 'Which rollout strategy do we ship',
    });

    const result = await runSessionStep(stepNode, ctx);
    const record = requireRecord(result);

    const text = await readTextFile(
      new ProjectPaths(projectRoot).resolveWithin(`docs/forge/sessions/${record.id}.md`),
    );
    const decisionsSection = text.slice(
      text.indexOf('## Decisions'),
      text.indexOf('## Non-decisions'),
    );
    const decisionRows = decisionsSection
      .split('\n')
      .filter((line) => line.trim().startsWith('| D-'));
    // Exactly one real table row for the one real decision -- an unescaped embedded newline would
    // have split it into two, corrupting the table.
    expect(decisionRows).toHaveLength(1);
    // The literal pipe survived as a real, escaped pipe, not a spurious extra table column.
    expect(decisionRows[0]).toContain('A \\| B');
    expect((decisionRows[0]?.match(/\|/g) ?? []).length).toBe(6); // 5 real column delimiters + 1 escaped pipe
  });
});

describe('runSessionStep — discovery-interview is a real, dispatch-eligible session type', () => {
  it('dispatches a real agent turn for discovery-interview, rather than being a structural no-op', async () => {
    const projectRoot = await createTempRepo('discovery-interview');
    const adapter = new FakePlatformAdapter();
    const { wrapped, stepIds } = recordingAdapter(adapter);
    const ctx = createTestContext({ projectRoot, adapter: wrapped });
    const stepNode = node({
      id: 'wf:discovery-interview',
      kind: 'session',
      sessionType: 'discovery-interview',
      brief: 'What does the user actually need from onboarding',
    });

    const result = await runSessionStep(stepNode, ctx);

    expect(result.outcome.status).toBe('succeeded');
    expect(stepIds.some((id) => id.includes('analyst'))).toBe(true);
  });
});

describe('runSessionStep — critic muted in DIVERGE, unmuted in CONVERGE', () => {
  it('critic is genuinely absent from DIVERGE’s own dispatch calls and genuinely present in CONVERGE’s', async () => {
    const projectRoot = await createTempRepo('critic-mute');
    const adapter = new FakePlatformAdapter();
    const { wrapped, stepIds } = recordingAdapter(adapter);
    const ctx = createTestContext({ projectRoot, adapter: wrapped });
    // `tradeoff`'s own participants are [architect, critic] -- the smallest real session type this
    // module's own SESSION_TYPE_DEFAULTS gives critic a seat in both DIVERGE-eligibility (excluded)
    // and CONVERGE-eligibility (included).
    const stepNode = node({
      id: 'wf:tradeoff-cache',
      kind: 'session',
      sessionType: 'tradeoff',
      brief: 'Do we cache at the edge or the origin',
    });

    const result = await runSessionStep(stepNode, ctx);

    expect(result.outcome.status).toBe('succeeded');
    const divergeCalls = stepIds.filter((id) => id.includes(':diverge:'));
    const convergeCalls = stepIds.filter((id) => id.includes(':converge:'));

    expect(divergeCalls.some((id) => id.includes('architect'))).toBe(true);
    expect(divergeCalls.some((id) => id.includes('critic'))).toBe(false);
    expect(convergeCalls.some((id) => id.includes('critic'))).toBe(true);

    // The DIVERGE/CONVERGE reconciliation lanes are cleaned up immediately, not leaked for the rest
    // of the run -- neither phase's own synthetic id is still tracked once the step returns.
    expect([...ctx.laneRegistry.keys()].some((id) => id.includes(':diverge'))).toBe(false);
    expect([...ctx.laneRegistry.keys()].some((id) => id.includes(':converge'))).toBe(false);
  });

  it('merges the DECIDE-phase decider’s own lane into integration rather than leaking it', async () => {
    const projectRoot = await createTempRepo('decide-lane-merged');
    await withRealAgentRoster(projectRoot);
    const adapter = new FakePlatformAdapter();
    const ctx = createTestContext({ projectRoot, adapter });
    const stepNode = node({
      id: 'wf:brainstorm-lane-merge',
      kind: 'session',
      sessionType: 'brainstorm',
      brief: 'How do we shorten setup time',
    });

    const result = await runSessionStep(stepNode, ctx);

    expect(result.outcome.status).toBe('succeeded');
    // Merged (or, for FakePlatformAdapter's own no-file-change default script, cleanly reconciled with
    // nothing to merge) rather than left registered forever -- the real, checkable proof this is a
    // real merge-queue pass, not merely a lane this module forgot to track.
    expect([...ctx.laneRegistry.keys()].some((id) => id.includes(':decide'))).toBe(false);
    // The lane's own worktree directory is gone too, not merely deregistered.
    const worktrees = await execa('git', ['worktree', 'list', '--porcelain'], { cwd: projectRoot });
    expect(worktrees.stdout).not.toContain(':decide');
  });

  it('a genuine merge conflict on the decider’s own lane is reported as a real step failure, not fabricated success', async () => {
    // A stubbed mergeQueue reproduces `@forge/vcs`'s own real "abort-policy conflict" outcome
    // directly, rather than needing to engineer precise git-timing to force a real rebase conflict --
    // the exact shape `mergeDecideLane` must not silently swallow.
    const projectRoot = await createTempRepo('decide-lane-conflict');
    await withRealAgentRoster(projectRoot);
    const adapter = new FakePlatformAdapter();
    const ctx = createTestContext({
      projectRoot,
      adapter,
      mergeQueue: {
        process: () =>
          Promise.resolve({ kind: 'conflict-unresolved', reason: 'abort-policy' } as const),
      },
    });
    const stepNode = node({
      id: 'wf:brainstorm-lane-conflict',
      kind: 'session',
      sessionType: 'brainstorm',
      brief: 'How do we shorten setup time',
    });

    const result = await runSessionStep(stepNode, ctx);

    // Not fabricated success: the decider's own content never actually reached integration.
    expect(result.outcome.status).toBe('failed');
    expect(result.outcome.failure?.source).toBe('merge');
    // The lane is retained (not silently discarded) for the next run's own orphan-reclaim.
    expect([...ctx.laneRegistry.keys()].some((id) => id.includes(':decide'))).toBe(true);
  });
});

describe('runSessionStep — domain refusals are reported as data, never thrown', () => {
  it('a FRAME question that cannot be stated in one sentence produces a failed StepOutcome, not a thrown error', async () => {
    const projectRoot = await createTempRepo('frame-refused');
    const adapter = new FakePlatformAdapter();
    const ctx = createTestContext({ projectRoot, adapter });
    const stepNode = node({
      id: 'wf:brainstorm-bad-question',
      kind: 'session',
      sessionType: 'brainstorm',
      // Two sentences -- `isStatableInOneSentence` (@forge/sessions) refuses this outright.
      brief: 'How do we cut onboarding time. Also, what about pricing?',
    });

    const result = await runSessionStep(stepNode, ctx);

    expect(result.outcome.status).toBe('failed');
    expect(result.outcome.failure?.code).toBe('RUN-061');
    expect(result.record).toBeUndefined();
  });

  it('a CONVERGE-phase critic dispatch that genuinely fails leaves the structural objection gate unsatisfied, producing a failed StepOutcome, not a thrown error', async () => {
    const projectRoot = await createTempRepo('converge-refused');
    const adapter = new FakePlatformAdapter();
    // tradeoff's own participants are [architect, critic] -- failing critic's own CONVERGE dispatch
    // means no real objection is ever recorded for it.
    // `wf:tradeoff-objection-flaky` deliberately avoids the substring "critic" in its own id --
    // an earlier draft of this test used an id containing it, which made the matcher below also
    // match the *reconciliation* session's own stepId (`<id>:converge`, no ":panel:" segment), a
    // real, easy-to-hit false match this comment records so it is not reintroduced.
    adapter.injectFailure((req) => req.stepId.includes(':converge:panel:critic'), 'error');
    const ctx = createTestContext({ projectRoot, adapter });
    const stepNode = node({
      id: 'wf:tradeoff-objection-flaky',
      kind: 'session',
      sessionType: 'tradeoff',
      brief: 'Do we cache at the edge or the origin',
    });

    const result = await runSessionStep(stepNode, ctx);

    expect(result.outcome.status).toBe('failed');
    expect(result.outcome.failure?.code).toBe('RUN-062');
    expect(result.record).toBeUndefined();
  });
});

describe('runSessionStep — RUN-039 scoping', () => {
  it('throws RUN-068, not RUN-039, for an unrecognized sessionType -- a real, actionable remedy naming the real ten-value table, not "delete the step"', async () => {
    const projectRoot = await createTempRepo('unrecognized-type');
    const ctx = createTestContext({ projectRoot });
    const stepNode = node({
      id: 'wf:mystery',
      kind: 'session',
      sessionType: 'not-a-real-session-type',
    });

    let caught: unknown;
    try {
      await runSessionStep(stepNode, ctx);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ForgeError);
    if (caught instanceof ForgeError) expect(caught.code).toBe('RUN-068');
  });

  it('RUN-039 stays reachable, unchanged, for elicit and subworkflow -- this piece’s own scope is exactly session', async () => {
    const projectRoot = await createTempRepo('elicit-subworkflow-untouched');
    const ctx = createTestContext({ projectRoot });

    for (const kind of ['elicit', 'subworkflow'] as const) {
      const stepNode = node({ id: `wf:${kind}`, kind });
      let caught: unknown;
      try {
        await executeStep(stepNode, ctx);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ForgeError);
      if (caught instanceof ForgeError) expect(caught.code).toBe('RUN-039');
    }
  });
});

/** A real, on-disk `modules/fm-core/techniques/steel-man-debate.technique.yaml` -- byte-for-byte the
 * same real, shipped content this repo's own `modules/fm-core/techniques/steel-man-debate.technique.
 * yaml` carries, so this test exercises the identical real technique `loadSteelManTechnique`
 * (`session.ts`) would load from a real project, not a synthetic stand-in with different content. */
const STEEL_MAN_TECHNIQUE_YAML = `
id: steel-man-debate
name: Steel-man debate
bestFor: Contested decisions
phases: [converge]
prompt: >
  For each of the two (or more) contested options, first state the strongest possible case for every
  *other* option -- as convincingly as that option's own proponent would state it -- before stating
  the case for your own preferred option. A case for an option that has not first steel-manned every
  alternative is not admissible input to CONVERGE.
`;

async function withSteelManTechnique(projectRoot: string): Promise<void> {
  const target = new ProjectPaths(projectRoot).resolveWithin(
    'modules/fm-core/techniques/steel-man-debate.technique.yaml',
  );
  await writeFileAtomic(target, STEEL_MAN_TECHNIQUE_YAML);
}

/** Wraps a real `FakePlatformAdapter`, recording every real `SessionRequest.prompt` this run actually
 * sent, keyed by `stepId` -- the one real, inspectable signal proving *what content* a dispatch call
 * actually carried (`16` §16.7 point 1's "independently" and point 3's "opposing case first" can only
 * be checked against real prompt text, not merely against which stepIds ran). */
function promptRecordingAdapter(adapter: FakePlatformAdapter): {
  readonly wrapped: PlatformAdapter;
  readonly prompts: Record<string, string>;
} {
  const prompts: Record<string, string> = {};
  const wrapped: PlatformAdapter = {
    id: adapter.id,
    displayName: adapter.displayName,
    capabilities: () => adapter.capabilities(),
    preflight: () => adapter.preflight(),
    listModels: () => adapter.listModels(),
    startSession: (req: SessionRequest) => {
      prompts[req.stepId] = req.prompt;
      return adapter.startSession(req);
    },
    resumeSession: (sessionId, req) => adapter.resumeSession(sessionId, req),
  };
  return { wrapped, prompts };
}

describe('runSessionStep — anti-groupthink measures (16 §16.7)', () => {
  it("measure 1 (panel independence): DIVERGE dispatches each participant its own prompt, containing no other participant's own answer -- real independence, not merely instructed to stay quiet", async () => {
    const projectRoot = await createTempRepo('anti-groupthink-independence');
    await withRealAgentRoster(projectRoot);
    const fake = new FakePlatformAdapter();
    fake.script((request) => request.stepId.endsWith(':panel:pm'), {
      text: ['pm: simplify the signup form'],
    });
    fake.script((request) => request.stepId.endsWith(':panel:analyst'), {
      text: ['analyst: cut the manual approval step'],
    });
    const { wrapped, prompts } = promptRecordingAdapter(fake);
    const ctx = createTestContext({ projectRoot, adapter: wrapped });
    const stepNode = node({
      id: 'wf:brainstorm-independence',
      kind: 'session',
      sessionType: 'brainstorm',
      brief: 'How do we cut time-to-first-invoice',
    });

    await runSessionStep(stepNode, ctx);

    const pmPrompt = Object.entries(prompts).find(([id]) => id.endsWith(':panel:pm'))?.[1] ?? '';
    const analystPrompt =
      Object.entries(prompts).find(([id]) => id.endsWith(':panel:analyst'))?.[1] ?? '';
    expect(pmPrompt).not.toBe('');
    expect(analystPrompt).not.toBe('');
    // Neither participant's own DIVERGE prompt contains the *other's* real answer -- each was
    // genuinely dispatched before either answer existed, not sequenced or shown the other's output.
    expect(pmPrompt).not.toContain('cut the manual approval step');
    expect(analystPrompt).not.toContain('simplify the signup form');
  });

  it('measure 5a: DIVERGE never dispatches a session "as" the human -- no stepId for the human role is ever requested', async () => {
    const projectRoot = await createTempRepo('anti-groupthink-no-human-diverge');
    await withRealAgentRoster(projectRoot);
    const { wrapped, stepIds } = recordingAdapter(new FakePlatformAdapter());
    const ctx = createTestContext({ projectRoot, adapter: wrapped });
    const stepNode = node({
      id: 'wf:brainstorm-no-human-diverge',
      kind: 'session',
      sessionType: 'brainstorm',
      brief: 'How do we cut time-to-first-invoice',
    });

    await runSessionStep(stepNode, ctx);

    expect(stepIds.some((id) => id.includes('panel:human'))).toBe(false);
    expect(stepIds.some((id) => id.endsWith(':human'))).toBe(false);
  });

  it('measure 2: a generic "this seems fine"-shaped critic CONVERGE turn is rejected and re-prompted once, and the re-prompted, real objection is what gets recorded', async () => {
    const projectRoot = await createTempRepo('anti-groupthink-critic-reprompt');
    await withRealAgentRoster(projectRoot);
    const fake = new FakePlatformAdapter();
    fake.script((request) => request.stepId.endsWith(':panel:critic'), {
      text: ['This seems fine.'],
    });
    fake.script((request) => request.stepId.endsWith(':critic-reprompt'), {
      text: ['The proposed rollout has no rollback plan for the payments migration -- real risk.'],
    });
    const { wrapped, stepIds } = recordingAdapter(fake);
    const ctx = createTestContext({ projectRoot, adapter: wrapped });
    const stepNode = node({
      id: 'wf:design-review-reprompt',
      kind: 'session',
      sessionType: 'design-review',
      brief: 'Should we ship the new payments migration path',
    });

    const result = await runSessionStep(stepNode, ctx);

    // A real, targeted re-ask actually ran -- not merely implied.
    expect(stepIds.some((id) => id.endsWith(':critic-reprompt'))).toBe(true);
    const target = new ProjectPaths(projectRoot).resolveWithin(
      `docs/forge/sessions/${requireRecord(result).id}.md`,
    );
    const text = await readTextFile(target);
    // The generic non-objection never becomes this session's own recorded critic contribution.
    expect(text).not.toContain('This seems fine.');
    // The real, falsifiable objection from the re-prompt is what actually got recorded.
    expect(text).toContain('no rollback plan for the payments migration');
  });

  it('measure 2 (accepted after one retry): a critic that is still generic on the second attempt is accepted anyway -- exactly one re-prompt, never a retry loop', async () => {
    const projectRoot = await createTempRepo('anti-groupthink-critic-reprompt-still-generic');
    await withRealAgentRoster(projectRoot);
    const fake = new FakePlatformAdapter();
    fake.script((request) => request.stepId.endsWith(':panel:critic'), {
      text: ['LGTM'],
    });
    fake.script((request) => request.stepId.endsWith(':critic-reprompt'), {
      text: ['No objections.'],
    });
    const { wrapped, stepIds } = recordingAdapter(fake);
    const ctx = createTestContext({ projectRoot, adapter: wrapped });
    const stepNode = node({
      id: 'wf:design-review-reprompt-still-generic',
      kind: 'session',
      sessionType: 'design-review',
      brief: 'Should we ship the new payments migration path',
    });

    const result = await runSessionStep(stepNode, ctx);

    expect(result.outcome.status).toBe('succeeded');
    // Exactly one re-prompt was issued -- never a second one, even though the retry was itself generic.
    const reprompts = stepIds.filter((id) => id.endsWith(':critic-reprompt'));
    expect(reprompts).toHaveLength(1);
  });

  it('measure 3: a tradeoff session runs CONVERGE as a real debate dispatch seeded with the real steel-man-debate technique, requiring the opposing case first in round 1', async () => {
    const projectRoot = await createTempRepo('anti-groupthink-steelman');
    await withRealAgentRoster(projectRoot);
    await withSteelManTechnique(projectRoot);
    const fake = new FakePlatformAdapter();
    fake.script((request) => request.stepId.includes(':converge:debate:proposer:round-1'), {
      text: ['Steel-manning the alternative first, then my own case for option A.'],
    });
    fake.script((request) => request.stepId.includes(':converge:debate:critic:round-1'), {
      text: ['CONCEDE'],
    });
    const { wrapped, prompts } = promptRecordingAdapter(fake);
    const ctx = createTestContext({ projectRoot, adapter: wrapped });
    const stepNode = node({
      id: 'wf:tradeoff-steelman',
      kind: 'session',
      sessionType: 'tradeoff',
      brief: 'Should we use a shared database or per-tenant databases',
    });

    const result = await runSessionStep(stepNode, ctx);

    expect(result.outcome.status).toBe('succeeded');
    const proposerPrompt =
      Object.entries(prompts).find(([id]) =>
        id.includes(':converge:debate:proposer:round-1'),
      )?.[1] ?? '';
    const criticPrompt =
      Object.entries(prompts).find(([id]) => id.includes(':converge:debate:critic:round-1'))?.[1] ??
      '';
    expect(proposerPrompt).not.toBe('');
    // The real technique's own prompt text was embedded, not a generic instruction invented here.
    expect(proposerPrompt).toContain('first state the strongest possible case for every');
    expect(proposerPrompt).toContain("opposing side's case");
    expect(criticPrompt).toContain('first state the strongest possible case for every');
  });

  it('measure 3 (fallback): a tradeoff session with no steel-man-debate technique installed still completes, via ordinary panel-mode CONVERGE', async () => {
    const projectRoot = await createTempRepo('anti-groupthink-steelman-fallback');
    await withRealAgentRoster(projectRoot);
    // Deliberately no `withSteelManTechnique` call -- no modules/fm-core/techniques/ at all.
    const { wrapped, stepIds } = recordingAdapter(new FakePlatformAdapter());
    const ctx = createTestContext({ projectRoot, adapter: wrapped });
    const stepNode = node({
      id: 'wf:tradeoff-no-technique',
      kind: 'session',
      sessionType: 'tradeoff',
      brief: 'Should we use a shared database or per-tenant databases',
    });

    const result = await runSessionStep(stepNode, ctx);

    expect(result.outcome.status).toBe('succeeded');
    expect(stepIds.some((id) => id.includes(':debate:'))).toBe(false);
    expect(stepIds.some((id) => id.includes(':panel:'))).toBe(true);
  });

  it('measure 3 (fallback, unregistered proposer): the technique is installed but the resolved proposer role has no real registered agent -- CONVERGE still degrades to panel mode, never a facilitator-authored debate mislabelled as the role', async () => {
    const projectRoot = await createTempRepo('anti-groupthink-steelman-unregistered');
    // Deliberately no `withRealAgentRoster` call -- `architect` is a bare role name, not a real,
    // registered agent, even though the technique itself is installed.
    await withSteelManTechnique(projectRoot);
    const { wrapped, stepIds } = recordingAdapter(new FakePlatformAdapter());
    const ctx = createTestContext({ projectRoot, adapter: wrapped });
    const stepNode = node({
      id: 'wf:tradeoff-unregistered-proposer',
      kind: 'session',
      sessionType: 'tradeoff',
      brief: 'Should we use a shared database or per-tenant databases',
    });

    const result = await runSessionStep(stepNode, ctx);

    expect(result.outcome.status).toBe('succeeded');
    expect(stepIds.some((id) => id.includes(':debate:'))).toBe(false);
    expect(stepIds.some((id) => id.includes(':panel:'))).toBe(true);
  });

  it('measure 3 (regression): a debate concession ("CONCEDE") is never recorded as real disagreement -- no_disagreement_observed stays true', async () => {
    const projectRoot = await createTempRepo('anti-groupthink-steelman-concede-flag');
    await withRealAgentRoster(projectRoot);
    await withSteelManTechnique(projectRoot);
    const fake = new FakePlatformAdapter();
    fake.script((request) => request.stepId.includes(':converge:debate:proposer:round-1'), {
      text: ['Steel-manning the alternative first, then my own case for option A.'],
    });
    fake.script((request) => request.stepId.includes(':converge:debate:critic:round-1'), {
      text: ['CONCEDE'],
    });
    // A bare "CONCEDE" is itself a generic non-objection (`isGenericNonObjection`), so this triggers
    // measure 2's own one-shot re-prompt -- scripted here to concede again, proving the *final*,
    // still-generic text (not a stray default-adapter response) is what the flag is computed from.
    fake.script((request) => request.stepId.endsWith(':critic-reprompt'), {
      text: ['I have nothing further.'],
    });
    const ctx = createTestContext({ projectRoot, adapter: fake });
    const stepNode = node({
      id: 'wf:tradeoff-concede-flag',
      kind: 'session',
      sessionType: 'tradeoff',
      brief: 'Should we use a shared database or per-tenant databases',
    });

    const result = await runSessionStep(stepNode, ctx);

    expect(result.outcome.status).toBe('succeeded');
    expect(requireRecord(result).no_disagreement_observed).toBe(true);
  });

  it("measure 3 (regression): a multi-round debate records the proposer's own final round only -- no duplicate cluster entries across rounds", async () => {
    const projectRoot = await createTempRepo('anti-groupthink-steelman-no-duplicate-clusters');
    await withRealAgentRoster(projectRoot);
    await withSteelManTechnique(projectRoot);
    const fake = new FakePlatformAdapter();
    fake.script((request) => request.stepId.includes(':converge:debate:proposer:round-1'), {
      text: ['Round 1 proposal for the shared database.'],
    });
    fake.script((request) => request.stepId.includes(':converge:debate:critic:round-1'), {
      text: ['Not convinced yet -- what about tenant isolation?'],
    });
    fake.script((request) => request.stepId.includes(':converge:debate:proposer:round-2'), {
      text: ['Round 2 refined proposal for the shared database.'],
    });
    fake.script((request) => request.stepId.includes(':converge:debate:critic:round-2'), {
      text: ['CONCEDE'],
    });
    const ctx = createTestContext({ projectRoot, adapter: fake });
    const stepNode = node({
      id: 'wf:tradeoff-no-duplicate-clusters',
      kind: 'session',
      sessionType: 'tradeoff',
      brief: 'Should we use a shared database or per-tenant databases',
    });

    const result = await runSessionStep(stepNode, ctx);

    expect(result.outcome.status).toBe('succeeded');
    const target = new ProjectPaths(projectRoot).resolveWithin(
      `docs/forge/sessions/${requireRecord(result).id}.md`,
    );
    const text = await readTextFile(target);
    const architectClusterLines = text
      .split('\n')
      .filter((line) => line.startsWith('- architect:'));
    expect(architectClusterLines).toHaveLength(1);
  });

  it('measure 2 (regression): a critic re-prompt that itself genuinely fails is not fabricated into an accepted objection -- the session honestly refuses CONVERGE (RUN-062)', async () => {
    const projectRoot = await createTempRepo('anti-groupthink-critic-reprompt-fails');
    await withRealAgentRoster(projectRoot);
    const fake = new FakePlatformAdapter();
    fake.script((request) => request.stepId.endsWith(':panel:critic'), {
      text: ['This seems fine.'],
    });
    fake.injectFailure((request) => request.stepId.endsWith(':critic-reprompt'), 'error');
    const ctx = createTestContext({ projectRoot, adapter: fake });
    const stepNode = node({
      id: 'wf:design-review-reprompt-fails',
      kind: 'session',
      sessionType: 'design-review',
      brief: 'Should we ship the new payments migration path',
    });

    const result = await runSessionStep(stepNode, ctx);

    expect(result.outcome.status).toBe('failed');
    expect(result.outcome.failure?.code).toBe('RUN-062');
    expect(result.record).toBeUndefined();
  });

  it('measure 4: a scripted all-agreement panel (no critic present, no participant disagrees) flags no_disagreement_observed; one real disagreement clears it', async () => {
    const projectRoot = await createTempRepo('anti-groupthink-no-disagreement');
    await withRealAgentRoster(projectRoot);
    const agreementAdapter = new FakePlatformAdapter();
    agreementAdapter.script(() => true, {
      text: ['Sounds good, fully on board with this direction.'],
    });
    const ctx = createTestContext({ projectRoot, adapter: agreementAdapter });
    const stepNode = node({
      id: 'wf:brainstorm-all-agree',
      kind: 'session',
      sessionType: 'brainstorm',
      brief: 'How do we cut time-to-first-invoice',
    });

    const agreementResult = await runSessionStep(stepNode, ctx);
    expect(requireRecord(agreementResult).no_disagreement_observed).toBe(true);

    const disagreeProjectRoot = await createTempRepo('anti-groupthink-real-disagreement');
    await withRealAgentRoster(disagreeProjectRoot);
    const disagreeAdapter = new FakePlatformAdapter();
    disagreeAdapter.script((request) => request.stepId.endsWith(':panel:pm'), {
      text: ['I disagree with the proposed scope -- it drops the invoicing edge cases entirely.'],
    });
    disagreeAdapter.script(() => true, { text: ['Sounds good.'] });
    const disagreeCtx = createTestContext({
      projectRoot: disagreeProjectRoot,
      adapter: disagreeAdapter,
    });
    const disagreeNode = node({
      id: 'wf:brainstorm-real-disagreement',
      kind: 'session',
      sessionType: 'brainstorm',
      brief: 'How do we cut time-to-first-invoice',
    });

    const disagreeResult = await runSessionStep(disagreeNode, disagreeCtx);
    expect(requireRecord(disagreeResult).no_disagreement_observed).toBe(false);
  });

  it('measure 5b: a human decision, when supplied, wins outright over the resolved agent owner -- no DECIDE-phase agent dispatch runs at all', async () => {
    const projectRoot = await createTempRepo('anti-groupthink-human-outranks');
    await withRealAgentRoster(projectRoot);
    const { wrapped, stepIds } = recordingAdapter(new FakePlatformAdapter());
    const ctx = createTestContext({ projectRoot, adapter: wrapped });
    const stepNode = node({
      id: 'wf:brainstorm-human-outranks',
      kind: 'session',
      sessionType: 'brainstorm',
      brief: 'Should we ship the quick-invoice path',
    });

    const result = await runSessionStep(stepNode, ctx, {
      decision: 'Ship the manual path for now, revisit automation next quarter.',
      owner: 'pm',
    });

    expect(result.outcome.status).toBe('succeeded');
    // `architect` is the only role this test's own roster resolves as a real decisions_owned owner
    // (see `withRealAgentRoster`) -- if the human override did not outrank it, a real `:decide`
    // dispatch to `architect` would have run.
    expect(stepIds.some((id) => id.includes(':decide'))).toBe(false);
    const record = requireRecord(result);
    expect(record.status).toBe('complete');

    const target = new ProjectPaths(projectRoot).resolveWithin(
      `docs/forge/sessions/${record.id}.md`,
    );
    const text = await readTextFile(target);
    expect(text).toContain('Ship the manual path for now, revisit automation next quarter.');
  });
});
