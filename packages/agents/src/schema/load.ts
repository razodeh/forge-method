/**
 * `loadAgentDefinition` — parses and validates one agent definition document, never throwing on
 * ordinary malformed input.
 *
 * @see specs/05 §5.3
 * @see PLAN-M6.md A1
 */
import { readTextFile, type ProjectPaths } from '@forge/core';
import { ARTIFACT_SCHEMAS } from '@forge/schemas/json-schema';
import { artifactTypeById, registryTail } from '@forge/schemas/registry';
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
const IMPLEMENTATION_OUTPUT_TYPES: ReadonlySet<string> = new Set(['Code', 'Component']);

/**
 * Whether `agent` is an implementation role: one that declares an output that is source code (`Code`, `Component`)
 * rather than a document, report or record (`PLAN-M13.md` P36). The only roles a Story's `owner_role` may name:
 * `implement-story`'s `plan`/`green`/`refactor`/`document` steps run as `{{ownerRole}}` with the agent's own write
 * grant, so an owner that authors documents (`analyst`, `pm`, `security`, ...) or judges work (`reviewer`, `sdet`)
 * would write a story's source. Derived from the definitions, never a hard-coded list: a project's own implementer
 * (a `mobile` role, a custom `rust-engineer`) counts the moment it declares a `Code` output.
 */
export function isImplementationAgent(agent: Pick<AgentDefinition, 'outputs'>): boolean {
  return agent.outputs.some((output) => IMPLEMENTATION_OUTPUT_TYPES.has(output.type));
}

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

/**
 * `outputs[]` entries whose `type` is a core-registry type (`artifactTypeById`, `18` §18.7) but whose
 * `schema`, `path` or `cardinality` disagrees with what the registry demands (`PLAN-M14.md` P33):
 *
 * - `schema` must be `ARTIFACT_SCHEMAS[type].fileStem + '.schema.json'` -- the emitted schema file for
 *   that type (`json-schema/emit.ts`), never a hand-picked or copy-pasted name.
 * - `path` must END WITH `registryTail(type)` (`@forge/schemas/registry`) AT A PATH-SEGMENT BOUNDARY
 *   (`endsWithTail`, below; matching the tail itself, or preceded by `/`) -- the type's own path
 *   template, placeholders turned into glob fragments, its literal section-root segment dropped where
 *   that still leaves a specific suffix. Root-agnostic FOR THE 15 TYPES whose tail keeps no literal
 *   root word (an interior directory already gives the suffix its own specificity, independent of
 *   whichever value a project configures for that section): this loader has no project configuration
 *   to resolve a configured root against (unlike `outputGlob`, `@forge/engine`, which builds the full
 *   configured-root glob on top of the same tail), so it can only check that much of the path. For the
 *   other 7 (`registryTail`'s own "bare file name" case -- `Vision`, `Risk`, `Assumption`,
 *   `OpenQuestion`, `Waiver`, `SessionRecord`, `HandoffRecord`), the kept literal root word genuinely
 *   IS the part a relocated `paths.<section>` changes, so this check is not actually root-agnostic for
 *   those seven -- a path written against a relocated root that no longer literally ends in that
 *   default word is refused here even though it may be exactly correct for the project's own
 *   configuration (real enforcement, `outputGlob`, judges it correctly regardless; this load-time
 *   check is a narrower, sometimes-too-strict proxy for those seven types only).
 * - `cardinality` must be `'many'` exactly when that tail still carries a placeholder (a glob
 *   fragment -- `*`, only ever produced by replacing one), and ABSENT otherwise. `'single'`
 *   (`schema.ts`'s own enum) is never correct for a registry type either way: it satisfies neither
 *   branch, so it is refused by this same rule without a separate case.
 *
 * The identical rule `test/agent-outputs-registry.test.ts` enforces against every shipped agent copy
 * (there with a real `roots` and the full `outputGlob`, since it can); this is the load-time half, with
 * no roots available, checked against every agent document as it loads rather than only the shipped
 * ones. A type the core registry does not know (a module-registered type such as `ComponentSpec`, or
 * the special-cased `Code`) is not checked here at all -- `artifactTypeById` returns `undefined` for
 * it, and this file has no module registry loaded to check it against instead (`PLAN-M14.md` P33's own
 * Discloses: "module-registered types... are not checked").
 */
function endsWithTail(path: string, tail: string): boolean {
  // A plain `path.endsWith(tail)` would also accept a path whose directory merely ends in the same
  // TEXT as `tail`'s own leading segment (`'old-decisions/ADR-*.md'.endsWith('decisions/ADR-*.md')` is
  // `true` in plain JS) -- exactly the copy-pasted-or-mistyped-directory mistake this rule exists to
  // catch. Requiring a `/` (or nothing at all) immediately before the match closes that gap.
  return path === tail || path.endsWith(`/${tail}`);
}

function checkOutputsAgreeWithRegistry(agent: AgentDefinition): readonly AgentIssue[] {
  const issues: AgentIssue[] = [];
  agent.outputs.forEach((output, index) => {
    const definition = artifactTypeById(output.type);
    if (definition === undefined) return;

    const expectedSchema = `${ARTIFACT_SCHEMAS[definition.id].fileStem}.schema.json`;
    if (output.schema !== expectedSchema) {
      issues.push({
        path: `outputs[${String(index)}].schema`,
        message: `"${output.type}" is a core registry type (18 §18.7); schema must be "${expectedSchema}", not "${output.schema}".`,
      });
    }

    const tail = registryTail(definition.id);
    if (!endsWithTail(output.path, tail)) {
      issues.push({
        path: `outputs[${String(index)}].path`,
        message: `"${output.type}" is a core registry type (18 §18.7); path must end with "${tail}" at a path-segment boundary, not "${output.path}".`,
      });
    }

    const wantCardinality = tail.includes('*') ? 'many' : undefined;
    if (output.cardinality !== wantCardinality) {
      issues.push({
        path: `outputs[${String(index)}].cardinality`,
        message: `"${output.type}" is a core registry type (18 §18.7); cardinality must be ${
          wantCardinality === undefined ? 'absent' : `"${wantCardinality}"`
        }, not ${output.cardinality === undefined ? 'absent' : `"${output.cardinality}"`}.`,
      });
    }
  });
  return issues;
}

function semanticIssues(agent: AgentDefinition): readonly AgentIssue[] {
  return [
    ...checkArchitectNeverApproves(agent),
    ...checkReviewRoleShape(agent),
    ...checkOutputsAgreeWithRegistry(agent),
  ];
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
