/**
 * `runSessionStep` — fills the real `RUN-039` stub `execute.ts`'s own `case 'session':` throws for
 * `kind: 'session'` workflow steps (`16` §16.6's "sessions can also be workflow steps"), by driving
 * `@forge/sessions`'s pure `SessionPhaseMachine` phase by phase and feeding it real agent-turn output
 * from `dispatchAgentStep` (`./dispatch-agent-step.ts`) as its own caller-supplied input at each step.
 *
 * `@forge/sessions` holds pure facilitation logic only and has no edge back to `@forge/engine`
 * (`PLAN-M10.md`'s own header, mirroring `Q104`'s identical structural fact for `@forge/agents`) — this
 * module is the one side of that boundary that can reach both packages, matching the new, deliberate
 * `engine -> sessions` graph edge this piece adds (`tools/eslint-plugin-forge-boundaries/src/graph.mjs`).
 *
 * **Participant resolution** — `16` §16.2's own "Typical participants" column names roles, not concrete
 * agents, and `SessionStep`/`StepNode` (`@forge/engine/workflow`, `@forge/engine/plan`) carry no
 * `participants` field of their own (confirmed directly: `sessionStepSchema` validates `sessionType`
 * alone). `SESSION_TYPE_DEFAULTS` below is this piece's own, disclosed reading of that table into a
 * concrete facilitator + participant-role list per session type, capped to `16` §16.8's own "5 agents +
 * human" bound. Several of its ten rows narrow a genuinely generic table entry to a concrete stand-in
 * (`tradeoff`'s "owners of competing concerns", `premortem`'s "whole relevant roster", `retro`'s "roles
 * that participated", `war-room`'s "owners", `estimation`'s "engineers", `standup`'s "active lanes"),
 * and `discovery-interview` swaps its own literal facilitator (`analyst`) for the generic `facilitator`
 * role so `analyst` can be a real, dispatch-eligible participant instead (see that row's own comment)
 * — a real, recorded reading, not a spec quote. See `SPEC-QUESTIONS.md`.
 *
 * **The facilitator never contributes content** (`16` §16.3's own facilitation invariant) — the
 * synthetic `AgentDefinition` built for it here exists only to frame `dispatchAgentStep`'s own per-
 * participant prompts (`roleFraming`, `dispatch-agent-step.ts`) with a neutral, structural voice; its
 * own `decisions_owned` is always empty, so it can never resolve as DECIDE's decision owner, and this
 * module never reads `dispatchPanel`'s own reconciliation `outcome` for DIVERGE/CONVERGE — only each
 * individual participant's own `InteractionParticipant.session` output feeds the phase machine.
 *
 * @see specs/16 §16.2
 * @see specs/16 §16.3
 * @see specs/16 §16.6
 * @see specs/05 §5.3
 * @see PLAN-M10.md P10
 */
import { ForgeError } from '@forge/core/errors';
import { pathExists, readTextFile, writeFileAtomic, ProjectPaths } from '@forge/core/fs';
import type { Clock } from '@forge/core';
import type { SessionResult } from '@forge/adapter-kit';
import { loadAgentRegistry, type AgentDefinition } from '@forge/agents';
import { KbWriter, type KbEntryInput } from '@forge/kb/write';
import { DEFAULT_KB_ROOT, type KbSection } from '@forge/kb/schema';
import {
  CRITIC_ROLE,
  SessionPhaseMachine,
  assembleSessionRecord,
  type ConvergeInput,
  type DecideInput,
  type DivergeInput,
  type SessionState,
  type SessionParticipant,
  type SessionType,
} from '@forge/sessions';
import type { SessionRecord } from '@forge/schemas';
import * as YAML from 'yaml';

import { dispatchAgentStep } from './dispatch-agent-step.ts';
import type { InteractionParticipant } from './types.ts';
import type { ExecuteStepContext, StepOutcome } from '../dispatch/types.ts';
import { toAgentId, type StepNode } from '../plan/index.ts';

const HUMAN_ROLE = 'human';

/** Every real, ten-row `16` §16.2 session type, read into a concrete `{facilitator, participants}`
 * pair -- see this file's own top-of-file doc comment for which rows are a verbatim table reading and
 * which are this piece's own disclosed narrowing of a generic table entry. `participants` never
 * includes `facilitator` or `human` -- both are added once, uniformly, by `buildParticipants` below. */
interface SessionTypeDefaults {
  readonly facilitator: string;
  readonly participants: readonly string[];
  /** `08` §8.2's own KB section a write-back for this session type lands under -- a real, disclosed
   * choice per type (`16` §16.5's own worked example writes back into `product/`), not a spec quote. */
  readonly kbSection: KbSection;
}

const SESSION_TYPE_DEFAULTS: Readonly<Record<SessionType, SessionTypeDefaults>> = {
  brainstorm: {
    facilitator: 'facilitator',
    participants: ['pm', 'analyst', 'architect', 'ux'],
    kbSection: 'product',
  },
  'design-review': {
    // `16` §16.2's own row names five: architect, security, sre, data-architect, critic. All five fit
    // `16` §16.8's own 5-agent cap because the facilitator itself is never counted (see
    // `buildParticipants`'s own doc comment) -- a fresh critic round found an earlier draft trimmed
    // `sre` here under the mistaken belief the facilitator counted too; it does not, so nothing needs
    // dropping.
    facilitator: 'facilitator',
    participants: ['architect', 'security', 'sre', 'data-architect', CRITIC_ROLE],
    kbSection: 'architecture',
  },
  tradeoff: {
    // "Owners of competing concerns + critic" has no fixed roster -- `architect` stands in for "an
    // owner of a competing concern" as the one role every non-trivial technical tradeoff involves.
    facilitator: 'facilitator',
    participants: ['architect', CRITIC_ROLE],
    kbSection: 'architecture',
  },
  premortem: {
    // "Whole relevant roster" trimmed to three representative roles, `critic` included so the
    // anti-groupthink CONVERGE gate (`16` §16.7 point 2) has a real participant to exercise.
    facilitator: 'facilitator',
    participants: ['pm', 'architect', CRITIC_ROLE],
    kbSection: 'delivery',
  },
  retro: {
    // `16` §16.2's own facilitator for `retro` is `em`, not `facilitator` -- "roles that participated"
    // stands in as two representative roles, distinct from the facilitator itself.
    facilitator: 'em',
    participants: ['pm', 'architect'],
    kbSection: 'engineering',
  },
  'war-room': {
    facilitator: 'em',
    participants: ['diagnostician', 'sre'],
    kbSection: 'ops',
  },
  estimation: {
    // "engineers" stands in as `po` (sizing owner) + `architect` (technical sequencing).
    facilitator: 'em',
    participants: ['po', 'architect'],
    kbSection: 'delivery',
  },
  standup: {
    // "Active lanes" has no fixed roster at authoring time -- `em` stands in as the one role that
    // always has a real stake in a long run's own state.
    facilitator: 'orchestrator',
    participants: ['em'],
    kbSection: 'delivery',
  },
  'discovery-interview': {
    // `16` §16.2's own row names `analyst` as *both* the facilitator and the one real
    // content-contributing participant ("analyst, human"). Naming it as this module's own
    // `facilitator` role verbatim would leave `participants` empty (`buildParticipants` never adds
    // the facilitator to the dispatch-eligible list -- see its own doc comment), so DIVERGE/CONVERGE
    // would never dispatch to anyone and DECIDE would always fall back to the human, making this one
    // session type a structural no-op regardless of project data -- a real, critic-found defect in an
    // earlier draft. Resolved by using the generic, structural `facilitator` role here (matching every
    // other row) and keeping `analyst` as a real, dispatch-eligible participant instead -- a disclosed
    // deviation from `16` §16.2's own literal "Facilitator: analyst" cell, not a spec quote.
    facilitator: 'facilitator',
    participants: ['analyst'],
    kbSection: 'domain',
  },
  'story-refinement': {
    facilitator: 'po',
    participants: ['architect', 'test-architect'],
    kbSection: 'delivery',
  },
};

