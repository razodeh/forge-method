/**
 * `loadAgentDefinition` — parses and validates one agent definition document, never throwing on
 * ordinary malformed input.
 *
 * @see specs/05 §5.3
 * @see PLAN-M6.md A1
 */
import { readTextFile, type ProjectPaths } from '@forge/core';
import { parse as parseYaml } from 'yaml';

import { agentDefinitionSchema } from './schema.ts';
import type { AgentDefinition, AgentIssue, AgentParseResult } from './types.ts';

function zodIssuesToAgentIssues(
  issues: readonly { readonly path: readonly (string | number)[]; readonly message: string }[],
): readonly AgentIssue[] {
  return issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

function withSourceContext(
  issues: readonly AgentIssue[],
  sourcePath: string,
): readonly AgentIssue[] {
  return issues.map((issue) => ({ ...issue, message: `${sourcePath}: ${issue.message}` }));
}

/** `05` §5.2's own roster rule: "`pm`/`po` cannot approve engineering gates; `architect`/`platform`
 * cannot approve product gates." Checkable here only in the narrow, load-time-static sense the plan's
 * own Checks section describes: this piece has no registry of which gate ids are "engineering" vs.
 * "product" (that's `10` §10.3's own gate catalog, a `@forge/templates` concern this package has no
 * edge to at load time), so the check is scoped to what a single document can prove about itself --
 * `pm`/`po` never declaring `may_approve` containing an id this file cannot itself classify is not
 * checkable here; instead this enforces the one part *is* checkable per-document: `architect`
 * specifically never approves anything (05 §5.3's own worked example: `may_approve: []`, with its own
 * comment "architects never self-approve their own gate"). A fuller cross-check against the real gate
 * catalog belongs to whichever later piece has both a full roster and a full gate catalog loaded
 * together. */
function checkArchitectNeverApproves(agent: AgentDefinition): readonly AgentIssue[] {
  if (agent.id === 'architect' && agent.gates.may_approve.length > 0) {
    return [
      {
        path: 'gates.may_approve',
        message:
          '"architect" must never self-approve a gate (05 §5.2\'s own roster rule) -- may_approve must be empty.',
      },
    ];
  }
  return [];
}

/** `05` §5.2's own separation-of-duties rule ("`reviewer`, `critic`, `diagnostician`, `test-architect`
 * MUST never be the same session instance as the author"): the *runtime* half (an actual step's actual
 * assigned agent instance) is a later piece's job (`05` §5.3's own worked-example checks list splits
 * this explicitly: "the runtime half... is piece A5's job, not this one's"). The load-time *shape* half
 * checkable here: `reviewer`/`critic` specifically should never declare an `outputs` entry shaped like
 * primary implementation work (a `type` this file can recognise as code/implementation, as opposed to a
 * review/report/record artifact) -- a real, if narrow, static signal that a review-shaped role's own
 * document hasn't been authored as if it were also the implementer.
 *
 * `diagnostician`/`test-architect`/`critic` are deliberately excluded from this check, not merely an
 * oversight: `05` §5.2's own roster table lists `diagnostician`'s own primary outputs as "RCA record,
 * **failing test**, fix plan," `critic`'s as "Objection list with severity **+ test**," and `sdet`'s (a
 * role this rule doesn't even name) as "Test code, harness, flake report" -- a failing test proving a
 * bug, or a falsifying test backing an objection, is legitimately code-shaped output for exactly the
 * roles this rule exists to keep honest, not a violation of it. A first version of this check included
 * all four named roles, which a fresh critic round caught as a real false-positive risk against
 * `diagnostician`'s own literal roster-table wording; re-checking every other named role's own outputs
 * column against the same risk (no agent YAML for any of them exists yet to have actually hit it) found
 * `critic`'s "+ test" carries the identical ambiguity. Narrowed to the one role, `reviewer`, whose own
 * roster-table output ("Review report, blocking findings") never plausibly includes implementation
 * code itself. */
const REVIEW_SHAPED_ROLES = new Set(['reviewer']);
const IMPLEMENTATION_OUTPUT_TYPES = new Set(['Code', 'Component']);

function checkReviewRoleShape(agent: AgentDefinition): readonly AgentIssue[] {
  if (!REVIEW_SHAPED_ROLES.has(agent.id)) return [];
  const implementationOutput = agent.outputs.find((output) =>
    IMPLEMENTATION_OUTPUT_TYPES.has(output.type),
  );
  if (implementationOutput === undefined) return [];
  return [
    {
      path: 'outputs',
      message: `"${agent.id}" is a review role (05 §5.2's own separation-of-duties rule) but declares an implementation-shaped output ("${implementationOutput.type}") -- a static shape mismatch this load-time check catches; the runtime half of this rule is enforced elsewhere.`,
    },
  ];
}

function semanticIssues(agent: AgentDefinition): readonly AgentIssue[] {
  return [...checkArchitectNeverApproves(agent), ...checkReviewRoleShape(agent)];
}

/** Never throws: a YAML syntax error, a zod schema violation, and every `semanticIssues` finding all
 * become entries in the same returned `issues` list, matching `@forge/methods/schema`'s own
 * `loadFramework` precedent (M6 M1). */
export function loadAgentDefinition(source: string, sourcePath: string): AgentParseResult {
  let parsedYaml: unknown;
  try {
    parsedYaml = parseYaml(source);
  } catch (cause) {
    return {
      success: false,
      issues: withSourceContext(
        [{ path: '(root)', message: cause instanceof Error ? cause.message : String(cause) }],
        sourcePath,
      ),
    };
  }

  const result = agentDefinitionSchema.safeParse(parsedYaml);
  if (!result.success) {
    return {
      success: false,
      issues: withSourceContext(zodIssuesToAgentIssues(result.error.issues), sourcePath),
    };
  }

  const agent = result.data;
  const issues = semanticIssues(agent);
  if (issues.length > 0) return { success: false, issues: withSourceContext(issues, sourcePath) };

  return { success: true, agent };
}

export async function readAgentDefinition(
  paths: ProjectPaths,
  relative: string,
): Promise<AgentParseResult> {
  const absolute = paths.resolveWithin(relative);
  const source = await readTextFile(absolute);
  return loadAgentDefinition(source, relative);
}
