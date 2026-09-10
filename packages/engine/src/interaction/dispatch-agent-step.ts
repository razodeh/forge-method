/**
 * `dispatchAgentStep` — `05` §5.7's own seven interaction modes made runnable, resolving `PLAN-M6.md`'s
 * own top-level open design question concretely (see `types.ts`'s own doc comment and
 * `SPEC-QUESTIONS.md` Q104): `solo`/`fan-out`/`relay` delegate straight to `@forge/engine/dispatch`'s
 * already-built `runAgentStep` unchanged; `pair`/`panel`/`debate`/`swarm-review` drive additional
 * sessions directly against `ctx.adapter`, the small additive extension the plan's own preamble
 * anticipated rather than a second dispatch mechanism duplicating `runLaneLifecycle`.
 *
 * @see specs/05 §5.7
 * @see specs/10 §10.1
 * @see SPEC-QUESTIONS.md Q104
 * @see PLAN-M6.md A6
 */
import { ForgeError } from '@forge/core/errors';
import type { SessionRequest, SessionResult } from '@forge/adapter-kit';
import type { AgentDefinition } from '@forge/agents/schema';
import type { InteractionMode } from '@forge/agents/interaction';

import { runAgentStep } from '../dispatch/steps.ts';
import type { ExecuteStepContext } from '../dispatch/types.ts';
import type { StepNode } from '../plan/index.ts';
import type {
  DispatchAgentStepOptions,
  InteractionOutcome,
  InteractionParticipant,
  ReviewFinding,
  ReviewReport,
  ReviewSeverity,
} from './types.ts';

/**
 * One read-only, non-committing session for a participant role that is not the step's own primary
 * author (a reviewer, a panelist, a debate proposer/critic turn, a swarm-review perspective) — none of
 * these write files or produce a lane of their own in this piece's own scope (`SPEC-QUESTIONS.md` Q104
 * records this as a real, honest limitation, not an oversight: a genuinely *interactive*, per-diff
 * continuous-reviewer loop — `05` §5.7's own literal description of `pair` — needs real-time
 * human-in-the-loop-shaped infrastructure this milestone does not build). `cwd` is `ctx.projectRoot`
 * (never a lane path): these sessions read whatever the primary author's own lane already committed,
 * they do not get a worktree of their own.
 */
async function runParticipantSession(
  node: StepNode,
  ctx: ExecuteStepContext,
  role: string,
  prompt: string,
  outputSchema?: SessionRequest['outputSchema'],
): Promise<SessionResult> {
  const abortController = new AbortController();
  const request: SessionRequest = {
    runId: ctx.runId,
    stepId: `${node.id}:${role}`,
    cwd: ctx.projectRoot,
    systemPrompt: { mode: 'append', text: '' },
    prompt,
    model: ctx.model,
    tools: { ...ctx.tools, write: false },
    permissionMode: 'deny-unlisted',
    limits: {
      maxTurns: node.limits.maxTurns,
      wallClockMs: node.limits.wallClockMs,
      maxCostUsd: node.limits.maxCostUsd,
    },
    env: {},
    ...(outputSchema === undefined ? {} : { outputSchema }),
    abortSignal: abortController.signal,
  };
  await ctx.telemetry.emit({
    type: 'SessionStarted',
    stepId: node.id,
    agentId: node.agent,
    payload: { role },
  });
  const handle = await ctx.adapter.startSession(request);
  const session = await handle.result();
  await ctx.telemetry.emit({
    type: 'SessionEnded',
    stepId: node.id,
    agentId: node.agent,
    payload: { role, ok: session.ok },
  });
  return session;
}

/** `13` §13.3's own review-perspective schema is not this milestone's to invent as an `@forge/schemas`
 * artifact (no artifact schema for a single review finding exists) — a perspective session reports its
 * output as `SessionResult.structured`, matching `SWARM_REVIEW_OUTPUT_SCHEMA` below: `findings`, each
 * `{ summary, severity }` (F-REVIEW-1's own "each perspective... produces findings at blocking/major/
 * minor"), and `checked` (F-REVIEW-2's own "the review report must state what it checked" — what this
 * perspective actually examined, real evidence an empty `findings` list meant "looked and found
 * nothing," not "never looked"). A session with no `structured` output (or a malformed one — a missing
 * `severity`, a `severity` outside the real three-value enum, a non-string `summary`) degrades that one
 * *entry* to being silently skipped, not the whole session thrown away: one participant's own partially
 * malformed output should not discard its own other, well-formed findings, matching the identical
 * per-item tolerance `findingsFromSession`'s own predecessor already established for a whole
 * malformed array. */