/**
 * The facilitator is deliberately never added to `SessionState.participants` -- doing so would make
 * it a dispatch-eligible "perspective" in `frame()`/`endDiverge()`'s own directives (both derive their
 * participant list from `state.participants` alone, with no special case for "the facilitator"), which
 * would have DIVERGE/CONVERGE ask the facilitator to answer "from the facilitator perspective,"
 * directly violating `16` §16.3's own "the facilitator does not contribute content" invariant. A real,
 * disclosed narrowing from `16` §16.5's own worked example (which lists `facilitator` in
 * `SessionRecord.participants`): this module's own assembled record omits it too, since
 * `assembleSessionRecord` has no participant list independent of `state.participants`. See
 * `SPEC-QUESTIONS.md`. Excluding the facilitator also means it never counts against `16` §16.8's own
 * "5 agents + human" cap.
 */
function buildParticipants(sessionType: SessionType): {
  readonly facilitatorRole: string;
  readonly agentRoles: readonly string[];
  readonly participants: readonly SessionParticipant[];
} {
  const defaults = SESSION_TYPE_DEFAULTS[sessionType];
  const participants: SessionParticipant[] = [
    ...defaults.participants.map((role) => ({ role })),
    { role: HUMAN_ROLE },
  ];
  return { facilitatorRole: defaults.facilitator, agentRoles: defaults.participants, participants };
}

/** A synthetic, non-content-contributing `AgentDefinition` for the facilitator's own voice --
 * `decisions_owned: []` always, so it can never resolve as DECIDE's own owner (this file's own
 * top-of-file doc comment has the fuller reasoning). */
function facilitatorAgent(role: string, node: StepNode): AgentDefinition {
  return {
    id: role,
    name: role,
    version: '1.0.0',
    tier: 'core',
    mandate: '16 §16.3: holds session structure only, contributes no content of its own.',
    decisions_owned: [],
    persona: {
      voice: 'neutral, structural',
      stance: 'enforces the session anatomy; never proposes a solution',
      disagreement_style: 'names which facilitation invariant a proposal would violate',
    },
    inputs: { required: [] },
    outputs: [
      {
        type: 'SessionRecord',
        schema: 'session-record.schema.json',
        path: 'docs/forge/sessions/{id}.md',
      },
    ],
    kb_write: [],
    tools: { read: true, write: false, network: false, git_commit: 'none', deploy: false },
    model: { tier: 'balanced', thinking: 'medium' },
    limits: {
      max_turns: node.limits.maxTurns,
      wall_clock_ms: node.limits.wallClockMs,
      max_cost_usd: node.limits.maxCostUsd,
    },
    parallel_safety: { file_ownership: [], exclusive: false },
    gates: { produces_evidence_for: [], may_approve: [] },
    skills: [],
    prompt: { system: 'facilitator.system.md' },
  };
}

/** `sessionRecordSchema`'s own id pattern (via `checkIdMatchesRegisteredType`) requires exactly three
 * digits after `SESSION-`, never the arbitrary letters a real `StepNode.id` (`wf:step-name`) contains
 * -- a stable, deterministic three-digit checksum of `seed` satisfies that shape unconditionally, in
 * the absence of any real, allocated session-id sequence this milestone's own scope provides (that is
 * a later, interactive `forge session` CLI piece's job, not this workflow-step integration point's).
 * `seed` is `nodeId` plus a probe suffix (`allocateSessionId` below) so a collision on the first probe
 * has a genuinely different second candidate to try, not the identical hash again. */
function numericSessionId(seed: string): string {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) % 1000;
  return String(hash).padStart(3, '0');
}

/** The canonical `docs/forge/sessions/` directory `16` §16.5 names -- kept as a real, checked
 * directory (not a fixed guess) so `allocateSessionId`'s own existence probe and
 * `persistSessionRecord`'s own write agree on exactly the same path every time. */
const SESSIONS_DIR = 'docs/forge/sessions';

/**
 * One FIFO queue per project root, matching `@forge/kb/write`'s own `KbWriter` doc comment exactly
 * ("One FIFO queue per project... not a per-instance queue") and for the identical reason: a fresh
 * critic round found `allocateSessionId`'s own existence probe had no lock at all, so two session
 * steps racing inside the same run (independent lanes, no `dependsOn` edge between them) whose
 * `numericSessionId` candidates coincide could both pass the same probe before either wrote, then
 * silently overwrite each other's real, completed session record. `allocateSessionAndPersist` below
 * is the one place both the probe and the write happen, serialised through this queue -- a real,
 * in-process mutex, not merely a comment asking callers to be careful.
 */
const sessionRecordQueues = new Map<string, Promise<unknown>>();

function enqueueForProject<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const previous = sessionRecordQueues.get(root) ?? Promise.resolve();
  const result = previous.then(operation, operation);
  sessionRecordQueues.set(
    root,
    result.then(
      () => undefined,
      () => undefined,
    ),
  );
  return result;
}

