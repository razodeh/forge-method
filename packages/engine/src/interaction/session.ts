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
import { ForgeError, isForgeError } from '@forge/core/errors';
import {
  listDirSorted,
  pathExists,
  readTextFile,
  writeFileAtomic,
  ProjectPaths,
  type AbsolutePath,
} from '@forge/core/fs';
import { IdAllocator } from '@forge/core/ids';
import type { Clock } from '@forge/core';
import type { SessionResult } from '@forge/adapter-kit';
import type { AgentDefinition } from '@forge/agents';
import { KbWriter, type KbEntryInput } from '@forge/kb/write';
import { DEFAULT_KB_ROOT, type KbSection } from '@forge/kb/schema';
import {
  CRITIC_ROLE,
  DIVERGE_IDEA_CAP,
  MAX_AGENT_PARTICIPANTS,
  SessionPhaseMachine,
  assembleSessionRecord,
  expressesDisagreement,
  isGenericNonObjection,
  loadTechniqueFromDir,
  type DecideInput,
  type DivergeInput,
  type PhaseDirective,
  type SessionState,
  type SessionParticipant,
  type SessionType,
  type Technique,
} from '@forge/sessions';
import {
  adrSchema,
  risksFileSchema,
  type SessionRecord,
  type SessionTruncationBound,
} from '@forge/schemas';
import { renderArtifactPath } from '@forge/schemas/registry';
import * as YAML from 'yaml';

import { wrapUntrustedContent } from '@forge/adapter-kit/control-tokens';
import { dispatchAgentStep, runParticipantSession } from './dispatch-agent-step.ts';
import type { InteractionParticipant } from './types.ts';
import { markRefusal } from '../dispatch/assemble.ts';
import type { ExecuteStepContext, SessionBounds, StepOutcome } from '../dispatch/types.ts';
import { toAgentId, type StepNode } from '../plan/index.ts';

export type { SessionBounds } from '../dispatch/types.ts';

const HUMAN_ROLE = 'human';

/** `16` §16.8's own literal bound table's real, literal default values -- the numbers every
 * `SessionBounds` field falls back to when a caller (no real one exists yet in this milestone's own
 * scope, per `ExecuteStepContext.sessionBounds`'s own doc comment) leaves it unset. Exported so a test
 * can assert against these exact numbers directly, rather than re-transcribing the spec's own table a
 * second time. */
export const DEFAULT_SESSION_BOUNDS: Required<SessionBounds> = {
  maxDivergeRounds: 3,
  maxConvergeRounds: 2,
  maxAgentParticipants: MAX_AGENT_PARTICIPANTS,
  maxWallClockMs: 20 * 60 * 1000,
  maxCostUsd: 3,
  divergeIdeaCap: DIVERGE_IDEA_CAP,
};

function resolveSessionBounds(bounds: SessionBounds | undefined): Required<SessionBounds> {
  return { ...DEFAULT_SESSION_BOUNDS, ...bounds };
}

/** `16` §16.8's own cost bound needs a real dollar figure per dispatch. `SessionResult.usage.costUsd`
 * is a real, optional field (`@forge/adapter-kit`) some real adapters genuinely populate --
 * `@forge/adapter-claude-code`'s own `session-result.ts`/`sdk/map-message.ts` read it straight from a
 * real `total_cost_usd` the underlying CLI/SDK message reports -- but it is optional precisely because
 * not every adapter, and not every one of a real adapter's own messages, reports one; `FakePlatformAdapter`
 * -- the one adapter every test in this package runs against -- documents that it never does at all
 * (`@forge/testkit`'s own top-of-file doc comment: "`SessionResult.usage.costUsd` is never populated
 * despite `costReporting: 'per-turn'` being the default capability... add the mechanism when one does
 * [need it]"). This piece is that consumer, for the case a real report is absent: a real per-token
 * estimate, used strictly as a fallback -- `estimateSessionCostUsd` below checks `costUsd` first and
 * returns it unmodified whenever it is present, so a real adapter's own real figure always wins outright
 * over this estimate, never the other way around (a dedicated unit test, `session.test.ts`'s own
 * "estimateSessionCostUsd" describe block, pins this precedence directly against a constructed
 * `SessionResult` rather than relying on `FakePlatformAdapter` ever supplying one). The rate itself is a
 * disclosed, order-of-magnitude approximation (roughly a blended input/output rate for a mid-tier coding
 * model as of this piece's own authoring, not a per-model table), not a claimed-precise billing figure:
 * `16` §16.8's own cost bound exists to keep a runaway conversation *bounded*, which a real, cheap,
 * monotonic proxy over real token counts already achieves even when it is not billing-accurate for every
 * real model -- the disclosed risk being that a genuinely pricier model's own real spend could exceed
 * this estimate for the same token count on an adapter that itself never reports a real `costUsd`. See
 * `SPEC-QUESTIONS.md`.
 */
const ESTIMATED_USD_PER_TOKEN = 0.00001;

/** Exported for `session.test.ts`'s own direct, adapter-independent precedence test -- see this
 * constant's own doc comment immediately above. */