const REVIEW_SEVERITIES: ReadonlySet<string> = new Set(['blocking', 'major', 'minor']);

/** Case-insensitive on purpose — a fresh critic round reproduced directly that a session reporting the
 * exact right severity with different casing (`"Blocking"`, a real, plausible shape for structured
 * output an LLM produces even against a lowercase-only enum schema) was silently *dropped entirely*
 * under a strict, case-sensitive match — losing a real, possibly-blocking finding outright is a worse
 * failure than the "under-reporting severity is the one failure mode that matters" policy
 * `ReviewFinding`'s own doc comment already names; normalising case first keeps a real finding real
 * without ever needing to guess at an unrecognised value. */
function normalizeSeverity(value: unknown): ReviewSeverity | undefined {
  if (typeof value !== 'string') return undefined;
  const lower = value.toLowerCase();
  return REVIEW_SEVERITIES.has(lower) ? (lower as ReviewSeverity) : undefined;
}

interface PerspectiveReviewOutput {
  readonly findings: readonly { readonly summary: string; readonly severity: ReviewSeverity }[];
  readonly checked: readonly string[];
}

function reviewOutputFromSession(session: SessionResult): PerspectiveReviewOutput {
  const structured = session.structured;
  if (typeof structured !== 'object' || structured === null) return { findings: [], checked: [] };
  const raw = structured as Readonly<Record<string, unknown>>;
  const rawFindings = Array.isArray(raw['findings']) ? raw['findings'] : [];
  const findings = rawFindings.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const candidate = entry as Readonly<Record<string, unknown>>;
    const summary = candidate['summary'];
    const severity = normalizeSeverity(candidate['severity']);
    if (typeof summary !== 'string' || severity === undefined) return [];
    return [{ summary, severity }];
  });
  const rawChecked = Array.isArray(raw['checked']) ? raw['checked'] : [];
  const checked = rawChecked.filter((item): item is string => typeof item === 'string');
  return { findings, checked };
}

/** `blocking` > `major` > `minor` — the one real ranking `ReviewFinding`'s own doc comment already
 * establishes the policy for (merge on the *more* severe rating, never the less severe one). */
const SEVERITY_RANK: Readonly<Record<ReviewSeverity, number>> = { blocking: 3, major: 2, minor: 1 };

function moreSevere(a: ReviewSeverity, b: ReviewSeverity): ReviewSeverity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

/** F-REVIEW-2's own "'Looks good' with no findings and no evidence of having examined the failure
 * paths is itself a finding" — a perspective whose own `findings` *and* `checked` are both empty gets
 * one real, synthetic `minor` finding naming it, so an empty review is visibly empty in the merged
 * report rather than silently indistinguishable from "reviewed thoroughly, found nothing." A
 * perspective with real findings, or with zero findings but a real, non-empty `checked` list (it
 * genuinely looked and found nothing), is not flagged — `13` §13.3's own literal "no findings *and* no
 * evidence," not either alone. */
function emptyReviewFinding(perspective: string): ReviewFinding {
  return {
    summary: `${perspective} reported no findings and no evidence of what it examined`,
    severity: 'minor',
    perspectives: [perspective],
  };
}

/** One perspective's own real output, paired with the perspective name that produced it — a plain,
 * always-populated array, not a `ReadonlyMap` a lookup could come back `undefined` from: `dispatchSwarm
 * Review`'s own one real caller builds this in the identical loop that ran each session, so every
 * entry genuinely exists by construction. A `Map` lookup here would need a defensive `?? []` fallback
 * for a case that cannot actually happen given that construction — the same "real, but unprovable to
 * the type checker without restructuring" class this session already resolved elsewhere by removing
 * the possibility structurally rather than disclosing it as dead. */
interface PerspectiveOutputEntry {
  readonly perspective: string;
  readonly output: PerspectiveReviewOutput;
}