/**
 * A real, three-digit `SESSION-###` id that no session record already on disk under
 * `docs/forge/sessions/` is using -- linear probing over `numericSessionId(nodeId#attempt)`, up to
 * every one of the 1000 real ids the schema's own three-digit width allows.
 *
 * A fresh critic round found an earlier draft used a bare, unprobed `numericSessionId(nodeId)`: with
 * only 1000 possible ids and no collision check at all, two different session-workflow steps could
 * silently claim the identical `SESSION-###` id the moment their hashes coincided -- a real, silent
 * data-loss risk (`persistSessionRecord`'s own write would then either collide with, or silently
 * overwrite, another session's real record). Probing against the real, already-written files closes
 * that for as long as this project's real session count stays under the schema's own 1000-id ceiling
 * -- the identical, disclosed ceiling `numericSessionId`'s own doc comment already names as this
 * milestone's real, honest limit pending a later piece's real session-id allocator.
 *
 * @throws {ForgeError} `RUN-069` if every one of the 1000 real three-digit ids is already taken --
 * exhausted, not silently reused; a later piece's real allocator is the actual fix, not a wider guess
 * here. Its own code, not `RUN-039` (a fresh critic round found reusing `RUN-039` here left this
 * failure with `RUN-039`'s own registered remedy, "remove elicit/session/subworkflow steps," actively
 * wrong for an id-exhaustion condition).
 */
async function allocateSessionId(ctx: ExecuteStepContext, nodeId: string): Promise<string> {
  const paths = new ProjectPaths(ctx.projectRoot);
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const candidate = `SESSION-${numericSessionId(`${nodeId}#${String(attempt)}`)}`;
    const target = paths.resolveWithin(`${SESSIONS_DIR}/${candidate}.md`);
    // A bounded, sequential probe against real disk state -- each candidate depends on the previous
    // one having already been rejected, so this cannot be parallelised away.
    if (!(await pathExists(target))) return candidate;
  }
  throw new ForgeError('RUN-069', { stepId: nodeId });
}

/** A Markdown table cell can hold neither a literal `|` (closes the cell early) nor a raw newline
 * (ends the row): both are the ordinary shape of real agent prose (`decideSession.finalText`, a
 * multi-sentence or multi-paragraph decision), not a hostile input -- a fresh critic round found an
 * earlier draft interpolated decision/action/non-decision text into `renderSessionBody`'s own table
 * rows completely unescaped, so any real multi-line or pipe-containing decision silently corrupted
 * the persisted `SESSION-###.md`'s own table structure. Escaped the same way GitHub-Flavored Markdown
 * itself recommends for a table cell: `\|` for a literal pipe, a plain space for a line break (a
 * decision's exact internal line breaks are not load-bearing information a session record needs to
 * preserve character-for-character). */
function escapeTableCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/** `16` §16.5's own canonical `## Frame`/`## Diverge`/`## Converge`/`## Decisions`/`## Non-decisions`/
 * `## Actions` body sections, rendered from the real `SessionState` this run actually produced -- the
 * literal transcript-plus-decisions content `16.1`'s own "a session that produces only a transcript
 * has failed" describes, not merely the front matter `SessionRecord` alone carries. */
function renderSessionBody(state: SessionState): string {
  const framing = state.framing;
  const frameSection = framing
    ? [
        framing.question,
        '',
        `Constraints applied: ${framing.constraintsApplied.join(', ') || '(none)'}`,
        `Out of scope: ${framing.outOfScope.join(', ') || '(none)'}`,
        `Good outcome: ${framing.goodOutcomeLooksLike}`,
      ].join('\n')
    : '(not framed)';

  const divergeSection =
    state.ideas.map((idea) => `- [${idea.proposedBy}] ${escapeTableCell(idea.text)}`).join('\n') ||
    '(no ideas)';

  const clusterLines = state.clusters.map((cluster) => {
    const ids = cluster.ideaIds.join(', ') || '(no ideas)';
    const eliminated =
      cluster.eliminatedReason === undefined
        ? ''
        : ` -- eliminated: ${escapeTableCell(cluster.eliminatedReason)}`;
    return `- ${cluster.label}: ${ids}${eliminated}`;
  });
  const objectionLines = state.objections.map(
    (objection) => `- objection (${objection.by}): ${escapeTableCell(objection.text)}`,
  );
  const convergeSection =
    [...clusterLines, ...objectionLines].join('\n') || '(no clusters or objections)';

  const decisionsSection =
    state.decisions
      .map(
        (decision) =>
          `| ${decision.id} | ${escapeTableCell(decision.decision)} | ${escapeTableCell(decision.owner)} | ${escapeTableCell(decision.artifactRef ?? '')} |`,
      )
      .join('\n') || '(none)';
  const nonDecisionsSection =
    state.nonDecisions
      .map(
        (nonDecision) =>
          `| ${escapeTableCell(nonDecision.question)} | ${escapeTableCell(nonDecision.reason)} | ${escapeTableCell(nonDecision.revisitTrigger)} |`,
      )
      .join('\n') || '(none)';
  const actionsSection =
    state.actions
      .map(
        (action) =>
          `| ${action.id} | ${escapeTableCell(action.action)} | ${escapeTableCell(action.owner ?? '')} | ${escapeTableCell(action.artifactRef ?? '')} |`,
      )
      .join('\n') || '(none)';

  return [
    '## Frame',
    frameSection,
    '',
    '## Diverge',
    divergeSection,
    '',
    '## Converge',
    convergeSection,
    '',
    '## Decisions',
    decisionsSection,
    '',
    '## Non-decisions',
    nonDecisionsSection,
    '',
    '## Actions',
    actionsSection,
    '',
  ].join('\n');
}

/**
 * Writes the real `docs/forge/sessions/SESSION-###.md` artifact `16` §16.5 names as canonical --
 * front matter (the already schema-validated `record`) plus the real transcript-and-decisions body
 * (`renderSessionBody`). A fresh critic round found an earlier draft returned `record` from
 * `runSessionStep` without ever persisting it anywhere reachable from a compiled-workflow run
 * (`execute.ts`'s own `case 'session':` keeps only `.outcome`, per the "wrap, do not touch the closed
 * `StepOutcomeDetail` union" choice this module's own top-of-file doc comment already makes) -- so the
 * one artifact `16.1`'s own "a session that produces only a transcript has failed" describes was
 * silently unreachable outside a caller that happened to call `runSessionStep` directly. Persisting it
 * here, as a real side effect independent of what `runSessionStep`'s own return value gets used for,
 * closes that the same way `writeDecisionBack`'s own KB write already is one.
 */
