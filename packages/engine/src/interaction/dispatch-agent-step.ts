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

/** `10` §10.1's own perspective-review finding schema is not this milestone's to invent (no artifact
 * schema for a single review finding exists in `@forge/schemas` yet) — a perspective session reports
 * its findings as `SessionResult.structured`, a `readonly string[]` of one-line summaries, the same
 * "structured output when the caller actually needs it" mechanism `07` §7.2's own `outputSchema`/
 * `structured` pair already provides generically; a session with no `structured` output (or a
 * malformed one) is read as having reported zero findings rather than thrown away as a hard failure —
 * one participant's own malformed output should not abort the other three perspectives' real findings. */
function findingsFromSession(session: SessionResult): readonly string[] {
  if (!Array.isArray(session.structured)) return [];
  return session.structured.filter((item): item is string => typeof item === 'string');
}

/** `05` §5.7's own "one real, de-duplicated ReviewReport merging every perspective": two perspectives
 * reporting byte-identical finding text collapse into one `ReviewFinding` with both attributions. */
function mergeReviewReport(
  perspectives: readonly string[],
  perParspectiveFindings: ReadonlyMap<string, readonly string[]>,
): ReviewReport {
  const findingsBySummary = new Map<string, string[]>();
  for (const perspective of perspectives) {
    for (const summary of perParspectiveFindings.get(perspective) ?? []) {
      const attributions = findingsBySummary.get(summary) ?? [];
      attributions.push(perspective);
      findingsBySummary.set(summary, attributions);
    }
  }
  const findings: ReviewFinding[] = [...findingsBySummary.entries()].map(([summary, attributions]) => ({
    summary,
    perspectives: attributions,
  }));
  return { perspectives, findings };
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
  // Captured before the perspective-review loop runs, not after: a fresh critic round caught an
  // earlier draft that captured both `startedAt`/`finishedAt` back-to-back once every real session
  // had already completed, so the reported outcome always claimed near-zero duration regardless of
  // how long the N real perspective sessions actually took.
  const startedAt = ctx.now();
  const participants: InteractionParticipant[] = [];
  const findingsByPerspective = new Map<string, readonly string[]>();
  // `perspectives.length === 0` already threw above, so this loop runs at least once and `firstSession`
  // is always assigned by the time it is read below.
  let firstSession: SessionResult | undefined;
  for (const perspective of perspectives) {
    const session = await runParticipantSession(
      node,
      ctx,
      `review:${perspective}`,
      `${roleFraming(agent)}\n\n${node.brief ?? ''}\n\nReview the change from the "${perspective}" perspective. Report findings as a JSON array of one-line summary strings.`,
      { type: 'array', items: { type: 'string' } },
    );
    participants.push({ role: `review:${perspective}`, session });
    findingsByPerspective.set(perspective, findingsFromSession(session));
    firstSession ??= session;
  }
  const reviewReport = mergeReviewReport(perspectives, findingsByPerspective);

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