/** `05` §5.7's own "one real, de-duplicated ReviewReport merging every perspective": two perspectives
 * reporting byte-identical finding text collapse into one `ReviewFinding` with both attributions, kept
 * at whichever perspective's own rating was *more* severe (`moreSevere`'s own doc comment has the
 * fuller policy reasoning). A synthetic empty-review finding (`emptyReviewFinding`) is folded through
 * this identical merge step too, not appended separately after it — a fresh critic round reproduced
 * directly that appending it separately let it stand as its own, undeduplicated `ReviewFinding` even
 * when a *different* perspective's own real finding happened to share its exact summary text, two
 * entries for one real summary, violating this function's own "de-duplicated" contract. */
function mergeReviewReport(entries: readonly PerspectiveOutputEntry[]): ReviewReport {
  const bySummary = new Map<string, { severity: ReviewSeverity; perspectives: string[] }>();
  const record = (perspective: string, summary: string, severity: ReviewSeverity): void => {
    const existing = bySummary.get(summary);
    if (existing === undefined) {
      bySummary.set(summary, { severity, perspectives: [perspective] });
    } else {
      existing.perspectives.push(perspective);
      existing.severity = moreSevere(existing.severity, severity);
    }
  };
  for (const { perspective, output } of entries) {
    for (const finding of output.findings) {
      record(perspective, finding.summary, finding.severity);
    }
    if (output.findings.length === 0 && output.checked.length === 0) {
      const empty = emptyReviewFinding(perspective);
      record(perspective, empty.summary, empty.severity);
    }
  }
  const findings: ReviewFinding[] = [...bySummary.entries()].map(
    ([summary, { severity, perspectives: attributions }]) => ({
      summary,
      severity,
      perspectives: attributions,
    }),
  );
  return { perspectives: entries.map((entry) => entry.perspective), findings };
}

/** Every participant session's own prompt opens with the dispatching agent's real identity (`05` §5.3's
 * own `mandate`/`persona.voice`) — the one real, load-bearing use `dispatchAgentStep`'s own `agent`
 * parameter has in this piece: a panelist/critic/reviewer session answering *as* an unnamed, mandate-
 * less voice would be a real content gap, not merely an unused parameter. */
function roleFraming(agent: AgentDefinition): string {
  return `You are acting as ${agent.name} (${agent.persona.voice}). Mandate: ${agent.mandate}`;
}

async function dispatchPair(
  node: StepNode,
  agent: AgentDefinition,
  ctx: ExecuteStepContext,
): Promise<InteractionOutcome> {
  const outcome = await runAgentStep(node, ctx);
  const reviewerSession = await runParticipantSession(
    node,
    ctx,
    'reviewer',
    `${roleFraming(agent)}\n\nReview the change just made for step "${node.id}" (brief: ${node.brief ?? ''}). Report concerns, if any.`,
  );
  return { outcome, participants: [{ role: 'reviewer', session: reviewerSession }] };
}

async function dispatchPanel(
  node: StepNode,
  agent: AgentDefinition,
  ctx: ExecuteStepContext,
  options: DispatchAgentStepOptions,
): Promise<InteractionOutcome> {
  const perspectives = options.perspectives ?? [];
  if (perspectives.length === 0) {
    throw new ForgeError('RUN-046', { stepId: node.id, mode: 'panel' });
  }
  const participants: InteractionParticipant[] = [];
  for (const perspective of perspectives) {
    const session = await runParticipantSession(
      node,
      ctx,
      `panel:${perspective}`,
      `${roleFraming(agent)}\n\n${node.brief ?? ''}\n\nAnswer independently from the "${perspective}" perspective.`,
    );
    participants.push({ role: `panel:${perspective}`, session });
  }
  const synthesis = participants
    .map((participant) => `[${participant.role}] ${participant.session.finalText}`)
    .join('\n\n');
  const synthesisNode: StepNode = {
    ...node,
    brief: `${node.brief ?? ''}\n\nReconcile the following independent panel answers into one decision:\n\n${synthesis}`,
  };
  const outcome = await runAgentStep(synthesisNode, ctx);
  return { outcome, participants };
}

/**
 * A fresh critic round flagged a real, honest gap this doc comment now records explicitly (matching
 * the identical treatment `dispatchPair`'s own doc comment already gives its own scope limitation,
 * rather than leaving this one silently under-documented): the decider's own brief *instructs* it to
 * "rule on the outcome and record an ADR," and the decider's session runs through the real, committing
 * `runAgentStep` (so it genuinely can write a real ADR file, unlike every read-only participant session
 * above it) — but nothing in this function verifies an ADR was actually produced. `05` §5.7's own table
 * names this as part of what `debate` does; this implementation delivers the instruction and the real
 * write capability, not an enforced check that the instruction was followed. A later piece with a real
 * per-agent output-contract check (matching an `AgentDefinition.outputs` entry of `type: 'ADR'` against
 * `SessionResult.changedFiles`) could close this gap without changing this function's own Surface.
 */