export function estimateSessionCostUsd(session: SessionResult): number {
  if (session.usage.costUsd !== undefined) return session.usage.costUsd;
  return (session.usage.inputTokens + session.usage.outputTokens) * ESTIMATED_USD_PER_TOKEN;
}

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
function buildParticipants(
  sessionType: SessionType,
  // `16` §16.6's own `--roles pm,architect,ux` -- a real, caller-supplied narrowing/replacement of
  // `SESSION_TYPE_DEFAULTS`' own disclosed per-type roster (`PLAN-M10.md` P13, the interactive `forge
  // session` CLI). `undefined`/`[]` keeps this file's own pre-P13 defaults exactly as they were --
  // every workflow-step caller (no `sessionStepSchema` field carries a roles list at all, per this
  // file's own top-of-file doc comment) is unaffected by this parameter's mere existence.
  roleOverride?: readonly string[],
): {
  readonly facilitatorRole: string;
  readonly agentRoles: readonly string[];
  readonly participants: readonly SessionParticipant[];
} {
  const defaults = SESSION_TYPE_DEFAULTS[sessionType];
  // A fresh critic round found an earlier draft let a caller-supplied `roleOverride` name the
  // facilitator's own role (`defaults.facilitator`) or `HUMAN_ROLE` outright: the former would have
  // DIVERGE/CONVERGE dispatch a real agent turn to the facilitator's own synthetic identity and record
  // it as a real, attributed idea/cluster (`ideaFrom`'s own `proposedBy`) -- the exact "facilitator
  // contributes content" violation this file's own top-of-file doc comment and `resolveDecisionOwner`'s
  // own facilitator exclusion both already guard against everywhere else; the latter would append a
  // second, duplicate `{role: HUMAN_ROLE}` entry alongside the one this function already always adds.
  // Both are filtered out here, silently narrowing to whatever real, distinct roles remain -- a
  // caller-error case (`16` §16.6's own `--roles` flag naming the facilitator or the human) is not
  // reachable through this codebase's own real CLI validation surface today, so refusing outright has
  // no real caller to refuse yet; filtering is the honest, minimal fix for the structural invariant.
  const requested =
    roleOverride?.filter((role) => role !== defaults.facilitator && role !== HUMAN_ROLE) ?? [];
  const agentRoles = requested.length > 0 ? [...new Set(requested)] : defaults.participants;
  const participants: SessionParticipant[] = [
    ...agentRoles.map((role) => ({ role })),
    { role: HUMAN_ROLE },
  ];
  return { facilitatorRole: defaults.facilitator, agentRoles, participants };
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
    // The shipped facilitator's own role prompt (`modules/fm-core/agents/facilitator.agent.yaml`): prompt
    // assembly loads `prompt.system` as block [2]'s role instructions, so this must be a real reference
    // (`PLAN-M13.md` P5), not a placeholder file name.
    prompt: { system: 'prompts/facilitator.system.md' },
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
export const SESSIONS_DIR = 'docs/forge/sessions';

/**
 * One FIFO queue per project root, matching `@forge/kb/write`'s own `KbWriter` doc comment exactly
 * ("One FIFO queue per project... not a per-instance queue") and for the identical reason: a fresh
 * critic round found `allocateSessionId`'s own existence probe had no lock at all, so two session
 * steps racing inside the same run (independent lanes, no `dependsOn` edge between them) whose
 * `numericSessionId` candidates coincide could both pass the same probe before either wrote, then
 * silently overwrite each other's real, completed session record. The id-allocation-and-write pattern
 * this queue was first built for recurs twice more in this same file (`writeAdrBack`'s own real
 * `IdAllocator.allocate('ADR')`, `writeRiskBack`'s own real `kb/risks.md` read-modify-write) -- both
 * reuse this identical queue rather than each growing its own, since the failure mode (two concurrent
 * session steps racing the same real, on-disk state for the same project) is the exact same shape every
 * time, not three unrelated problems. Despite the name, this is this file's one general "serialise real
 * writes against project-shared state" mutex, not a session-record-specific mechanism.
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
 * has failed" describes, not merely the front matter `SessionRecord` alone carries.
 *
 * `notes` (`PLAN-M14.md` P29): this run's own real, disclosed degrades (`sessionNotes`'s own doc
 * comment, `runSessionStep`) -- rendered as the leading lines of `## Converge`, the one phase every
 * note this piece produces is actually about; `[]` renders nothing extra, identical to this function's
 * own behaviour before this piece. */
function renderSessionBody(state: SessionState, notes: readonly string[] = []): string {
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
  const noteLines = notes.map((note) => `- note: ${escapeTableCell(note)}`);
  const convergeSection =
    [...noteLines, ...clusterLines, ...objectionLines].join('\n') || '(no clusters or objections)';

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
/** `docs/forge/sessions/.state/` — a real, additive-only sidecar directory, never part of `16` §16.5's
 * own canonical `SESSION-{id}-{slug}.md` artifact shape, holding one raw `SessionState` JSON snapshot
 * per session id. Exists solely so `runSessionStep`'s own `resumeFrom` parameter (see that function's
 * own doc comment) has a real prior `SessionState` to read back -- the persisted `SessionRecord` alone
 * (front matter plus a rendered, already-summarised Markdown body) does not carry enough structure to
 * reconstruct `state.ideas`/`state.clusters` with their own real ids intact, only their rendered text.
 * A disclosed, internal mechanism (the identical "not one of `16`'s own artifact types, an engine-
 * internal bookkeeping file" shape `.forge/state/` already is for run bookkeeping generally), not a
 * second canonical artifact.
 *
 * Three real, disclosed limitations a fresh critic round named, none fixed here: (1) written
 * unconditionally for *every* session (not only a truncated one that might later be resumed), so an
 * ordinary `complete` session also leaves one behind, unbounded in count and never cleaned up -- a
 * later piece's real retention/GC job, not this one's; (2) it sits inside `docs/forge/sessions/`, this
 * project's own real, tracked `docs/` tree, with no `.gitignore` entry this piece adds anywhere, so an
 * ordinary `git add docs/` commits it by default; (3) it duplicates content the canonical `.md` record
 * already carries in summarised form, and the two are not guaranteed to stay in sync if either is ever
 * hand-edited independently. None of these three affect correctness of a real `resumeFrom` call
 * (`loadSessionState`'s own structural validation guards against a corrupted read), only disk hygiene
 * and repository cleanliness. See `SPEC-QUESTIONS.md`. */
const SESSION_STATE_DIR = `${SESSIONS_DIR}/.state`;

function sessionStatePath(paths: ProjectPaths, id: string): AbsolutePath {
  return paths.resolveWithin(`${SESSION_STATE_DIR}/${id}.json`);
}

async function persistSessionRecord(
  ctx: ExecuteStepContext,
  record: SessionRecord,
  state: SessionState,
  notes: readonly string[] = [],
): Promise<void> {
  const paths = new ProjectPaths(ctx.projectRoot);
  const target = paths.resolveWithin(`${SESSIONS_DIR}/${record.id}.md`);
  const text = `---\n${YAML.stringify(record)}---\n\n${renderSessionBody(state, notes)}`;
  await writeFileAtomic(target, text);
  await writeFileAtomic(sessionStatePath(paths, record.id), JSON.stringify(state));
}

/** Reads back the real, previously-persisted `SessionState` sidecar for `id` -- `runSessionStep`'s own
 * `resumeFrom` parameter's real source, and `forge session resume`'s (`PLAN-M10.md` P13) one real way
 * to continue a session without re-asking `16` §16.3 step 1's own already-framed question. `undefined`
 * when no sidecar exists for `id` (a session record predating this piece, or a hand-authored fixture)
 * -- a real, honest absence, not a programmer error, matching `loadProjectAgentRegistry`'s own doc
 * comment reasoning for an absent `.forge/agents` directory. */
const SESSION_PHASES: ReadonlySet<string> = new Set([
  'FRAME',
  'DIVERGE',
  'CONVERGE',
  'DECIDE',
  'RECORD',
]);

/** A minimal, mechanical structural check over `candidate` -- not a full `zod` schema (`@forge/sessions`
 * has no schema of its own for `SessionState`, a pure in-memory shape never otherwise persisted or
 * validated anywhere in this codebase before this piece), but enough to catch a hand-edited or
 * bit-rotted sidecar before it reaches `runSessionStep`'s own real dispatch logic as a raw, uncaught
 * `TypeError` (e.g. `resumeFrom.clusters.length` on a missing/renamed field). A fresh critic round
 * found an earlier draft trusted the parsed JSON outright via a bare `as SessionState` cast -- the
 * identical "never a bare cast, a hand-edited or corrupted file must be caught here" discipline this
 * file's own `parseSessionRecordText` counterpart (`@forge/cli/commands/loop/session.ts`) already
 * applies to the real, canonical `.md` record, missing here for its own internal sidecar. Real,
 * disclosed limitation: checks shape only (array-ness, a real phase string), never the *content* of
 * `SessionParticipant`/`SessionIdea`/etc. entries -- a session record precisely damaged in a way that
 * keeps every array real but corrupts one entry's own fields would still pass this check and surface a
 * more specific failure later. See `SPEC-QUESTIONS.md`. */
function isPlausibleSessionState(candidate: unknown): candidate is SessionState {
  if (typeof candidate !== 'object' || candidate === null) return false;
  const state = candidate as Record<string, unknown>;
  return (
    typeof state['phase'] === 'string' &&
    SESSION_PHASES.has(state['phase']) &&
    typeof state['sessionType'] === 'string' &&
    Array.isArray(state['participants']) &&
    Array.isArray(state['technique']) &&
    Array.isArray(state['ideas']) &&
    Array.isArray(state['clusters']) &&
    Array.isArray(state['objections']) &&
    Array.isArray(state['decisions']) &&
    Array.isArray(state['nonDecisions']) &&
    Array.isArray(state['actions']) &&
    typeof state['truncated'] === 'boolean'
  );
}

/** Reads back the real, previously-persisted `SessionState` sidecar for `id` -- `runSessionStep`'s own
 * `resumeFrom` parameter's real source, and `forge session resume`'s (`PLAN-M10.md` P13) one real way
 * to continue a session without re-asking `16` §16.3 step 1's own already-framed question. `undefined`
 * both when no sidecar exists for `id` (a session record predating this piece, or a hand-authored
 * fixture) and when one exists but fails `isPlausibleSessionState`'s own structural check (malformed
 * JSON, or JSON that parses but is not a real, shape-plausible `SessionState`) -- both are the identical
 * real, honest "no real, usable prior state to resume from" case from this function's own caller's
 * point of view, matching `loadProjectAgentRegistry`'s own doc comment reasoning for an absent
 * `.forge/agents` directory: a caller-facing distinction between "absent" and "corrupted" belongs to
 * `forge session resume`'s own error reporting (`RUN-074`, `@forge/cli/commands/loop/session.ts`), not
 * to this function's own return type. */
export async function loadSessionState(
  ctx: Pick<ExecuteStepContext, 'projectRoot'>,
  id: string,
): Promise<SessionState | undefined> {
  const target = sessionStatePath(new ProjectPaths(ctx.projectRoot), id);
  if (!(await pathExists(target))) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readTextFile(target));
  } catch {
    return undefined;
  }
  return isPlausibleSessionState(parsed) ? parsed : undefined;
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
    if (outcome.kind === 'already-integrated') {
      // Nothing was left to merge (its content is already in the integration branch): only the lane is removed.
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

/** The project's own resolved agent roster (`.forge/agents/<id>.yaml`, what `forge init`/`forge compile`
 * materialise and what dispatch loads from), keyed by id -- the one place a session finds its participants'
 * definitions and resolves DECIDE's owner (`resolveDecisionOwner` below). It used to read the
 * `<project>/modules/*\/agents` source tree, which a real `forge init` project does not have, so every
 * session in a fresh project found no owner and fell back to the human (`PLAN-M13.md` P27, Q215).
 *
 * A project with no `.forge/agents` at all yields an empty registry: nobody owns the decision, which is what
 * DECIDE's human-input fallback is for. A roster file that fails to load throws `RUN-056` (surfaced as a
 * failed step by `executeStep`) instead of being skipped -- dropping an owner silently would hand the
 * decision to the next agent in line. */
async function loadProjectAgentRegistry(
  ctx: ExecuteStepContext,
): Promise<ReadonlyMap<string, AgentDefinition>> {
  try {
    const agents = await ctx.assembly.listAgents();
    return new Map(agents.map((agent) => [agent.id, agent]));
  } catch (cause) {
    // A typed roster failure (`RUN-056`, `RUN-034`) is marked so `executeStep` folds it into one failed step,
    // like any other refusal to assemble; anything else is a programmer error and propagates as one.
    throw isForgeError(cause) ? markRefusal(cause) : cause;
  }
}

/** `16` §16.7 point 3's own `steel-man-debate` -- the one real `16` §16.2 session type whose own
 * "contested decisions" nature matches `steel-man-debate.technique.yaml`'s own `bestFor: Contested
 * decisions` field verbatim. A real, disclosed reading, not a spec quote (no other session type's own
 * `SESSION_TYPE_DEFAULTS` row is a comparably direct match) -- see `SPEC-QUESTIONS.md`. */
const STEEL_MAN_SESSION_TYPES: ReadonlySet<SessionType> = new Set<SessionType>(['tradeoff']);
const STEEL_MAN_TECHNIQUE_ID = 'steel-man-debate';

/** Where `.forge/techniques/` sits when a caller's own context leaves `ExecuteStepContext.
 * techniquesRoot` unset -- the one real, materialised location `forge init`/`forge upgrade` write it
 * (`PLAN-M14.md` P29, `write-tree.ts`), the identical "a sensible literal default over an
 * unconfigurable requirement" choice `docRoots`'s own doc comment already makes. `buildRunEngineContext`
 * (`@forge/cli/commands/run/context.ts`) sets this same literal explicitly for every real run; this is
 * the fallback for a context built without going through it at all (a hand-built test fixture). */
const DEFAULT_TECHNIQUES_ROOT = '.forge/techniques';

/** The real, on-disk `steel-man-debate` technique for this project, from the flat, materialised
 * `.forge/techniques/` directory (`PLAN-M14.md` P29) -- no longer `<project>/modules/*\/techniques`,
 * which a real `forge init` project does not have (the identical `modules/`-is-shipped-content-only
 * correction `loadProjectAgentRegistry`'s own doc comment above already made for the roster, Q215).
 *
 * `undefined` when this project's `.forge/techniques/` has no `steel-man-debate.technique.yaml` at all
 * -- a fresh project that has not run `forge init`, or one whose materialised copy was deleted. CONVERGE
 * degrades to ordinary `panel` mode when this comes back `undefined`: a real fallback, not a crash,
 * over an optional anti-groupthink enhancement this session step's own core anatomy does not depend on
 * -- but now VISIBLY (the caller records a note in both the returned `StepOutcome` and the persisted
 * `SessionRecord`), where before this piece every load error, including a genuinely malformed file, was
 * silently swallowed here.
 *
 * A malformed file, or one whose own `id` disagrees with its file name, is NOT swallowed: `RUN-065`
 * propagates, marked as a real assembly-style refusal (`markRefusal`, the identical treatment
 * `loadProjectAgentRegistry` already gives `RUN-056`/`RUN-034`) so it fails this one step
 * (`execute.ts`'s own `case 'session':` catch folds a marked refusal into a failed `StepOutcome`)
 * instead of crashing the whole run. */
async function loadSteelManTechnique(ctx: ExecuteStepContext): Promise<Technique | undefined> {
  const techniquesRoot = ctx.techniquesRoot ?? DEFAULT_TECHNIQUES_ROOT;
  const dir = new ProjectPaths(ctx.projectRoot).resolveWithin(techniquesRoot);
  try {
    return await loadTechniqueFromDir(dir, STEEL_MAN_TECHNIQUE_ID);
  } catch (cause) {
    throw isForgeError(cause) ? markRefusal(cause) : cause;
  }
}

/** Recovers the real role a `debate`-mode CONVERGE participant's own fixed `proposer:round-N`/
 * `critic:round-N` shape (`dispatchDebate`, `dispatch-agent-step.ts`) stands in for.
 * `critic:round-N` is always `CRITIC_ROLE` itself -- `dispatchDebate`'s own built-in "critic" turn *is*
 * this session's own `critic` participant when debate mode drives CONVERGE. `proposer:round-N` is
 * whichever real, non-critic role this module actually resolved and dispatched as the debate's own
 * `agent` parameter (`proposerRole`). */
function roleFromDebateParticipant(role: string, proposerRole: string): string {
  if (role.startsWith('critic:round-')) return CRITIC_ROLE;
  if (role.startsWith('proposer:round-')) return proposerRole;
  return role;
}

/** The lower-cased words of `question`, split on any run of non-alphanumeric characters (ordinary
 * English punctuation/whitespace) -- what `topicNamedIn` below checks a `decisions_owned` topic's own
 * `.`/`_`/`-`-separated words against. A real, deliberately LEXICAL split (`Discloses`): no stemming, no
 * synonyms, so "decompose" never matches a topic word spelled "decomposition". */
function questionWords(question: string): ReadonlySet<string> {
  return new Set(
    question
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 0),
  );
}

/** One `decisions_owned` topic (e.g. `data.consistency`) "names itself" in the framed question when any
 * one of its own `.`/`_`/`-`-separated words also appears there -- `data.consistency` matches "...gives
 * us consistency for the order model?" on the word "consistency" alone; it need not match every word. */
function topicNamedIn(topic: string, words: ReadonlySet<string>): boolean {
  return topic
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0)
    .some((word) => words.has(word));
}