async function persistSessionRecord(
  ctx: ExecuteStepContext,
  record: SessionRecord,
  state: SessionState,
): Promise<void> {
  const target = new ProjectPaths(ctx.projectRoot).resolveWithin(`${SESSIONS_DIR}/${record.id}.md`);
  const text = `---\n${YAML.stringify(record)}---\n\n${renderSessionBody(state)}`;
  await writeFileAtomic(target, text);
}

function toClock(ctx: ExecuteStepContext): Clock {
  return { now: () => new Date(ctx.now()).toISOString() };
}

/**
 * A per-phase copy of `node`, with its own suffixed `id`/`idempotencyKey` and the facilitator's own
 * synthetic id as its `agent`. Required for two real reasons, not cosmetic: (1) `dispatchAgentStep`'s
 * own `panel` mode (`dispatchPanel`, `dispatch-agent-step.ts`) unconditionally reconciles independent
 * panel answers through a real, committing `runAgentStep(synthesisNode, ctx)` call, which throws
 * `RUN-039` outright if `node.agent` is `undefined` -- true for every `kind: 'session'` node, since no
 * `sessionStepSchema` field ever authors one; (2) that same reconciliation call creates a real lane
 * keyed by `node.id` alone (`@forge/vcs`'s own `laneIdFor`/`laneBranchName`) -- driving DIVERGE and
 * CONVERGE through the *same* `node.id` would have the second call's own `git worktree add` collide
 * with the first call's still-registered branch/worktree. Distinct suffixes give each phase's own
 * dispatch an independent lane, exactly as if it were a distinct step.
 */
function phaseNode(node: StepNode, suffix: string, agentId: string): StepNode {
  const id = `${node.id}:${suffix}`;
  return { ...node, id, idempotencyKey: id, agent: toAgentId(agentId) };
}

/**
 * Removes the real lane `dispatchPanel`'s own reconciliation `runAgentStep` call left behind for a
 * DIVERGE/CONVERGE `phaseNode` -- this module reads only `.participants` from that dispatch, never its
 * `.outcome`, so the reconciliation lane's own content is never going anywhere (no later `merge`-kind
 * step ever names `wf:step:diverge`/`wf:step:converge` as a `dependsOn` predecessor, the one other
 * mechanism that would otherwise reclaim it, `ExecuteStepContext.laneRegistry`'s own doc comment).
 *
 * A fresh critic round found an earlier draft left both lanes registered and un-removed for the rest
 * of the run's own lifetime -- every `kind: 'session'` step permanently leaking two real git
 * worktrees+branches, unbounded for a long-running workflow that dispatches many session steps (`16`
 * §16.6's own "standup... triggered by elapsed time," repeatedly, over one long run). Removed here,
 * immediately after the one thing this module actually needed from the dispatch (`.participants`) is
 * already in hand -- the identical "ready lane -> processed -> removed" lifecycle `runMergeStep`
 * already gives every ordinary predecessor lane, just triggered from this module instead of a `merge`
 * step. Never throws: `ctx.laneRegistry.get(phaseNodeId)` coming back `undefined` covers two real,
 * distinct cases this function treats identically, both non-fatal -- an empty `perspectives` list
 * (already guarded by this module's own callers, so no lane was ever created at all) *and* a lane that
 * genuinely was created but never reached `runLaneLifecycle`'s own unconditional-success registration
 * point (`dispatch/steps.ts`'s own `ctx.laneRegistry.set` runs only after `work.failure === undefined`
 * -- a lane/commit/claim failure inside the reconciliation dispatch itself leaves a real worktree on
 * disk with no registry entry at all, the identical "known lane, no registry entry" shape `runMergeStep`
 * already accepts for any predecessor lane that failed the same way, `merge.test.ts`'s own "succeeding
 * vacuously" case). Either way, whatever real worktree remains is discoverable by the next run's own
 * orphan-reclamation (`@forge/engine/resume`'s own `reclaimOrphanedWorktrees`), not a reason to fail a
 * session step that otherwise completed its real work.
 */
async function cleanupPhaseLane(ctx: ExecuteStepContext, phaseNodeId: string): Promise<void> {
  const lane = ctx.laneRegistry.get(phaseNodeId);
  if (lane === undefined) return;
  try {
    await ctx.vcs.removeLane(lane, ctx.retainLaneWorktrees);
    ctx.laneRegistry.delete(phaseNodeId);
    await ctx.telemetry.emit({ type: 'LaneRemoved', stepId: phaseNodeId, laneId: lane.laneId });
  } catch {
    // Disclosed in this function's own doc comment above: a real, non-fatal cleanup gap, not this
    // session step's own failure.
  }
}

/**
 * Merges the DECIDE-phase decider's own real lane into `ctx.integrationBase`, the same way a real,
 * dedicated `merge`-kind step (`06` §6.5, `runMergeStep`) would for any other agent step's own
 * predecessor lane -- reused directly here because a `kind: 'session'` step is monolithic (`10` §10.1
 * gives it no way to name a *separate*, later `merge` step over its own synthetic `${node.id}:decide`
 * lane id), so nothing else in a compiled workflow will ever pick this lane up. A fresh critic round
 * found an earlier draft left this exact lane (unlike the DIVERGE/CONVERGE reconciliation lanes,
 * already cleaned up by `cleanupPhaseLane`) registered and unmerged for the rest of the run's own
 * lifetime -- worse than the reconciliation-lane leak, since this lane holds the decider's own real,
 * meaningful commit (`05` §5.3's own "the decider... can genuinely write a real ADR file"), so simply
 * discarding it the way `cleanupPhaseLane` discards a reconciliation lane would silently lose real
 * work, not merely reclaim disk space.
 *
 * `conflictPolicy: 'abort'` deliberately, not `'agent'`/`'human'`: `@forge/vcs`'s own
 * `processMergeCandidate` refuses any non-`'abort'` policy outright when no `conflictResolver` is
 * configured, which is every real policy in this milestone's own scope (`SPEC-QUESTIONS.md` Q77) --
 * `'abort'` needs no resolver at all and merges cleanly whenever the decider's own lane genuinely does
 * not conflict with `ctx.integrationBase` (the overwhelmingly common case: a fresh lane branched from
 * the same base, touching files nothing else in this one step's own execution has touched), only
 * aborting (never removing the lane) on a real, rare conflict.
 *
 * Returns the real failure, never swallows one: a fresh critic round found an earlier draft checked
 * only `outcome.kind === 'clean' || 'conflict-resolved'` to decide whether to clean up, then simply
 * fell through for every other outcome with no signal at all reaching its own caller -- a real merge
 * conflict (or a thrown `VcsError`) left the decider's own committed content stranded in an unmerged
 * lane while `runSessionStep`'s own `StepOutcome` still reported `'succeeded'`, the identical
 * "fabricated success" failure class a prior round already fixed for the *dispatch*-failure case,
 * reopened here for the *merge*-failure case. The caller folds this into `decideFailure` exactly the
 * same way.
 */