async function dispatchDebate(
  node: StepNode,
  agent: AgentDefinition,
  ctx: ExecuteStepContext,
  options: DispatchAgentStepOptions,
): Promise<InteractionOutcome> {
  // `05` §5.7's own table gives 3 as a hard ceiling, not a mere default a caller may raise past —
  // `Math.min` clamps rather than trusting a caller-supplied `maxDebateRounds` outright.
  const maxRounds = Math.min(options.maxDebateRounds ?? 3, 3);
  const participants: InteractionParticipant[] = [];
  let priorCriticFeedback = '';
  let conceded = false;
  for (let round = 1; round <= maxRounds && !conceded; round += 1) {
    const proposerSession = await runParticipantSession(
      node,
      ctx,
      `debate:proposer:round-${String(round)}`,
      `${roleFraming(agent)}\n\n${node.brief ?? ''}\n\nRound ${String(round)}. Prior critic feedback: ${priorCriticFeedback || '(none yet)'}`,
    );
    participants.push({ role: `proposer:round-${String(round)}`, session: proposerSession });

    const criticSession = await runParticipantSession(
      node,
      ctx,
      `debate:critic:round-${String(round)}`,
      `Critique this proposal (round ${String(round)}): ${proposerSession.finalText}\n\nReply "CONCEDE" if you have no further objection.`,
    );
    participants.push({ role: `critic:round-${String(round)}`, session: criticSession });
    priorCriticFeedback = criticSession.finalText;
    conceded = criticSession.finalText.trim().toUpperCase().startsWith('CONCEDE');
  }

  const deciderBrief = `${node.brief ?? ''}\n\nA debate ran for ${String(
    participants.length / 2,
  )} round(s) (${conceded ? 'the critic conceded' : 'the round cap was reached with no concession'}). Rule on the outcome and record an ADR.\n\nTranscript:\n${participants
    .map((participant) => `[${participant.role}] ${participant.session.finalText}`)
    .join('\n\n')}`;
  const deciderNode: StepNode = { ...node, brief: deciderBrief };
  const outcome = await runAgentStep(deciderNode, ctx);
  return { outcome, participants };
}

/** `13` §13.3's own F-REVIEW-1 table, verbatim — each perspective's own real "Asks" column, embedded in
 * that perspective's own prompt below so a participant session answers the actual checklist question,
 * not a bare label. A perspective not in this table (an arbitrary caller-supplied one, `pair`/`panel`'s
 * own free-form use already allows) falls back to a plain, generic framing — a real, disclosed gap for
 * that case, not a crash: this table is F-REVIEW-1's own fixed eight, not every perspective name this
 * generic dispatch mechanism could ever be asked to run. */
const PERSPECTIVE_ASKS: Readonly<Record<string, string>> = {
  'spec-conformance':
    "Does this implement the story's ACs, and only them? Is anything out of claim?",
  design:
    'Does it fit the architecture and the chosen patterns? Does it add a boundary violation? Is there a simpler shape?',
  correctness:
    'Edge cases, off-by-one, null/empty/unicode, concurrency, error paths, resource cleanup.',
  security:
    'Input validation, authz on every path, injection, secrets, dependency risk, output encoding.',
  performance:
    'N+1 queries, unbounded results, missing index, sync work on a hot path, allocation in loops.',
  testing: 'Oracle strength, AC binding, failure-path coverage, flake risk, test readability.',
  operability: 'Logs/metrics for the new path, failure modes, config, migration safety, rollback.',
  documentation: 'Public API documented, KB updated, diagram updated if structure changed.',
};

function perspectiveAsks(perspective: string): string {
  return (
    PERSPECTIVE_ASKS[perspective] ?? `Review the change from the "${perspective}" perspective.`
  );
}

/** `13` §13.3's own real output shape for one perspective session: `findings` (each `{ summary,
 * severity }`, F-REVIEW-1's own three-level scale) and `checked` (F-REVIEW-2's own "state what it
 * checked" — `reviewOutputFromSession`'s own doc comment has the fuller reasoning for both). */