/** `resolveDecisionOwner`'s own real result: the resolved owner, plus -- when a real lexical match is
 * what won it -- which one of its own `decisions_owned` topics the framed question actually named.
 * `topic` is `undefined` on the fallback path (no candidate's own topics matched, or two or more tied
 * for the most matches): the owner was picked by roster order alone, not because the question named
 * anything of theirs, and the DECIDE brief below must not claim otherwise. */
interface DecisionOwnerResolution {
  readonly owner: AgentDefinition;
  readonly topic?: string;
}

/** `05` §5.3's own `decisions_owned` field, read against the framed question (`16` §16.3 step 4's own
 * "the decision owner (the role whose mandate covers it, per `decisions_owned`) rules"): among this
 * session's own real, non-critic, non-facilitator agent roles that resolve to a real, registered
 * `AgentDefinition` declaring at least one decision, the one whose own `decisions_owned` topics the
 * question names the most (`PLAN-M14.md` P32, `topicNamedIn` above, lexical matching only). A tie among
 * the top scorers, or no real match at all, falls back to today's original rule -- the first such role,
 * in roster order, that owns at least one decision -- exactly as before this piece: `undefined` when no
 * participant role resolves at all, the real, honest "nobody here owns this" case DECIDE's own
 * human-input fallback exists for. */