async function mergeDecideLane(
  ctx: ExecuteStepContext,
  node: StepNode,
  laneId: string,
): Promise<StepOutcome['failure']> {
  const lane = ctx.laneRegistry.get(laneId);
  if (lane === undefined) return undefined;
  try {
    await ctx.telemetry.emit({ type: 'MergeQueued', stepId: node.id, laneId: lane.laneId });
    await ctx.telemetry.emit({ type: 'MergeStarted', stepId: node.id, laneId: lane.laneId });
    const outcome = await ctx.mergeQueue.process(
      {
        handle: lane,
        stepId: laneId,
        runId: ctx.runId,
        declaredClaim: [],
        conflictPolicy: 'abort',
      },
      {},
    );
    if (outcome.kind === 'clean' || outcome.kind === 'conflict-resolved') {
      await ctx.telemetry.emit({
        type: 'MergeCompleted',
        stepId: node.id,
        laneId: lane.laneId,
        payload: { mergeCommitSha: outcome.mergeCommitSha },
      });
      await ctx.vcs.removeLane(lane, ctx.retainLaneWorktrees);
      await ctx.telemetry.emit({ type: 'LaneRemoved', stepId: node.id, laneId: lane.laneId });
      ctx.laneRegistry.delete(laneId);
      return undefined;
    }
    // Every other outcome (a real conflict aborted, or a pre/post-check failure -- neither policy nor
    // checks this module configures) retains the lane rather than losing it -- discoverable by the
    // next run's own orphan-reclaim (`@forge/engine/resume`'s own `reclaimOrphanedWorktrees`), the
    // identical disclosed fallback `cleanupPhaseLane`'s own doc comment already names -- but the real
    // failure is still reported to the caller, not silently absorbed here.
    return {
      source: 'merge',
      message: `DECIDE-phase lane for step ${node.id} could not be merged into integration (${outcome.kind}).`,
    };
  } catch (cause) {
    return {
      source: 'merge',
      message: `DECIDE-phase lane for step ${node.id} failed to merge: ${cause instanceof Error ? cause.message : String(cause)}`,
      cause,
    };
  }
}

/** Loads the real, on-disk `modules/<module>/agents/<id>.agent.yaml` roster this project actually has --
 * `05` §5.3's own canonical path convention, the same one `loadAgentRegistry` (`@forge/agents`) reads.
 * A project with no `modules/` directory at all (every real dispatch test's own bare tmp-dir git
 * repository, `RUN-034` under the hood) is not a programmer error here: it genuinely has no agent
 * roster to resolve a decision owner from, and returns an empty registry rather than throwing --
 * DECIDE's own owner-resolution step (`resolveDecisionOwner` below) reads that absence as "no agent
 * owns this," which is exactly the real, honest case the human-input fallback exists for. */
async function loadProjectAgentRegistry(
  ctx: ExecuteStepContext,
): Promise<ReadonlyMap<string, AgentDefinition>> {
  try {
    const modulesDir = new ProjectPaths(ctx.projectRoot).resolveWithin('modules');
    const registry = await loadAgentRegistry(modulesDir);
    return new Map(registry.all().map((agent) => [agent.id, agent]));
  } catch {
    return new Map();
  }
}

/** `05` §5.3's own `decisions_owned` field, read literally: the first of this session's own real,
 * non-critic, non-facilitator agent roles that both (a) resolves to a real, registered
 * `AgentDefinition` and (b) actually owns at least one decision -- `16` §16.3 step 4's own "the
 * decision owner (the role whose mandate covers it, per `decisions_owned`) rules." `undefined` when no
 * participant role resolves this way, the real, honest "nobody here owns this" case DECIDE's own
 * human-input fallback exists for. */
function resolveDecisionOwner(
  agentRoles: readonly string[],
  facilitatorRole: string,
  registry: ReadonlyMap<string, AgentDefinition>,
): AgentDefinition | undefined {
  for (const role of agentRoles) {
    if (role === facilitatorRole || role === CRITIC_ROLE) continue;
    const agent = registry.get(role);
    if (agent !== undefined && agent.decisions_owned.length > 0) return agent;
  }
  return undefined;
}

/** `id: (\S+)` on the first matching line of a KB entry's own YAML front matter -- deliberately a
 * plain regex, not a full `kbEntrySchema.parse`, since the only thing `writeDecisionBack`'s own retry
 * path needs from an already-written file is the id it was given the first time, and this file was
 * written by that exact function in the first place (`${'---'}\n<yaml>${'---'}\n\n<body>`, `KbWriter`'s
 * own `doWrite`), never hand-edited before a retry could plausibly run. */
function extractKbEntryId(text: string): string | undefined {
  return /^id:\s*(\S+)/m.exec(text)?.[1];
}

/** `16` §16.5's own mandatory write-back, as one real `KbWriter.write` call (`08` §8.6) -- the
 * decision's own KB entry id becomes `SessionDecision.artifactRef`, satisfying `canComplete`'s own
 * gate honestly rather than fabricating a placeholder reference no KB entry backs.
 *
 * Idempotent by construction, not merely by accident: the target path is deterministic in `node.id`
 * alone, so a retried or resumed run of the identical session step would otherwise hit `KbWriter`'s
 * own `KB-009` ("already exists") on its second attempt -- a fresh critic round found an earlier draft
 * always called `writer.write` unconditionally and simply let that real, typed crash propagate,
 * turning an ordinary retry into a hard failure instead of converging on the entry the first attempt
 * already wrote. Checked and reused here instead, the same "same input, same real result, no crash"
 * property `06` §6.10's own resume model expects of every step this milestone drives.
 */
