/**
 * Shared types for `@forge/extensions/invariants` — `15` §15.10's twelve compile-time invariants.
 *
 * @see specs/15 §15.10
 * @see PLAN-M2.md P8
 * @see SPEC-QUESTIONS.md Q40
 */
import type { ForgeErrorCode } from '@forge/core';
import type { Escalation, ProjectLevel, ToolGrant } from '../agents/index.ts';
import type { CustomAgent, RosterConfig } from '../agents/index.ts';
import type { EdgeKind } from '@forge/core';

export type InvariantId =
  'I1' | 'I2' | 'I3' | 'I4' | 'I5' | 'I6' | 'I7' | 'I8' | 'I9' | 'I10' | 'I11' | 'I12';

export interface InvariantViolation {
  readonly id: InvariantId;
  readonly code: ForgeErrorCode;
  readonly message: string;
}

/**
 * I1: a resolved output and who is assigned to review/critique/diagnose it. `producerAgent` and
 * `reviewerAgent` are already-resolved agent identities (not roles) — whether they are the same
 * agent is exactly what "reviews its own output" means at compile time. `reviewerRole` covers all
 * four of `05` §5.2's own separation-of-duties roles ("`reviewer`, `critic`, `diagnostician`, and
 * `test-architect` MUST never be the same session instance as the author of the work under review")
 * — `test-architect` included even though I2 owns the narrower, dedicated red/green-agent check,
 * since a `test-architect` reviewing its own prior test-strategy output is still a real I1 scenario.
 */
export interface OutputReviewAssignment {
  readonly outputId: string;
  readonly producerAgent: string;
  readonly reviewerAgent: string;
  readonly reviewerRole: 'reviewer' | 'critic' | 'diagnostician' | 'test-architect';
}

/** I2: a story's test-authoring and implementation assignment, plus each side's file scope. */
export interface TestImplementationAssignment {
  readonly storyId: string;
  readonly testAuthorAgent: string;
  readonly implementerAgent: string;
  readonly implementerFileOwnership: readonly string[];
  readonly testPaths: readonly string[];
}

/** I3, I4: one gate's own check configuration. */
export interface GateConfig {
  readonly gateId: string;
  /** Every deterministic check ids attached to this gate at all. */
  readonly checkIds: readonly string[];
  /** The subset of `checkIds` the gate's own config marks required for approval. */
  readonly requiredCheckIds: readonly string[];
  /** The subset of `checkIds` currently disabled (e.g. by an overlay). */
  readonly disabledCheckIds: readonly string[];
}

/** I5: a gate's base autonomy versus what an overlay would resolve it to. */
export interface GateAutonomyOverride {
  readonly gateId: string;
  readonly baseAutonomy: string;
  readonly overlayAutonomy: string;
}

/** I6: one `09` §9.4 edge rule an overlay attempted to disable, identified the same way `REQUIRED_EDGES` rows are: `from`/`edge`/`to`. */
export interface DisabledTraceabilityEdge {
  readonly from: string;
  readonly edge: EdgeKind;
  readonly to: string;
}

/** I7: one resolved agent's requested tool grant, ready for `@forge/extensions/agents`' own `checkToolCeiling`. */
export interface ToolCeilingCheckInput {
  readonly agentId: string;
  readonly roleTags: { readonly isReviewOrCritic: boolean; readonly isOps: boolean };
  readonly ceiling: ToolGrant;
  readonly requested: ToolGrant;
  readonly escalations: readonly Escalation[];
}

/** I8, I9: one piece of resolved content to scan for secret-shaped literals and injection patterns. */
export interface ScanTarget {
  readonly location: string;
  readonly text: string;
}

/** I10: whether an overlay has left these three subsystems enabled. */
export interface ObservabilityConfig {
  readonly eventLogEnabled: boolean;
  readonly costLedgerEnabled: boolean;
  readonly auditTrailEnabled: boolean;
}

/**
 * The whole-resolved-set input `runInvariants` checks — every field optional, since a caller may
 * supply only the specific overlay slice a given invariant needs (`PLAN-M2.md` P8's own Mandate) or
 * the full set once a real compile pipeline (P9) assembles one. An absent field skips exactly the
 * invariant(s) it feeds, never a false pass reported as if it were checked.
 */
export interface ResolvedSet {
  readonly outputReviewAssignments?: readonly OutputReviewAssignment[];
  readonly testImplementationAssignments?: readonly TestImplementationAssignment[];
  readonly gateConfigs?: readonly GateConfig[];
  readonly gateAutonomyOverrides?: readonly GateAutonomyOverride[];
  readonly disabledTraceabilityEdges?: readonly DisabledTraceabilityEdge[];
  readonly toolCeilingChecks?: readonly ToolCeilingCheckInput[];
  readonly scanTargets?: readonly ScanTarget[];
  readonly observability?: ObservabilityConfig;
  readonly customAgents?: readonly CustomAgent[];
  readonly roster?: RosterConfig;
  readonly currentLevel?: ProjectLevel;
}
