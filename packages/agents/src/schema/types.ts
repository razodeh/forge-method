/**
 * `AgentDefinition` — `05` §5.3's own full agent-definition YAML shape, verbatim (the full worked
 * `architect` example names every field this type declares). Distinct from `@forge/extensions/agents`'
 * own *overlay* schema (M2 P3), which validates only a partial document layered on top of this one --
 * this is the *complete base document* schema.
 *
 * @see specs/05 §5.3
 * @see PLAN-M6.md A1
 */
import type { ToolGrant } from '@forge/extensions/agents';

// `ToolGrant`'s own optional fields are written `x?: T` (no explicit `| undefined`); this project's own
// `exactOptionalPropertyTypes` setting treats that as strictly narrower than a zod `.optional()`
// field's inferred `x?: T | undefined` -- reusing `ToolGrant` directly as `AgentCeiling.tools`'s type
// fails to structurally match `agentDefinitionSchema`'s own zod-inferred output for exactly that reason.
// A field-for-field-identical local type, written with this codebase's own zod-paired-type convention
// (explicit `| undefined`), avoids fighting that mismatch while keeping the two conceptually the same
// shape -- `CeilingToolGrant`'s own fields are asserted equal to `ToolGrant`'s by a dedicated test.
export type CeilingToolGrant = {
  readonly [K in keyof ToolGrant]?: ToolGrant[K] | undefined;
};

export interface AgentPersona {
  readonly voice: string;
  readonly stance: string;
  readonly disagreement_style: string;
}

/** `05` §5.3's own worked example writes each input as exactly one of `artifact: X` or `kb: Y` -- a
 * real discriminated shape, not two independent optional fields on one object. */
export type AgentInputRef = { readonly artifact: string } | { readonly kb: string };

export interface AgentInputs {
  readonly required: readonly AgentInputRef[];
  readonly optional?: readonly AgentInputRef[] | undefined;
}

export type AgentOutputCardinality = 'single' | 'many';

export interface AgentOutput {
  readonly type: string;
  readonly schema: string;
  readonly path: string;
  readonly cardinality?: AgentOutputCardinality | undefined;
}

export type GitCommitGrant = 'none' | 'docs-only' | 'lane' | 'full';

/** The base document's own `tools` block -- distinct from `ceiling.tools` (see below), which reuses
 * `@forge/extensions/agents`'s own `ToolGrant` directly, since a ceiling *is* that same "tool grant"
 * concept (`15` §15.3.2). This block has two fields `ToolGrant` doesn't (`read`, `git_commit`) and one
 * real, load-bearing spec inconsistency `ToolGrant` does not share: `05` §5.3's own worked example
 * writes the base document's own `tools.network` as a bare boolean (`network: false`), but the
 * identically-named `ceiling.tools.network` two dozen lines later as `ToolGrant`'s own three-value
 * string enum (`network: none`) -- in the same worked example, for the same conceptual field. Recorded
 * in `SPEC-QUESTIONS.md` rather than silently normalized away: this schema accepts both forms here
 * (`boolean | 'none' | 'allowlist' | 'full'`), matching what the worked example itself actually
 * contains, and does not force every future agent YAML file toward one representation the spec's own
 * canonical example doesn't itself use consistently. */
export interface AgentToolGrant {
  readonly read: boolean;
  readonly write: boolean;
  readonly exec?: readonly string[] | undefined;
  readonly network: boolean | 'none' | 'allowlist' | 'full';
  readonly git_commit: GitCommitGrant;
  readonly deploy: boolean;
}

export type ModelTier = 'frugal' | 'balanced' | 'max';
export type ThinkingLevel = 'none' | 'low' | 'medium' | 'high';

export interface AgentModel {
  readonly tier: ModelTier;
  readonly thinking: ThinkingLevel;
}

export interface AgentLimits {
  readonly max_turns: number;
  readonly wall_clock_ms: number;
  readonly max_cost_usd: number;
}

export interface AgentParallelSafety {
  readonly file_ownership: readonly string[];
  readonly exclusive: boolean;
}

export interface AgentGates {
  readonly produces_evidence_for: readonly string[];
  readonly may_approve: readonly string[];
}

export interface AgentMcpGrant {
  readonly server: string;
  readonly tools: readonly string[];
}

export interface AgentCeiling {
  readonly tools: CeilingToolGrant;
}

export interface AgentPrompt {
  readonly system: string;
  readonly briefs?: Readonly<Record<string, string>> | undefined;
}

export interface AgentDefinition {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly tier: string;
  readonly extends?: string | undefined;
  readonly mandate: string;
  readonly decisions_owned: readonly string[];
  readonly persona: AgentPersona;
  readonly inputs: AgentInputs;
  readonly outputs: readonly AgentOutput[];
  readonly kb_write: readonly string[];
  readonly kb_propose?: readonly string[] | undefined;
  readonly tools: AgentToolGrant;
  readonly model: AgentModel;
  readonly limits: AgentLimits;
  readonly parallel_safety: AgentParallelSafety;
  readonly gates: AgentGates;
  readonly frameworks?: readonly string[] | undefined;
  readonly skills?: readonly string[] | undefined;
  readonly mcp?: readonly AgentMcpGrant[] | undefined;
  readonly ceiling?: AgentCeiling | undefined;
  readonly prompt: AgentPrompt;
}

export interface AgentIssue {
  readonly path: string;
  readonly message: string;
}

export type AgentParseResult =
  | { readonly success: true; readonly agent: AgentDefinition }
  | { readonly success: false; readonly issues: readonly AgentIssue[] };