function resolveDecisionOwner(
  agentRoles: readonly string[],
  facilitatorRole: string,
  registry: ReadonlyMap<string, AgentDefinition>,
  question: string,
): DecisionOwnerResolution | undefined {
  const candidates: AgentDefinition[] = [];
  for (const role of agentRoles) {
    if (role === facilitatorRole || role === CRITIC_ROLE) continue;
    const agent = registry.get(role);
    if (agent !== undefined && agent.decisions_owned.length > 0) candidates.push(agent);
  }
  const [firstCandidate] = candidates;
  if (firstCandidate === undefined) return undefined;

  const words = questionWords(question);
  let best: DecisionOwnerResolution | undefined;
  let bestScore = 0;
  let tie = false;
  for (const agent of candidates) {
    const matched = agent.decisions_owned.filter((topic) => topicNamedIn(topic, words));
    const topic = matched[0];
    if (topic !== undefined && matched.length > bestScore) {
      bestScore = matched.length;
      best = { owner: agent, topic };
      tie = false;
    } else if (topic !== undefined && matched.length === bestScore) {
      tie = true;
    }
  }
  if (best !== undefined && !tie) return best;
  return { owner: firstCandidate };
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
async function writeKbDecisionBack(
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

/** `[a-z0-9]`, hyphen-joined, never empty -- the identical slug shape `forge adr new`'s own `slugify`
 * (`@forge/cli/commands/adr.ts`) produces; re-derived here rather than imported (`@forge/engine` has
 * no boundary-graph edge to `@forge/cli` at all -- `cli`'s own row is "everything," every other row's
 * own arrow points the other way) rather than duplicating `adrNew`'s own thin command-layer logic. */
function artifactSlug(seed: string): string {
  return (
    seed
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'session'
  );
}

/** `related: [...]` provenance marker every ADR/Risk this module writes back carries, and the one
 * thing `findExistingSessionArtifact` below greps for -- the identical "a decision made by session
 * `node.id`" provenance `writeKbDecisionBack`'s own `sources: [{kind:'decision', ref: 'session:...'}]`
 * already records for a KB entry, applied to the two artifact types that carry no such `sources` field
 * of their own. */
function sessionProvenance(nodeId: string): string {
  return `session:${nodeId}`;
}

/**
 * A best-effort idempotency check for the two artifact-creation paths below (`writeAdrBack`,
 * `writeRiskBack`) that, unlike `writeKbDecisionBack`'s own deterministic-path check, allocate a real
 * id via `IdAllocator` -- a path that is *not* deterministic in `node.id` alone, so a naive "does the
 * target path already exist" check (the mechanism `writeKbDecisionBack` uses) cannot detect a prior
 * write here at all. Scans every file already under `dir` for `sessionProvenance(nodeId)` in its own
 * raw text (front matter or body, either counts) and returns the first match's own `id` field.
 *
 * A real, disclosed limitation, not a silent gap: a resumed/retried run of a session step whose own
 * ADR/Risk write already landed is still expected to converge on it via this scan, but a project with
 * a very large `kb/decisions/` (or a very large `kb/risks.md`) pays a real, linear read cost on every
 * write-back call -- the same "a real, honest 0/disclosed-estimate over a fabricated precise one"
 * trade-off this file already makes elsewhere (`estimateSessionCostUsd`'s own doc comment), preferred
 * here over `writeKbDecisionBack`'s own O(1) deterministic-path check only because an allocated id's
 * own path is not knowable in advance. See `SPEC-QUESTIONS.md`.
 */
async function findExistingSessionArtifact(
  paths: ProjectPaths,
  files: readonly string[],
  nodeId: string,
): Promise<string | undefined> {
  const marker = sessionProvenance(nodeId);
  for (const relativePath of files) {
    const text = await readTextFile(paths.resolveWithin(relativePath)).catch(() => '');
    if (!text.includes(marker)) continue;
    const id = extractKbEntryId(text) ?? /^\s*-\s*id:\s*(\S+)/m.exec(text)?.[1];
    if (id !== undefined) return id;
  }
  return undefined;
}

/** Every `.md` file directly under `dir`, or `[]` if `dir` does not exist at all -- a brand-new
 * project's own `kb/decisions/` before this module's first ever ADR write-back, the identical "a real,
 * honest absence, not a programmer error" case `loadProjectAgentRegistry`'s own doc comment already
 * treats a missing `.forge/agents` directory as. */
async function listMarkdownFiles(paths: ProjectPaths, dir: string): Promise<readonly string[]> {
  const target = paths.resolveWithin(dir);
  if (!(await pathExists(target))) return [];
  const entries = await listDirSorted(target);
  return entries.filter((entry) => entry.endsWith('.md')).map((entry) => `${dir}/${entry}`);
}

/**
 * `16` §16.5's own worked example write-back ("Draft ADR for the quick-path data shape -- ADR-0019"):
 * a real `kb/decisions/ADR-####-slug.md`, allocated through the identical `IdAllocator`
 * (`@forge/core/ids`) and `renderArtifactPath` (`@forge/schemas/registry`) primitives `forge adr new`
 * (`@forge/cli/commands/adr.ts`) composes -- `@forge/engine` has no boundary-graph edge to `@forge/cli`
 * itself (this file's own `artifactSlug` doc comment), so this recomposes the same two primitives
 * directly rather than reaching for cli's own thin wrapper, not a third, unrelated mechanism. Unlike
 * `adrNew`, this cannot start from `@forge/templates`' own pre-fielded `ADR.md` template either --
 * `@forge/engine` has no edge to `@forge/templates` (`tools/eslint-plugin-forge-boundaries/src/
 * graph.mjs`) -- so every `adrSchema` field is synthesized directly and validated via `adrSchema.parse`
 * before the file is ever written, the same "construct the full object, validate, then serialise"
 * shape `persistSessionRecord` already uses for `SessionRecord` itself. See `SPEC-QUESTIONS.md`.
 *
 * The whole body runs inside `enqueueForProject` (the identical per-project FIFO queue
 * `persistSessionRecord`'s own session-id allocation already uses, `sessionRecordQueues`'s own doc
 * comment) -- a fresh critic round found an earlier draft constructed a brand-new `IdAllocator` per
 * call with no queue at all, so two `design-review`/`tradeoff` session steps genuinely running
 * concurrently in the same run (`run-engine.ts`'s own `Promise.all(admitted.map(...))`) could both scan
 * the same "next free ADR id," both compute the identical candidate id, and both write a real,
 * `adrSchema`-valid file at two different paths sharing one id -- a real, silent id collision, the
 * exact defect class `sessionRecordQueues`'s own doc comment already names and fixes for session-record
 * ids, left open here until this piece's own critic round found the identical gap in the two functions
 * that ship alongside it.
 */
async function writeAdrBack(
  ctx: ExecuteStepContext,
  node: StepNode,
  ownerRole: string,
  decisionText: string,
  clock: Clock,
): Promise<string> {
  return enqueueForProject(ctx.projectRoot, async () => {
    const paths = new ProjectPaths(ctx.projectRoot);
    const existingFiles = await listMarkdownFiles(paths, 'kb/decisions');
    const existing = await findExistingSessionArtifact(paths, existingFiles, node.id);
    if (existing !== undefined) return existing;

    const allocator = new IdAllocator({ paths, clock });
    const id = await allocator.allocate('ADR');
    const pathResult = renderArtifactPath('ADR', { id, slug: artifactSlug(node.id) });
    if (!pathResult.success) {
      // `id`/`slug` are both always non-empty by construction above -- `ADR`'s own path template
      // names no other variable, so this is not a reachable caller-input failure, the identical "this
      // would be a bug in this class" shape `IdAllocator.allocate`'s own doc comment already uses a
      // plain `RangeError` for.
      throw new RangeError(
        `renderArtifactPath('ADR', ...) failed: missing ${pathResult.missingVariable}`,
      );
    }
    const today = clock.now().slice(0, 10);
    const candidate = {
      id,
      type: 'ADR' as const,
      schemaVersion: 1,
      title: `Session decision -- ${node.id}`,
      status: 'accepted' as const,
      category: 'architecture' as const,
      deciders: [ownerRole],
      date: today,
      reversibility: 'medium' as const,
      blast_radius: [] as string[],
      revisit_trigger: 'Revisit if new evidence contradicts this decision.',
      supersedes: [] as string[],
      superseded_by: null,
      related: [sessionProvenance(node.id)],
      diagrams: [] as string[],
      framework: 'n/a',
      created: today,
      updated: today,
      revision: 1,
      author: ownerRole,
      changelog: [
        {
          revision: 1,
          date: today,
          by: ownerRole,
          summary: 'Recorded from a real collaboration session.',
        },
      ],
    };
    const parsed = adrSchema.safeParse(candidate);
    if (!parsed.success) {
      // Every field above is this function's own literal, statically-typed construction -- a schema
      // mismatch here is a real defect in this function, not a caller-input failure `ForgeError`'s own
      // remedy-oriented contract fits (the identical reasoning the branch above already gives).
      throw new RangeError(
        `adrSchema rejected a session write-back candidate: ${parsed.error.message}`,
      );
    }
    const target = paths.resolveWithin(pathResult.path);
    const body = `## Context\n\n${decisionText}\n`;
    await writeFileAtomic(target, `---\n${YAML.stringify(parsed.data)}---\n\n${body}`);
    return id;
  });
}

/**
 * `16` §16.5's own worked example write-back ("Add RISK: quick path bypasses tax validation --
 * RISK-007"): a real entry appended to the real `kb/risks.md` register (`riskSchema`'s own `collection:
 * true` path, `18` §18.7) -- read-modify-write against whatever the file already holds (or a freshly
 * initialised, empty register when it does not exist yet), validated whole via `risksFileSchema`
 * before ever being written, the identical validate-then-serialise discipline `writeAdrBack` above
 * already uses.
 *
 * The whole body runs inside `enqueueForProject`, for a real reason far more pressing here than for
 * `writeAdrBack`: this function's own read-modify-write of one shared file (`kb/risks.md`) has no
 * per-target-path isolation the way two ADRs (each its own file) at least partially get -- a fresh
 * critic round found an earlier, unqueued draft let two concurrent `premortem`/`war-room` session
 * steps each read the identical pre-write `kb/risks.md`, each independently append their own real risk
 * to that same snapshot's own `risks` array, and whichever `writeFileAtomic` call lands second silently
 * overwrite the first session's entire risk entry -- a real, silent data-loss race with no error, no
 * log, and (before this fix) no test able to catch it either.
 */
async function writeRiskBack(
  ctx: ExecuteStepContext,
  node: StepNode,
  ownerRole: string,
  decisionText: string,
  clock: Clock,
): Promise<string> {
  return enqueueForProject(ctx.projectRoot, async () => {
    const paths = new ProjectPaths(ctx.projectRoot);
    const relativePath = 'kb/risks.md';
    const existing = await findExistingSessionArtifact(paths, [relativePath], node.id);
    if (existing !== undefined) return existing;

    const target = paths.resolveWithin(relativePath);
    const today = clock.now().slice(0, 10);
    let existingFrontMatter: Record<string, unknown> | undefined;
    if (await pathExists(target)) {
      const text = await readTextFile(target);
      const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
      if (match?.[1] !== undefined) {
        const parsedYaml: unknown = YAML.parse(match[1]);
        if (typeof parsedYaml === 'object' && parsedYaml !== null) {
          existingFrontMatter = parsedYaml as Record<string, unknown>;
        }
      }
    }
    const allocator = new IdAllocator({ paths, clock });
    const id = await allocator.allocate('Risk');
    const priorRisksRaw = existingFrontMatter?.['risks'];
    const priorRisks: readonly unknown[] = Array.isArray(priorRisksRaw) ? priorRisksRaw : [];
    const priorChangelogRaw = existingFrontMatter?.['changelog'];
    const priorChangelog: readonly unknown[] = Array.isArray(priorChangelogRaw)
      ? priorChangelogRaw
      : [];
    const priorRevision =
      typeof existingFrontMatter?.['revision'] === 'number' ? existingFrontMatter['revision'] : 0;
    const candidate = {
      type: 'Risk' as const,
      schemaVersion: 1,
      title: 'Risk register',
      status: 'active',
      created: (existingFrontMatter?.['created'] as string | undefined) ?? today,
      updated: today,
      revision: priorRevision + 1,
      author: ownerRole,
      changelog: priorChangelog,
      risks: [
        ...priorRisks,
        {
          id,
          statement: `${decisionText} (${sessionProvenance(node.id)})`,
          likelihood: 'unknown',
          impact: 'unknown',
          mitigation: 'To be assessed.',
          owner: ownerRole,
        },
      ],
    };
    const parsed = risksFileSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new RangeError(
        `risksFileSchema rejected a session write-back candidate: ${parsed.error.message}`,
      );
    }
    await writeFileAtomic(target, `---\n${YAML.stringify(parsed.data)}---\n`);
    return id;
  });
}

/**
 * `16` §16.5's own mandatory write-back, dispatched to the real artifact-creation mechanism `16`
 * §16.2's own session-type table implies each session type actually produces: `design-review`/
 * `tradeoff` decisions are architectural rulings (`16` §16.5's own worked ADR reference), `premortem`/
 * `war-room` decisions are risk-shaped (`16` §16.5's own worked "Add RISK:" action), every other
 * session type keeps the plain KB-knowledge write-back `writeKbDecisionBack` already provides. Every
 * path reuses the same real, already-established primitives (`KbWriter`, `IdAllocator`,
 * `renderArtifactPath`) -- none of the three functions this dispatches to invents a fourth mechanism.
 */
async function writeSessionArtifactBack(
  ctx: ExecuteStepContext,
  sessionType: SessionType,
  section: KbSection,
  node: StepNode,
  ownerRole: string,
  decisionText: string,
  clock: Clock,
): Promise<string> {
  if (sessionType === 'design-review' || sessionType === 'tradeoff') {
    return writeAdrBack(ctx, node, ownerRole, decisionText, clock);
  }
  if (sessionType === 'premortem' || sessionType === 'war-room') {
    return writeRiskBack(ctx, node, ownerRole, decisionText, clock);
  }
  return writeKbDecisionBack(ctx, section, node, ownerRole, decisionText, clock);
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
  notes: readonly string[] = [],
): SessionStepResult {
  return {
    outcome: {
      stepId: nodeId,
      status: 'failed',
      startedAt,
      finishedAt,
      detail: { kind: 'agent', session: NO_AGENT_SESSION },
      failure: { source: 'gate', code: error.code, message: error.message, cause: error },
      ...(notes.length === 0 ? {} : { notes }),
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
/**
 * `16` §16.7 point 5's own real precedence rule, threaded from the caller: when supplied, this is the
 * human's own real, already-elicited position on the framed question, and DECIDE records it as *the*
 * decision, in place of whatever agent-resolved owner would otherwise have run (`DecideInput.
 * humanDecision`'s own doc comment, `@forge/sessions`, has the full override rule). Optional, and
 * disclosed rather than silently absent: no real call site in this milestone's own scope populates it
 * yet (`ExecuteStepContext` has no synchronous, interactive human-input channel at all -- this file's
 * own top-of-file citation of that exact, already-recorded gap for `elicit`/`subworkflow` applies
 * identically here), the same honest "a real, wired extension point with no caller yet" shape this
 * file's own `ElicitationRequested` telemetry event already is. A later, interactive `forge session`
 * CLI (`PLAN-M10.md` P13) is the real, intended caller.
 */
export interface HumanSessionInput {
  readonly decision: string;
  readonly owner?: string;
}

/**
 * `resumeFrom` — `PLAN-M10.md` P13's own `forge session resume <id>` real entry point: an already
 * real, previously-persisted `SessionState` (`loadSessionState` below, read back from this module's
 * own sidecar JSON snapshot) rather than a fresh `machine.start()`/`machine.frame()` call. `16` §16.6's
 * own "resume" verb, read literally against this module's own real shape: every real invocation of
 * this function already runs synchronously to `RECORD` (there is no "paused mid-run" state this engine
 * ever leaves lying around across two separate process invocations) -- so "resume" cannot mean
 * "continue an in-flight call," it means "start a new call that does not discard a prior, truncated
 * session's own real accumulated work and does not re-ask its already-framed question a second time."
 *
 * Re-enters at `DIVERGE` when the prior session has real clusters yet (`clusters.length === 0`) --
 * `16` §16.8's own diverge-idea-cap/diverge-rounds truncation reasons both leave a session with real
 * ideas but no real CONVERGE clustering ever attempted -- or at `CONVERGE` otherwise (the prior session
 * already clustered at least once before a converge-rounds/wall-clock/cost bound cut it short, so
 * DIVERGE's own real work is reused rather than re-run). `framing`/`technique`/`participants` all carry
 * over verbatim -- `16` §16.3 step 1's own one-sentence question is asked once, not on every resume.
 * `truncated`/`inconclusiveReason` are cleared: this new run gets a real, honest chance at a genuine
 * `complete` outcome rather than starting pre-labelled as the failure it is resuming from. See
 * `SPEC-QUESTIONS.md`.
 */
export async function runSessionStep(
  node: StepNode,
  ctx: ExecuteStepContext,
  humanInput?: HumanSessionInput,
  participantRoles?: readonly string[],
  resumeFrom?: SessionState,
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

  // The roster is read before anything is dispatched: a roster file that does not load fails the step here
  // (`RUN-056`) instead of after DIVERGE has spent real sessions. CONVERGE's steel-man debate needs a
  // registered proposer, and DECIDE resolves its owner, from this one read.
  const registry = await loadProjectAgentRegistry(ctx);

  const clock = toClock(ctx);
  const bounds = resolveSessionBounds(ctx.sessionBounds);
  const machine = new SessionPhaseMachine({
    clock,
    maxAgentParticipants: bounds.maxAgentParticipants,
    divergeIdeaCap: bounds.divergeIdeaCap,
  });
  const { facilitatorRole, agentRoles, participants } = buildParticipants(
    sessionType,
    participantRoles,
  );
  const facilitator = facilitatorAgent(facilitatorRole, node);

  // `16` §16.8's own run-wide cost bound -- accumulated from every real dispatch this run makes
  // (`estimateSessionCostUsd`'s own doc comment), across every phase, so `assembleSessionRecord`'s own
  // `costUsd` field is finally a real, tracked figure rather than the disclosed, hardcoded `0` this
  // file carried before this piece.
  let costUsd = 0;
  const trackCost = (session: SessionResult): void => {
    costUsd += estimateSessionCostUsd(session);
  };
  /** `PLAN-M14.md` P29's own visible degrade: a real disclosure of a genuine fallback this session step
   * took, surfaced in both the returned `StepOutcome.notes` and the persisted `SessionRecord`'s own
   * `## Converge` body (`renderSessionBody`) -- never merely swallowed. Today the one real trigger is
   * CONVERGE round 1 wanting the `steel-man-debate` technique (`STEEL_MAN_SESSION_TYPES`) and finding
   * none under `.forge/techniques/`. */
  const sessionNotes: string[] = [];
  /** `undefined` until a round-cap/cost/wall-clock bound genuinely fires; once set, DECIDE dispatches
   * nothing further (this file's own `runSessionStep` doc comment addendum below has the fuller
   * reasoning) and the record is assembled with `truncated_bound` naming it. Deliberately distinct
   * from `ideaCapBound` below -- the idea cap forces early clustering, not an early end to the whole
   * session, so it must never gate DECIDE's own real dispatch the way this variable does. */
  let truncatedBound: SessionTruncationBound | undefined;
  /** Set only when DIVERGE's own idea cap forced early clustering (`16` §16.8's own "Idea cap in
   * DIVERGE: 30") -- a real-but-milder truncation than `truncatedBound` above, read back into the
   * final record only as a fallback label when nothing more specific (a later round-cap/cost/wall-
   * clock bound) also fired during the very same run. */
  let ideaCapBound: SessionTruncationBound | undefined;
  function checkTimeAndCost(): SessionTruncationBound | undefined {
    if (costUsd >= bounds.maxCostUsd) return 'cost';
    if (ctx.now() - startedAt >= bounds.maxWallClockMs) return 'wall-clock';
    return undefined;
  }

  // `resumeFrom`'s own doc comment above has the fuller reasoning -- entering directly at `DIVERGE`
  // or `CONVERGE` skips a fresh `machine.start()`/`machine.frame()` call entirely, reusing the prior
  // session's own real `framing`/`technique`/`participants` instead of asking `16` §16.3 step 1's own
  // one-sentence question a second time.
  // A fresh critic round found an earlier draft resumed any truncated state indiscriminately,
  // including one whose own DECIDE phase had already genuinely run (`16` §16.8's own "a real cost
  // overrun caused only by the DECIDE-phase dispatch itself" case -- a real decision, and a real
  // KB/ADR/Risk write-back, already exist for it) -- resuming that state re-entered CONVERGE (its own
  // `clusters.length > 0`) and ran DECIDE a *second* time, appending a second, divergent decision and a
  // second write-back on top of the first rather than continuing anything. `resumeFrom.decisions.length
  // > 0` is the one real, structural signal that DECIDE already ran for real: refused outright, with no
  // partial/best-effort attempt to reconcile two decisions this module has no real merge rule for.
  if (resumeFrom !== undefined && resumeFrom.decisions.length > 0) {
    throw new ForgeError('RUN-072', { stepId: node.id });
  }

  const resuming = resumeFrom !== undefined;
  const resumeEntryPhase: 'DIVERGE' | 'CONVERGE' =
    resumeFrom !== undefined && resumeFrom.clusters.length > 0 ? 'CONVERGE' : 'DIVERGE';
  let state: SessionState =
    resumeFrom !== undefined
      ? { ...resumeFrom, phase: resumeEntryPhase, truncated: false, inconclusiveReason: undefined }
      : machine.start({ sessionType, participants });

  // FRAME -- no dispatch. `node.brief` is the one-sentence question `16` §16.3 step 1 asks for;
  // absent, an empty question is refused by `frame()` itself (`RUN-061`), the honest outcome for a
  // session step authored with no real question at all. Skipped entirely on a resume (see this
  // function's own `resumeFrom` doc comment above).
  //
  // On resume, a role that already has a real, recorded idea (`resumeFrom.ideas`, from the prior run's
  // own DIVERGE) is not re-dispatched -- a fresh critic round found an earlier draft always dispatched
  // the *entire* `agentRoles` roster on resume, regardless of who had already contributed, so every
  // role that answered before the original truncation got asked again and its new answer was appended
  // alongside the old one in `state.ideas`, producing real, duplicate/near-duplicate ideas from the
  // identical role. Only genuinely un-contributed roles are asked again -- the identical "retry only
  // who still needs to contribute" discipline this same function's own ordinary (non-resumed)
  // round-retry loop below already applies within a single run, extended here across the resume
  // boundary.
  const alreadyContributed = new Set(
    resumeFrom !== undefined ? resumeFrom.ideas.map((idea) => idea.proposedBy) : [],
  );
  let divergePerspectives: readonly string[] = agentRoles.filter(
    (role) => role !== CRITIC_ROLE && !alreadyContributed.has(role),
  );
  if (!resuming) {
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
    divergePerspectives = framed.directive.participants.filter((role) => role !== HUMAN_ROLE);
  }

  let endDiverge: { readonly state: SessionState; readonly directive: PhaseDirective };
  if (resuming && resumeEntryPhase === 'CONVERGE') {
    // Resuming straight into CONVERGE (the prior session already has real clusters) -- DIVERGE's own
    // block below never runs at all, matching this function's own top-of-file `resumeFrom` doc comment
    // ("DIVERGE's own real work is reused rather than re-run"). `dispatch-converge`'s own participants
    // are every real agent role, identical to `endDiverge()`'s own real directive shape on an ordinary,
    // non-resumed run that reaches CONVERGE normally.
    endDiverge = { state, directive: { kind: 'dispatch-converge', participants: agentRoles } };
  } else {
    // `16` §16.8's own "Max rounds per phase: DIVERGE 3" bound, made real: rather than always
    // re-dispatching every perspective `maxDivergeRounds` times regardless of outcome (which would
    // make every session — including every one this package's own test suite already exercises —
    // dispatch 3x by default, a real behavioural change this piece has no mandate to make), each round
    // after the first re-solicits *only* the perspectives whose immediately-preceding round genuinely
    // failed (`SessionResult.ok === false`) -- an ordinary round where every dispatched perspective
    // contributed something real converges after round 1, unchanged from this file's own prior
    // behaviour. A perspective still failing when the round cap is reached is the real "non-converging"
    // case `16` §16.8's own breach behaviour exists for.
    let pending = divergePerspectives;
    let divergeCappedDirective: PhaseDirective | undefined;
    let boundHit: SessionTruncationBound | undefined;
    for (let round = 1; pending.length > 0 && round <= bounds.maxDivergeRounds; round += 1) {
      const suffix = round === 1 ? 'diverge' : `diverge-${String(round)}`;
      const divergePhaseNode = phaseNode(node, suffix, facilitatorRole);
      const divergeOutcome = await dispatchAgentStep(divergePhaseNode, facilitator, ctx, 'panel', {
        perspectives: pending,
      });
      const roundIdeas: DivergeInput['ideas'][number][] = [];
      const stillFailed: string[] = [];
      for (const participant of divergeOutcome.participants ?? []) {
        trackCost(participant.session);
        // A crashed/timed-out participant session (`SessionResult.ok === false`) contributes nothing
        // real -- a fresh critic round found an earlier draft recorded its empty/garbage `finalText`
        // as a genuine idea anyway, indistinguishable from a real, thoughtful contribution once
        // merged.
        if (!participant.session.ok) {
          stillFailed.push(roleFromParticipant(participant));
          continue;
        }
        roundIdeas.push(ideaFrom(participant));
      }
      // The reconciliation lane `divergeOutcome.outcome` left behind is never used (this module reads
      // only `.participants`, per this file's own top-of-file doc comment) -- reclaimed immediately
      // rather than leaked for the rest of the run (`cleanupPhaseLane`'s own doc comment).
      await cleanupPhaseLane(ctx, divergePhaseNode.id);

      const divergeResult = machine.diverge(state, { ideas: roundIdeas });
      state = divergeResult.state;
      if (divergeResult.directive.kind === 'diverge-capped') {
        divergeCappedDirective = divergeResult.directive;
        break;
      }
      const breach = checkTimeAndCost();
      if (breach !== undefined) {
        boundHit = breach;
        break;
      }
      pending = stillFailed;
      if (pending.length > 0 && round >= bounds.maxDivergeRounds) {
        boundHit = 'diverge-rounds';
      }
    }

    if (divergeCappedDirective !== undefined) {
      // `16` §16.8's own idea-cap bound, named -- unlike `boundHit` below, this does *not* force
      // DECIDE to skip its own real dispatch (`ideaCapBound` is a record-label only, read back into
      // the final `truncatedBound` meta field further down, never checked as a control-flow gate the
      // way `truncatedBound` itself is): the idea cap forces early *clustering*, per `16` §16.3's own
      // "DIVERGE ended... CONVERGE may begin," not an early end to the whole session -- CONVERGE and
      // DECIDE still run their own real work afterward, exactly as this file's own behaviour was
      // before this piece (`machine.diverge()` already sets `state.truncated = true` for this case on
      // its own, independent of this variable).
      ideaCapBound = 'diverge-idea-cap';
      endDiverge = { state, directive: divergeCappedDirective };
    } else if (boundHit !== undefined) {
      truncatedBound = boundHit;
      state = machine.forceToDecide(state);
      endDiverge = { state, directive: { kind: 'dispatch-converge', participants: [] } };
    } else {
      const ended = machine.endDiverge(state);
      state = ended.state;
      endDiverge = { state, directive: ended.directive };
    }
  }

  // CONVERGE -- every agent participant, `critic` included this time (`16` §16.3 step 3's own "critic
  // is unmuted"). `human` is filtered here for the identical reason DIVERGE's own filter is -- see
  // that comment above; `16` §16.7 point 5's "enters at CONVERGE" describes the human's own real
  // position outranking agent output when a human supplies one, not a fabricated agent session
  // impersonating them (the real precedence rule this module implements is in DECIDE-input handling
  // below -- `DecideInput.humanDecision`'s own doc comment, `@forge/sessions`).
  //
  // Skipped entirely when DIVERGE already forced this session's early end (`truncatedBound` already
  // set): `16` §16.8's own "the facilitator forces convergence with what it has" applies at whichever
  // phase the bound actually fired in -- forcing CONVERGE to run anyway would both spend further real
  // cost/time past a bound that just fired to stop exactly that, and hand `machine.converge`/
  // `advanceToDecide` a `state` already moved past `CONVERGE` by `machine.forceToDecide` above,
  // which both assert the phase they expect and would throw `RUN-063` otherwise.
  if (truncatedBound === undefined) {
    const convergePerspectives = (
      endDiverge.directive.kind === 'dispatch-converge'
        ? endDiverge.directive.participants
        : participants.map((p) => p.role)
    ).filter((role) => role !== HUMAN_ROLE);
    // Keyed by role, not pushed as a flat array: `16` §16.8's own "Max rounds per phase: CONVERGE 2"
    // bound, made real the identical way DIVERGE's own round retry above is -- a role's own cluster
    // content never actually depends on which round produced it (always `divergeIdeas` filtered by
    // that same, fixed `proposedBy`), so keying by role is a real dedup, not merely a convenience;
    // `objectionsByRole` keeps each role's *latest* round's own text, the identical "last round wins"
    // treatment this file's own debate-mode handling already gives a multi-round contribution
    // (`criticFinalText`'s own doc comment, below). A fresh critic round already found and fixed the
    // identical duplicate-entry defect for debate rounds (`PLAN-M10.md` P11) -- keying by role here
    // closes the same defect class for this piece's own new per-phase panel round retries too.
    const clustersByRole = new Map<string, { readonly ideaIds: readonly string[] }>();
    const objectionsByRole = new Map<string, string>();
    let convergeTechniqueId: string | undefined;
    const sessionHasCritic = participants.some((participant) => participant.role === CRITIC_ROLE);

    if (convergePerspectives.length > 0) {
      for (let round = 1; round <= bounds.maxConvergeRounds; round += 1) {
        const suffix = round === 1 ? 'converge' : `converge-${String(round)}`;
        const convergePhaseNode = phaseNode(node, suffix, facilitatorRole);

        // `16` §16.7 point 3 -- `tradeoff` sessions run CONVERGE's own first round as a real
        // `debate`-mode dispatch, seeded with the real `steel-man-debate` technique's own prompt,
        // instead of `panel` mode -- but only when this project actually has that technique installed
        // and a real, non-critic role to dispatch as its proposer (`loadSteelManTechnique`'s own doc
        // comment has the fallback reasoning for either condition failing). Only round 1: `debate`
        // mode's own `maxDebateRounds: 2` already spends the full `16` §16.8 CONVERGE round budget
        // inside that one dispatch call: a genuinely non-converging steel-man session (the debate's own
        // two internal rounds both end in a generic non-objection) degrades to this loop's own ordinary
        // per-round panel retries from round 2 onward, the same path every other session type uses.
        const nonCriticRole = convergePerspectives.find((role) => role !== CRITIC_ROLE);
        const wantsSteelMan = round === 1 && STEEL_MAN_SESSION_TYPES.has(sessionType);
        const steelManTechnique = wantsSteelMan ? await loadSteelManTechnique(ctx) : undefined;
        // `PLAN-M14.md` P29's own visible degrade (`sessionNotes`'s own doc comment above): a
        // `tradeoff` session's round 1 genuinely wanted the real `steel-man-debate` technique and found
        // none under `.forge/techniques/` -- recorded here, once, regardless of whether a real proposer
        // agent is *also* missing (checked separately below): the missing technique is its own real,
        // independently disclosable fact.
        if (wantsSteelMan && steelManTechnique === undefined) {
          sessionNotes.push(
            `Technique ${JSON.stringify(STEEL_MAN_TECHNIQUE_ID)} not found under ` +
              `${ctx.techniquesRoot ?? DEFAULT_TECHNIQUES_ROOT}; CONVERGE ran as ordinary panel ` +
              'instead of steel-man debate.',
          );
        }
        // A fresh critic round found an earlier draft fell back to the neutral `facilitator` agent as
        // the debate's own proposer whenever `nonCriticRole` had no real, registered `AgentDefinition`,
        // then still labelled that facilitator-authored content as `nonCriticRole` in the record --
        // both a real violation of the facilitator's own "contributes no content of its own" invariant
        // (this file's own top-of-file doc comment) and a mislabelled authorship. `useDebate` now
        // requires a real, registered proposer agent outright; without one, CONVERGE degrades to
        // ordinary `panel` mode instead, the identical "a real fallback, not a crash" choice
        // `loadSteelManTechnique`'s own doc comment already makes for a missing technique.
        const proposerAgent = nonCriticRole === undefined ? undefined : registry.get(nonCriticRole);
        const useDebate = steelManTechnique !== undefined && proposerAgent !== undefined;
        if (useDebate) convergeTechniqueId = steelManTechnique.id;

        // Round 1 always dispatches every perspective (identical to this file's own behaviour before
        // this piece's own round-retry loop, so no existing test's own round-1 stepId assertions
        // change). Round 2+ re-solicits only the roles that have not yet produced a usable, recorded
        // contribution -- `critic` until it has a real objection, any other role until it has a
        // cluster entry -- the identical "retry only who still needs to contribute" design DIVERGE's
        // own round-retry loop above already uses, rather than re-dispatching the full cohort (and
        // spending the full cohort's own real cost) purely to give one already-satisfied role another,
        // unneeded turn.
        const roundPerspectives =
          round === 1
            ? convergePerspectives
            : convergePerspectives.filter((role) =>
                role === CRITIC_ROLE
                  ? !objectionsByRole.has(CRITIC_ROLE)
                  : !clustersByRole.has(role),
              );

        const convergeOutcome =
          useDebate && nonCriticRole !== undefined
            ? await dispatchAgentStep(
                convergePhaseNode,
                proposerAgent,
                ctx,
                'debate',
                // `16` §16.8's own "Max rounds per phase: ... CONVERGE 2" bound.
                { maxDebateRounds: 2, steelManRequirement: steelManTechnique.prompt },
              )
            : await dispatchAgentStep(convergePhaseNode, facilitator, ctx, 'panel', {
                perspectives: roundPerspectives,
              });

        let criticFinalText: string | undefined;
        // The *last* round's own text when debate ran more than one round -- deferred to after this
        // loop (rather than recorded immediately) so the generic-non-objection re-prompt below can
        // still act on it before it becomes this round's own real, recorded objection.
        let proposerFinalText: string | undefined;
        for (const participant of convergeOutcome.participants ?? []) {
          trackCost(participant.session);
          // Identical reasoning to DIVERGE's own filter above -- a failed `critic` session must never
          // count as a real, structural objection (`16` §16.7 point 2's own gate, `advanceToDecide`
          // below), and a failed non-critic session must never seed a cluster from empty/garbage text.
          if (!participant.session.ok) continue;
          const role =
            useDebate && nonCriticRole !== undefined
              ? roleFromDebateParticipant(participant.role, nonCriticRole)
              : roleFromParticipant(participant);
          if (role === CRITIC_ROLE) {
            criticFinalText = participant.session.finalText;
          } else if (useDebate) {
            proposerFinalText = participant.session.finalText;
          } else {
            clustersByRole.set(role, {
              // `state.ideas` (not a locally-reconstructed array) is the one authoritative source of
              // real `IDEA-###` ids -- assigned by `machine.diverge()` itself, across however many real
              // rounds this piece's own DIVERGE retry loop above actually ran.
              ideaIds: state.ideas
                .filter((idea) => idea.proposedBy === role)
                .map((idea) => idea.id),
            });
            // `16` §16.7 point 4's own real, counted signal: a non-critic participant's own real
            // disagreement counts too, not only critic's structural objection -- most real session
            // types (`16` §16.2's own table) carry no `critic` participant at all
            // (`expressesDisagreement`'s own doc comment has the fuller reasoning for why this
            // matters).
            if (expressesDisagreement(participant.session.finalText)) {
              objectionsByRole.set(role, participant.session.finalText);
            }
          }
        }
        if (useDebate && nonCriticRole !== undefined && proposerFinalText !== undefined) {
          clustersByRole.set(nonCriticRole, {
            ideaIds: state.ideas
              .filter((idea) => idea.proposedBy === nonCriticRole)
              .map((idea) => idea.id),
          });
          if (expressesDisagreement(proposerFinalText)) {
            objectionsByRole.set(nonCriticRole, proposerFinalText);
          }
        }

        // `16` §16.7 point 2's own facilitator-enforced mandate: "'this seems fine' is not an
        // acceptable contribution and is rejected by the facilitator" -- rejected and re-prompted
        // exactly once per round before being accepted regardless of what the second attempt says
        // (`isGenericNonObjection`'s own doc comment: this is a real, mechanical proxy, not a judge of
        // whether the second attempt is any good). `isGenericNonObjection` also matches a bare debate
        // "CONCEDE" (its own pattern list) -- a fresh critic round found an earlier draft recorded a
        // debate concession verbatim as a real objection, the exact "theatre" measure 4 exists to
        // catch, given `no_disagreement_observed` (`assembleSessionRecord`) reads `state.objections`
        // directly.
        if (criticFinalText !== undefined && isGenericNonObjection(criticFinalText)) {
          const reprompt = await runParticipantSession(
            convergePhaseNode,
            ctx,
            facilitator,
            'critic-reprompt',
            `You are framing this re-ask on ${CRITIC_ROLE}'s own behalf.\n\nThe prior CONVERGE contribution (given in the user message, fenced as untrusted data) is a ` +
              'generic non-objection. 16 §16.7 point 2 does not accept a "this seems fine"-shaped response ' +
              'as a real contribution. State one concrete, falsifiable objection to the proposal under ' +
              'discussion -- or, if none genuinely exists, say precisely and specifically why not, rather ' +
              'than a generic assurance.',
            {
              untrustedInput: wrapUntrustedContent(
                criticFinalText,
                'forge-session-critic-contribution',
              ).wrapped,
            },
          );
          // A fresh critic round found an earlier draft left `criticFinalText` at its own original,
          // already-rejected generic text when the re-prompt session itself failed (`ok: false`) --
          // resurrecting a real failure into a fabricated, accepted contribution, the identical class
          // of bug this file's own DIVERGE/CONVERGE participant loops already guard against for every
          // other failed session. `undefined` here is the honest "critic contributed nothing usable"
          // outcome for this round.
          criticFinalText = reprompt.ok ? reprompt.finalText : undefined;
        }
        if (criticFinalText !== undefined) {
          objectionsByRole.set(CRITIC_ROLE, criticFinalText);
        }

        // Identical reasoning to DIVERGE's own cleanup above.
        await cleanupPhaseLane(ctx, convergePhaseNode.id);

        const breach = checkTimeAndCost();
        if (breach !== undefined) {
          truncatedBound = breach;
          break;
        }
        // `16` §16.7 point 2's own real, structural completion signal: CONVERGE is done exactly when
        // either no `critic` participates at all, or `critic` has produced a real, recorded objection
        // (`advanceToDecide`'s own identical gate, `@forge/sessions`) -- an ordinary session where
        // `critic` objects (directly, or after one reprompt) by round 1 stops here, unchanged from this
        // file's own behaviour before this piece. A `critic` that never produces one despite every
        // round's own reprompt is the real "non-converging" case `16` §16.8's own round cap exists for.
        if (!sessionHasCritic || objectionsByRole.has(CRITIC_ROLE)) break;
        if (round >= bounds.maxConvergeRounds) {
          truncatedBound = 'converge-rounds';
          break;
        }
      }
    }

    const convergeResult = machine.converge(state, {
      clusters: [...clustersByRole.entries()].map(([label, cluster]) => ({ label, ...cluster })),
      objections: [...objectionsByRole.entries()].map(([by, text]) => ({ by, text })),
      ...(convergeTechniqueId === undefined ? {} : { techniqueId: convergeTechniqueId }),
    });
    state = convergeResult.state;

    if (truncatedBound !== undefined) {
      state = machine.forceToDecide(state);
    } else {
      const advance = machine.advanceToDecide(state);
      state = advance.state;
      if (advance.directive.kind === 'converge-refused') {
        // `sessionNotes` threaded through here too (`PLAN-M14.md` P29): not known to be reachable
        // through this loop's own round-by-round branching as it stands today (the identical "no
        // critic, or critic objected" condition that would let `advanceToDecide` accept CONVERGE is
        // exactly the condition this loop's own `break` above already requires before it ever calls
        // `advanceToDecide` at all) -- kept defensive rather than assumed unreachable, since
        // `advanceToDecide` is `@forge/sessions`' own general-purpose gate, not owned by this loop, and
        // a future change to either side must not silently drop a real, already-computed note.
        return domainRefusalOutcome(
          node.id,
          startedAt,
          ctx.now(),
          advance.directive.error,
          sessionNotes,
        );
      }
    }
  }

  // DECIDE -- solo dispatch to the resolved owner, or a real human-input request if none resolves.
  // Skipped entirely once `truncatedBound` is set: `16` §16.8's own "forces convergence with what it
  // has" -- spending a further real dispatch (and further real cost/time) after a hard bound has
  // already fired would defeat the bound's own purpose. The session still reaches a real, honest
  // record (`inconclusive` in substance, `truncated` in `status` -- `assemble.ts`'s own
  // `resolveStatus` gives `truncated` precedence), never a fabricated decision.
  //
  // `16` §16.3 step 1's own real, one-sentence framed question -- FRAME never dispatches (this file's
  // own top-of-file doc comment), so `state.framing.question` is always `node.brief` verbatim on a
  // fresh (non-resumed) run; a resumed run carries the prior run's own real framing forward instead
  // (`resumeFrom`'s own doc comment above). `resolveDecisionOwner` reads this same text to find which
  // candidate's own `decisions_owned` topic it actually names (`PLAN-M14.md` P32).
  const framedQuestion = state.framing?.question ?? node.brief ?? '';
  const resolution = resolveDecisionOwner(agentRoles, facilitatorRole, registry, framedQuestion);
  let decideSession: SessionResult = NO_AGENT_SESSION;
  let decideInput: DecideInput;
  // Set only when the DECIDE-phase dispatch itself genuinely failed (a crashed/timed-out adapter
  // session, or a lane/commit failure inside `runAgentStep`) -- distinct from the human-fallback path
  // above, which is not a failure at all, only an honest "nobody here owns this."
  let decideFailure: StepOutcome['failure'];
  if (truncatedBound !== undefined) {
    decideInput = {
      inconclusiveReason:
        `Session truncated: the '${truncatedBound}' bound (16 §16.8) was reached before DECIDE could ` +
        'run; no decision was fabricated from a session the facilitator was forced to cut short.',
    };
  } else if (humanInput !== undefined) {
    // `16` §16.7 point 5's own "outranks" rule, made real: the human's own supplied position wins
    // outright, whether or not an agent owner would otherwise have resolved -- no agent DECIDE
    // dispatch runs at all (a real, honest saving against `16` §16.8's own cost/time bounds, not merely
    // a shortcut), and `machine.decide`'s own `humanDecision` override (`@forge/sessions`) is what
    // actually enforces the "not equally authoritative" precedence, not this branch's own ordering
    // alone.
    //
    // `writeDecisionBack`'s own idempotency (a KB entry already at this deterministic path is reused
    // by id, not overwritten -- see its own doc comment) was designed against a retried/resumed run of
    // the *same* decision text; it is not content-aware. A real, disclosed edge case this piece does
    // not close: resuming a session step whose agent-authored decision was already written, then
    // supplying a *different* `humanInput.decision` on that resume, reuses the stale KB entry's id
    // rather than writing the human's own new text -- the persisted record's own decision text and its
    // `artifactRef` target would then disagree. No real call site in this milestone's own scope
    // reaches this (`HumanSessionInput`'s own doc comment: no caller populates it yet), so this is
    // recorded here rather than reworked -- reworking `writeDecisionBack`'s own shared idempotency
    // contract would also change the already-tested agent-decision retry path. See `SPEC-QUESTIONS.md`.
    const artifactRef = await writeSessionArtifactBack(
      ctx,
      sessionType,
      SESSION_TYPE_DEFAULTS[sessionType].kbSection,
      node,
      humanInput.owner ?? HUMAN_ROLE,
      humanInput.decision,
      clock,
    );
    decideInput = {
      humanDecision: {
        decision: humanInput.decision,
        owner: humanInput.owner ?? HUMAN_ROLE,
        artifactRef,
      },
    };
  } else if (resolution === undefined) {
    await ctx.telemetry.emit({
      type: 'ElicitationRequested',
      stepId: node.id,
      payload: {
        reason:
          'DECIDE-phase owner unresolved: no participant agent both exists in the project ' +
          'roster and declares a decisions_owned entry.',
        question: framedQuestion,
      },
    });
    decideInput = {
      inconclusiveReason:
        'No agent participant resolved as a decisions_owned decision owner; a human decision was ' +
        'requested (see the ElicitationRequested event for this step) but the session could not ' +
        'wait for it synchronously.',
    };
  } else {
    const { owner, topic } = resolution;
    // `topic` names the one real `decisions_owned` entry the framed question actually matched
    // (`resolveDecisionOwner`'s own doc comment); `undefined` on the fallback path, where the owner was
    // picked by roster order alone and the brief must not claim the question named anything of theirs.
    const topicClause =
      topic === undefined
        ? ''
        : ` The framed question names your own "${topic}" topic directly, which is why you rule here.`;
    const deciderNode: StepNode = {
      ...phaseNode(node, 'decide', owner.id),
      brief:
        `${node.brief ?? ''}\n\nYou are ${owner.name}, the resolved decision owner for this ` +
        `${sessionType} session (decisions_owned: ${owner.decisions_owned.join(', ')}).${topicClause} ` +
        'Rule on the framed question and state your decision in one clear paragraph.',
    };
    const decideOutcome = await dispatchAgentStep(deciderNode, owner, ctx, 'solo');
    decideSession =
      decideOutcome.outcome.detail.kind === 'agent'
        ? decideOutcome.outcome.detail.session
        : decideSession;
    trackCost(decideSession);
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
      const artifactRef = await writeSessionArtifactBack(
        ctx,
        sessionType,
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

  // `16` §16.8's own cost/wall-clock bounds apply to the *whole* session, not only to DIVERGE/CONVERGE
  // -- a fresh critic round found an earlier draft only ever checked `checkTimeAndCost()` inside those
  // two phases' own round loops, so a real, expensive DECIDE-phase dispatch (`trackCost(decideSession)`
  // above) could push the session's own real, tracked cost or wall clock past its configured bound
  // with nothing in the final record ever reflecting it -- a real bound breach silently reported as an
  // ordinary `complete` success. Checked once more here, after every real dispatch this run could ever
  // make has already happened: too late to skip DECIDE's own dispatch (it already ran, and its real
  // decision/write-back is not discarded merely because the very call that produced it also tipped the
  // session over budget), but not too late to record the truth about it.
  if (truncatedBound === undefined) {
    const finalBreach = checkTimeAndCost();
    if (finalBreach !== undefined) {
      truncatedBound = finalBreach;
      state = { ...state, truncated: true };
    }
  }

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
      // The real, tracked figure this run actually accumulated (`estimateSessionCostUsd`'s own doc
      // comment) -- no longer the disclosed, hardcoded `0` this file carried before `PLAN-M10.md` P12.
      costUsd,
      ended: endedIso,
      // `truncatedBound` (a round-cap/cost/wall-clock breach) takes precedence when both fired during
      // the same run -- it is always the more specific, more recent reason; `ideaCapBound` is only the
      // fallback label for a session truncated solely by DIVERGE's own idea cap.
      ...(truncatedBound === undefined
        ? ideaCapBound === undefined
          ? {}
          : { truncatedBound: ideaCapBound }
        : { truncatedBound }),
    });
    await persistSessionRecord(ctx, assembled, state, sessionNotes);
    return assembled;
  });

  const outcome: StepOutcome = {
    stepId: node.id,
    status: decideFailure === undefined ? 'succeeded' : 'failed',
    startedAt,
    finishedAt,
    detail: { kind: 'agent', session: decideSession },
    ...(decideFailure === undefined ? {} : { failure: decideFailure }),
    ...(sessionNotes.length === 0 ? {} : { notes: sessionNotes }),
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