async function writeDecisionBack(
  ctx: ExecuteStepContext,
  section: KbSection,
  node: StepNode,
  ownerRole: string,
  decisionText: string,
  clock: Clock,
): Promise<string> {
  const relativePath = `${section}/session-${node.id.replace(/[^a-zA-Z0-9]+/g, '-')}.md`;
  const paths = new ProjectPaths(ctx.projectRoot);
  const target = paths.resolveWithin(`${DEFAULT_KB_ROOT}/${relativePath}`);
  if (await pathExists(target)) {
    const existingId = extractKbEntryId(await readTextFile(target));
    if (existingId !== undefined) return existingId;
    // The file exists but this module's own id line is unreadable (hand-edited or corrupted) -- falls
    // through to a real `KbWriter.write` below, which will itself refuse with `KB-009` rather than
    // silently overwriting whatever is actually there; a real, disclosed edge case, not a silent loss.
  }
  const writer = new KbWriter({ paths, clock });
  // `08` §8.3 names no fixed review cadence for a session write-back -- 30 days is this piece's own
  // reasonable default, not a spec quote.
  const reviewBy = new Date(new Date(clock.now()).getTime() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const input: KbEntryInput = {
    type: 'knowledge',
    section,
    title: `Session decision -- ${node.id}`,
    status: 'active',
    confidence: 'low',
    owner: ownerRole,
    sources: [{ kind: 'decision', ref: `session:${node.id}` }],
    review_by: reviewBy,
    supersedes: [],
    superseded_by: null,
    related: [],
    diagrams: [],
    tags: [],
    applies_to: [],
    body: `## Summary\n\n${decisionText}\n`,
    path: relativePath,
  };
  const entry = await writer.write(input);
  return entry.id;
}

/** The honest "no real agent session ran" placeholder for the human-input fallback path -- `ok: true`
 * because the *step* did not fail (it produced a real, honest inconclusive record); no agent session
 * ever actually ran, which `sessionId: ''` and every zeroed field make visible to an inspecting caller. */
const NO_AGENT_SESSION: SessionResult = {
  sessionId: '',
  ok: true,
  finalText: '',
  usage: { inputTokens: 0, outputTokens: 0, turns: 0 },
  durationMs: 0,
  changedFiles: [],
  controlTokens: [],
};

/** `record` is absent exactly when the session never reached RECORD at all -- a real, structural
 * refusal from `@forge/sessions`'s own phase machine (FRAME's own `isStatableInOneSentence`, `16` §16.3
 * step 1; CONVERGE's own critic-objection gate, `16` §16.7 point 2), never a programmer error. */
export interface SessionStepResult {
  readonly outcome: StepOutcome;
  readonly record?: SessionRecord | undefined;
}

/**
 * `@forge/sessions`'s own phase machine reports a domain refusal as data (`PhaseDirective`'s own
 * `'refused'`/`'converge-refused'` variants, never a thrown exception -- `machine.ts`'s own doc
 * comment), so this module must not turn that back into a thrown exception either. A fresh critic
 * round found an earlier draft did exactly that (`throw framed.directive.error` / `throw
 * advance.directive.error`), directly contradicting `dispatch/steps.ts`'s own documented contract that
 * "a genuine runtime failure... is always returned as a `StepOutcome{status:'failed'}`, never thrown" --
 * `execute.ts`'s own `executeStep` only ever catches a `TelemetryError`, so an ordinary authoring
 * mistake (a two-sentence `brief`) or an ordinary transient failure (one flaky `critic` dispatch
 * leaving CONVERGE's own structural gate unsatisfied) would otherwise crash the entire run, not just
 * this one step. `source: 'gate'` matches the machine's own description of both refusals as structural
 * gates (`RUN-061`'s own FRAME precondition, `RUN-062`'s own CONVERGE precondition), the closest fit in
 * `StepFailureInfo`'s own closed source vocabulary.
 */
function domainRefusalOutcome(
  nodeId: string,
  startedAt: number,
  finishedAt: number,
  error: ForgeError,
): SessionStepResult {
  return {
    outcome: {
      stepId: nodeId,
      status: 'failed',
      startedAt,
      finishedAt,
      detail: { kind: 'agent', session: NO_AGENT_SESSION },
      failure: { source: 'gate', code: error.code, message: error.message, cause: error },
    },
  };
}

/**
 * Drives one `kind: 'session'` `StepNode` end to end: FRAME (no dispatch) -> DIVERGE (`panel`-mode
 * dispatch excluding `critic`) -> CONVERGE (`panel`-mode dispatch including `critic`) -> DECIDE
 * (`solo`-mode dispatch to the `decisions_owned`-resolved owner, or a human-input request if none
 * resolves) -> RECORD (`assembleSessionRecord` plus a real KB write-back), feeding each phase's real
 * dispatch output back into `@forge/sessions`'s own `SessionPhaseMachine` as its next input.
 *
 * @throws {ForgeError} `RUN-039` if `node.sessionType` is absent -- structurally excluded by
 * `compilePlan` for a well-formed `kind: 'session'` node (`plan/compile.ts`'s own
 * `sessionType: step.kind === 'session' ? step.sessionType : undefined`), the same "kept as a real
 * runtime check, documented, over provably unreachable through this module's own real callers" choice
 * `runAgentStep`/`runCommandStep` (`dispatch/steps.ts`) already make for their own missing-field guards.
 */
export async function runSessionStep(
  node: StepNode,
  ctx: ExecuteStepContext,
): Promise<SessionStepResult> {
  const startedAt = ctx.now();
  if (node.sessionType === undefined) {
    throw new ForgeError('RUN-039', {
      stepId: node.id,
      kind: 'session (missing its own sessionType field)',
    });
  }
  // `sessionStepSchema` validates `sessionType` as merely `nonBlank()`, not against `16` §16.2's own
  // closed ten-type enum (`@forge/engine/workflow` has no edge to `@forge/schemas`' `SESSION_TYPES` at
  // authoring time -- confirmed directly, `sessionStepSchema` in `workflow/schema.ts`) -- an
  // unrecognised value would otherwise crash on the very next line's own object-index lookup with a
  // raw `TypeError`, not a real, actionable `ForgeError`. `RUN-068`, not `RUN-039`: a fresh critic
  // round found `RUN-039`'s own registered remedy ("remove elicit/session/subworkflow steps... until a
  // later milestone") actively wrong for an ordinary hand-typo'd `sessionType` -- it tells the author
  // to delete the step, not to fix the typo against the real ten-value table.
  // `Object.hasOwn`, not the `in` operator: a fresh critic round found `in` also matches inherited
  // `Object.prototype` members, so a hostile or fuzzed `sessionType` of `"toString"`/`"constructor"`/
  // `"hasOwnProperty"` would pass this guard, then crash `buildParticipants`'s own subsequent lookup
  // with an opaque `TypeError` instead of this function's own intended, actionable `RUN-068`.
  if (!Object.hasOwn(SESSION_TYPE_DEFAULTS, node.sessionType)) {
    throw new ForgeError('RUN-068', { stepId: node.id, sessionType: node.sessionType });
  }
  const sessionType = node.sessionType as SessionType;

  const clock = toClock(ctx);
  const machine = new SessionPhaseMachine({ clock });
  const { facilitatorRole, agentRoles, participants } = buildParticipants(sessionType);
  const facilitator = facilitatorAgent(facilitatorRole, node);

  let state = machine.start({ sessionType, participants });

  // FRAME -- no dispatch. `node.brief` is the one-sentence question `16` §16.3 step 1 asks for;
  // absent, an empty question is refused by `frame()` itself (`RUN-061`), the honest outcome for a
  // session step authored with no real question at all.
  const framed = machine.frame(state, {
    question: node.brief ?? '',
    goodOutcomeLooksLike: `A ${sessionType} session reaches real decisions or an honest non-decision.`,
  });
  state = framed.state;
  if (framed.directive.kind === 'refused') {
    return domainRefusalOutcome(node.id, startedAt, ctx.now(), framed.directive.error);
  }
  // `frame()`'s own implementation only ever returns `'refused'` (handled above) or
  // `'dispatch-diverge'` -- `PhaseResult.directive`'s own type is the full nine-variant
  // `PhaseDirective` union regardless of which method produced it, so this check is a real, typed
  // narrowing step for the compiler, not a reachable runtime branch.
  if (framed.directive.kind !== 'dispatch-diverge') {
    throw new ForgeError('RUN-063', {
      expected: 'dispatch-diverge',
      actual: framed.directive.kind,
    });
  }

  // DIVERGE -- `critic` is genuinely absent from this dispatch's own `perspectives`, not
  // dispatched-then-ignored (`frame()`'s own directive already filtered it out). `human` is filtered
  // here, by this module, not by `frame()` itself: the machine's own directive only ever promises to
  // exclude `critic` (`16` §16.3 step 2), and dispatching a real agent session "as" the human would be
  // exactly the groupthink-inducing mistake `16` §16.7 point 5 exists to prevent (the human's own
  // position is never dispatched at all -- it enters, if anywhere, only via `ctx`'s own real
  // elicitation channel, never through `dispatchAgentStep`).
  const divergePerspectives = framed.directive.participants.filter((role) => role !== HUMAN_ROLE);
  const divergeIdeas: DivergeInput['ideas'][number][] = [];
  if (divergePerspectives.length > 0) {
    const divergePhaseNode = phaseNode(node, 'diverge', facilitatorRole);
    const divergeOutcome = await dispatchAgentStep(divergePhaseNode, facilitator, ctx, 'panel', {
      perspectives: divergePerspectives,
    });
    for (const participant of divergeOutcome.participants ?? []) {
      // A crashed/timed-out participant session (`SessionResult.ok === false`) contributes nothing
      // real -- a fresh critic round found an earlier draft recorded its empty/garbage `finalText` as
      // a genuine idea anyway, indistinguishable from a real, thoughtful contribution once merged.
      if (!participant.session.ok) continue;
      divergeIdeas.push(ideaFrom(participant));
    }
    // The reconciliation lane `divergeOutcome.outcome` left behind is never used (this module reads
    // only `.participants`, per this file's own top-of-file doc comment) -- reclaimed immediately
    // rather than leaked for the rest of the run (`cleanupPhaseLane`'s own doc comment).
    await cleanupPhaseLane(ctx, divergePhaseNode.id);
  }
  const divergeResult = machine.diverge(state, { ideas: divergeIdeas });
  state = divergeResult.state;

  const endDiverge =
    divergeResult.directive.kind === 'diverge-capped'
      ? { state, directive: divergeResult.directive }
      : machine.endDiverge(state);
  state = endDiverge.state;

  // CONVERGE -- every agent participant, `critic` included this time (`16` §16.3 step 3's own "critic
  // is unmuted"). `human` is filtered here for the identical reason DIVERGE's own filter is -- see
  // that comment above; `16` §16.7 point 5's "enters at CONVERGE" describes the human's own real
  // position outranking agent output when a human supplies one, not a fabricated agent session
  // impersonating them.
  const convergePerspectives = (
    endDiverge.directive.kind === 'dispatch-converge'
      ? endDiverge.directive.participants
      : participants.map((p) => p.role)
  ).filter((role) => role !== HUMAN_ROLE);
  const objections: NonNullable<ConvergeInput['objections']>[number][] = [];
  const clusters: NonNullable<ConvergeInput['clusters']>[number][] = [];
  if (convergePerspectives.length > 0) {
    const convergePhaseNode = phaseNode(node, 'converge', facilitatorRole);
    const convergeOutcome = await dispatchAgentStep(convergePhaseNode, facilitator, ctx, 'panel', {
      perspectives: convergePerspectives,
    });
    for (const participant of convergeOutcome.participants ?? []) {
      // Identical reasoning to DIVERGE's own filter above -- a failed `critic` session must never
      // count as a real, structural objection (`16` §16.7 point 2's own gate, `advanceToDecide`
      // below), and a failed non-critic session must never seed a cluster from empty/garbage text.
      if (!participant.session.ok) continue;
      const role = roleFromParticipant(participant);
      if (role === CRITIC_ROLE) {
        objections.push({ by: role, text: participant.session.finalText });
      } else {
        clusters.push({
          label: role,
          ideaIds: divergeIdeas
            .map((idea, index) => ({ idea, index }))
            .filter(({ idea }) => idea.proposedBy === role)
            .map(({ index }) => `IDEA-${String(index + 1).padStart(3, '0')}`),
        });
      }
    }
    // Identical reasoning to DIVERGE's own cleanup above.
    await cleanupPhaseLane(ctx, convergePhaseNode.id);
  }
  const convergeResult = machine.converge(state, { clusters, objections });
  state = convergeResult.state;

  const advance = machine.advanceToDecide(state);
  state = advance.state;
  if (advance.directive.kind === 'converge-refused') {
    return domainRefusalOutcome(node.id, startedAt, ctx.now(), advance.directive.error);
  }

  // DECIDE -- solo dispatch to the resolved owner, or a real human-input request if none resolves.
  const registry = await loadProjectAgentRegistry(ctx);
  const owner = resolveDecisionOwner(agentRoles, facilitatorRole, registry);
  let decideSession: SessionResult = NO_AGENT_SESSION;
  let decideInput: DecideInput;
  // Set only when the DECIDE-phase dispatch itself genuinely failed (a crashed/timed-out adapter
  // session, or a lane/commit failure inside `runAgentStep`) -- distinct from the human-fallback path
  // above, which is not a failure at all, only an honest "nobody here owns this."
  let decideFailure: StepOutcome['failure'];
  if (owner === undefined) {
    await ctx.telemetry.emit({
      type: 'ElicitationRequested',
      stepId: node.id,
      payload: {
        reason:
          'DECIDE-phase owner unresolved: no participant agent both exists in the project ' +
          'roster and declares a decisions_owned entry.',
        question: state.framing?.question ?? node.brief ?? '',
      },
    });
    decideInput = {
      inconclusiveReason:
        'No agent participant resolved as a decisions_owned decision owner; a human decision was ' +
        'requested (see the ElicitationRequested event for this step) but the session could not ' +
        'wait for it synchronously.',
    };
  } else {
    const deciderNode: StepNode = {
      ...phaseNode(node, 'decide', owner.id),
      brief:
        `${node.brief ?? ''}\n\nYou are ${owner.name}, the resolved decision owner for this ` +
        `${sessionType} session (decisions_owned: ${owner.decisions_owned.join(', ')}). Rule on the ` +
        'framed question and state your decision in one clear paragraph.',
    };
    const decideOutcome = await dispatchAgentStep(deciderNode, owner, ctx, 'solo');
    decideSession =
      decideOutcome.outcome.detail.kind === 'agent'
        ? decideOutcome.outcome.detail.session
        : decideSession;
    // A fresh critic round found an earlier draft ignored `decideOutcome.outcome.status`/
    // `decideSession.ok` entirely, so a genuinely failed decide dispatch (a lane/commit failure, a
    // crashed adapter session) still wrote its own empty/garbage `finalText` to the KB as a real
    // decision and reported the whole step `succeeded` -- fabricating a successful outcome out of an
    // ordinary, undramatic failure. Treated the identical, honest way the human-fallback path above
    // is: an inconclusive record with a stated reason, not a decision no one actually made -- but with
    // the step's own `StepOutcome.status` still reflecting the real failure underneath, per this
    // module's own doc comment ("describe a failure as data").
    if (decideOutcome.outcome.status === 'failed' || !decideSession.ok) {
      decideFailure = decideOutcome.outcome.failure ?? {
        source: 'adapter',
        message: `DECIDE-phase dispatch to ${owner.id} did not succeed (ok: ${String(decideSession.ok)}).`,
      };
      decideInput = {
        inconclusiveReason:
          `DECIDE-phase dispatch to ${owner.id} failed (${decideFailure.message}); no real decision ` +
          'was made, and none was fabricated from the failed session output.',
      };
    } else {
      const artifactRef = await writeDecisionBack(
        ctx,
        SESSION_TYPE_DEFAULTS[sessionType].kbSection,
        node,
        owner.id,
        decideSession.finalText,
        clock,
      );
      decideInput = {
        decisions: [{ decision: decideSession.finalText, owner: owner.id, artifactRef }],
      };
    }
    // The decider's own real lane (unlike DIVERGE/CONVERGE's discarded reconciliation lanes) holds
    // real, meaningful work -- merged into `ctx.integrationBase`, never simply discarded, whether the
    // dispatch above succeeded or failed partway through (`mergeDecideLane`'s own doc comment). A real
    // merge failure here (a genuine conflict, a failed check) is folded into `decideFailure` the
    // identical way a dispatch failure already is -- `??=` so an already-recorded dispatch failure
    // stays the one reported reason, never silently overwritten by a second, later one.
    const mergeFailure = await mergeDecideLane(ctx, node, deciderNode.id);
    decideFailure ??= mergeFailure;
  }
  const decideResult = machine.decide(state, decideInput);
  state = decideResult.state;

  // RECORD -- `assembleSessionRecord` (`@forge/sessions`), the real, schema-validated artifact, then a
  // real, persisted `docs/forge/sessions/SESSION-###.md` file (`persistSessionRecord`'s own doc
  // comment has the fuller reasoning for why this is not merely the in-memory return value). Id
  // allocation and the write it gates both run inside one `enqueueForProject` call -- see that
  // function's own doc comment for why the two must be atomic with respect to any other session step
  // racing in the same run.
  const finishedAt = ctx.now();
  const endedIso = new Date(finishedAt).toISOString();
  const record = await enqueueForProject(ctx.projectRoot, async () => {
    const sessionId = await allocateSessionId(ctx, node.id);
    const assembled = assembleSessionRecord(state, {
      id: sessionId,
      title: `${sessionType} -- ${node.id}`,
      author: facilitatorRole,
      schemaVersion: 1,
      revision: 1,
      created: endedIso.slice(0, 10),
      updated: endedIso.slice(0, 10),
      changelog: [
        {
          revision: 1,
          date: endedIso.slice(0, 10),
          by: facilitatorRole,
          summary: 'Session recorded.',
        },
      ],
      // No real per-session cost meter is reachable from here (`SessionResult.usage` carries token
      // counts, never a dollar figure -- confirmed directly, `@forge/adapter-kit`'s own
      // `SessionResult` type) -- a real, disclosed `0` rather than a fabricated estimate, left for a
      // later piece with a real cost model (the identical `ExecuteStepContext`-wide gap
      // `plan/types.ts`'s own `CriticalPathResult.estimatedCost` doc comment already names for the
      // declared, not measured, case).
      costUsd: 0,
      ended: endedIso,
    });
    await persistSessionRecord(ctx, assembled, state);
    return assembled;
  });

  const outcome: StepOutcome = {
    stepId: node.id,
    status: decideFailure === undefined ? 'succeeded' : 'failed',
    startedAt,
    finishedAt,
    detail: { kind: 'agent', session: decideSession },
    ...(decideFailure === undefined ? {} : { failure: decideFailure }),
  };
  return { outcome, record };
}

function roleFromParticipant(participant: InteractionParticipant): string {
  // `dispatchPanel`'s own role shape is `panel:${perspective}` -- `perspective` is exactly the role
  // name this module supplied, so stripping the fixed `panel:` prefix recovers it losslessly.
  return participant.role.startsWith('panel:')
    ? participant.role.slice('panel:'.length)
    : participant.role;
}

function ideaFrom(participant: InteractionParticipant): {
  readonly text: string;
  readonly proposedBy: string;
} {
  return { text: participant.session.finalText, proposedBy: roleFromParticipant(participant) };
}