const SWARM_REVIEW_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          severity: { type: 'string', enum: ['blocking', 'major', 'minor'] },
        },
        required: ['summary', 'severity'],
      },
    },
    checked: { type: 'array', items: { type: 'string' } },
  },
  required: ['findings', 'checked'],
} as const;

async function dispatchSwarmReview(
  node: StepNode,
  agent: AgentDefinition,
  ctx: ExecuteStepContext,
  options: DispatchAgentStepOptions,
): Promise<InteractionOutcome> {
  const perspectives = options.perspectives ?? [];
  if (perspectives.length === 0) {
    throw new ForgeError('RUN-046', { stepId: node.id, mode: 'swarm-review' });
  }
  // F-REVIEW-2's own "a reviewer may not approve a change it authored" — the *runtime* half of the
  // compile-time `CFG-501` invariant `@forge/extensions/invariants/separation.ts` already enforces
  // over static overlay configuration alone. Checked, and refused, *before* any real session is
  // dispatched — zero wasted sessions on a review that was always going to be refused. Only ever
  // checked when a caller actually supplied `authoringAgentIds` (`DispatchAgentStepOptions`'s own doc
  // comment has the fuller reasoning for why this dispatch layer cannot determine it unassisted).
  if (options.authoringAgentIds?.includes(agent.id) === true) {
    throw new ForgeError('CFG-501', { role: agent.id });
  }
  // Captured before the perspective-review loop runs, not after: a fresh critic round caught an
  // earlier draft that captured both `startedAt`/`finishedAt` back-to-back once every real session
  // had already completed, so the reported outcome always claimed near-zero duration regardless of
  // how long the N real perspective sessions actually took.
  const startedAt = ctx.now();
  const participants: InteractionParticipant[] = [];
  const outputEntries: PerspectiveOutputEntry[] = [];
  // `perspectives.length === 0` already threw above, so this loop runs at least once and `firstSession`
  // is always assigned by the time it is read below.
  let firstSession: SessionResult | undefined;
  for (const perspective of perspectives) {
    const session = await runParticipantSession(
      node,
      ctx,
      `review:${perspective}`,
      `${roleFraming(agent)}\n\n${node.brief ?? ''}\n\nReview the change from the "${perspective}" perspective. ${perspectiveAsks(perspective)} Report real findings, each with a severity of "blocking", "major", or "minor", plus what you actually checked — an empty findings list with nothing checked reads as "never looked," not "looked and found nothing."`,
      SWARM_REVIEW_OUTPUT_SCHEMA,
    );
    participants.push({ role: `review:${perspective}`, session });
    outputEntries.push({ perspective, output: reviewOutputFromSession(session) });
    firstSession ??= session;
  }
  const reviewReport = mergeReviewReport(outputEntries);

  if (firstSession === undefined) {
    // Unreachable given the guard above (kept as a real, typed fallback rather than a non-null
    // assertion — @typescript-eslint/no-non-null-assertion forbids `!` in this codebase).
    throw new ForgeError('RUN-046', { stepId: node.id, mode: 'swarm-review' });
  }

  // Swarm-review is review-only — nothing here writes files or commits a lane (`10` §10.1's own
  // "review from N angles," not "produce an artifact"), so there is no `runAgentStep` call to make;
  // `outcome` is a real, honestly-constructed `StepOutcome` built from the first perspective's own
  // session, the same "no lane, no VCS I/O, only what a review step actually did" scope
  // `runParticipantSession`'s own doc comment already establishes for every non-authoring participant.
  const finishedAt = ctx.now();
  const outcome = {
    stepId: node.id,
    status: 'succeeded' as const,
    startedAt,
    finishedAt,
    detail: { kind: 'agent' as const, session: firstSession },
  };
  return { outcome, participants, reviewReport };
}

export async function dispatchAgentStep(
  node: StepNode,
  agent: AgentDefinition,
  ctx: ExecuteStepContext,
  mode: InteractionMode,
  options: DispatchAgentStepOptions = {},
): Promise<InteractionOutcome> {
  switch (mode) {
    case 'solo':
    case 'fan-out':
    case 'relay':
      return { outcome: await runAgentStep(node, ctx) };
    case 'pair':
      return dispatchPair(node, agent, ctx);
    case 'panel':
      return dispatchPanel(node, agent, ctx, options);
    case 'debate':
      return dispatchDebate(node, agent, ctx, options);
    case 'swarm-review':
      return dispatchSwarmReview(node, agent, ctx, options);
  }
}
