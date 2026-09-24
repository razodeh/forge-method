/**
 * `packForStep` — `05` §5.4 points 4-7's own real, new work: skill-body inclusion layered on top of
 * `@forge/kb/pack`'s own already-proven pinned-core/declared-inputs/retrieved layers (M3, points 1-3).
 *
 * @see specs/05 §5.4
 * @see specs/15 §15.4.3
 * @see PLAN-M6.md A4
 */
import type { AbsolutePath } from '@forge/core';
import { buildContextPack, estimateTokens, type PinnedCore } from '@forge/kb/pack';
import type { KbIndexBackend, KbTree } from '@forge/kb';
import { parseSkillPackage, skillFrontMatterSchema } from '@forge/extensions/skills';
import { SKILL_INDEX } from '@forge/templates';
import path from 'node:path';
import { minimatch } from 'minimatch';

import type { AgentDefinition } from '../schema/types.ts';
import type { AgentContextPack, SkillPackEntry } from './types.ts';

/**
 * `@forge/agents` has no boundary-graph edge to `@forge/engine` (`02` §2.2: `agents ← core, kb,
 * schemas, adapter-kit, templates, extensions` -- no `engine`), so `packForStep` cannot import the real
 * `StepNode` type `06` §6.2 defines, even though `PLAN-M6.md` A4's own Surface text writes
 * `packForStep(node: StepNode, ...)`. An independently-declared, minimal shape carrying only the
 * fields this piece actually reads -- the same "duplicate a small shape rather than force a disallowed
 * cross-package edge" precedent this codebase already uses repeatedly (`ProjectLevel` in
 * `@forge/extensions/agents`, `WorkflowId`/`GateId`/`FrameworkId`/`SkillId` in `@forge/templates`, all
 * independently re-declared from a type a real boundary edge would otherwise supply).
 */
export interface StepContext {
  readonly brief: string;
  readonly declaredInputIds: readonly string[];
  readonly produces: readonly string[];
  readonly consumes: readonly string[];
  /** The `outputs` the step declares: `type` and `subtype` as written, and `path`, the registry glob the engine's output
   * check will look in (`outputGlob`, under the project's configured docs roots). When non-empty, block [5] of the
   * compiled prompt lists exactly these, at that path, and not the role's whole `outputs[]`. */
  readonly outputs?: readonly StepOutputContext[] | undefined;
  /** `PLAN-M14.md` P30 (`20` §20.5 point 3, `15` §15.5.4): this step's own declared `inputs:` that name an
   * external scheme (`mcp:<server>[/<tool>]` or `fetch:<https-url>`) rather than a KB id -- never resolved
   * into `declaredInputIds` (there is no KB entry to look up), and rendered separately into block [4]
   * (`compile-prompt.ts`'s own `renderStepBriefBlock`) so the agent sees them named apart from the KB
   * entries actually packed. `packForStep` itself never reads this field (the same "carried through,
   * consumed only by `compile-prompt.ts`'s own block renderer" shape `outputs` above already has); present
   * only when non-empty. */
  readonly externalInputs?: readonly string[] | undefined;
}

export interface StepOutputContext {
  readonly type: string;
  readonly subtype?: string | undefined;
  readonly path?: string | undefined;
  /** The step's own `cardinality` for this output (the engine checks the step's, not the role's). */
  readonly cardinality?: string | undefined;
  /** The id (`cardinality: 'one'`) or contiguous block of ids (`'many'`) a supervisor already reserved
   * for this declared output before the prompt was assembled (`PLAN-M14.md` P8, `dispatch/
   * output-ids.ts`'s `reserveDeclaredKbOutputIds`) -- only ever set for a KB-located type (`18` §18.7
   * `pathTemplate` starting `kb/`); `undefined` for every other output, unchanged from before this
   * field existed. */
  readonly reservedIds?: readonly string[] | undefined;
}

export interface PackForStepOptions {
  readonly budgetTokens: number;
  /** `15` §15.4.3 point 3's own `skills.packBudgetTokens` (default 8000) -- the total ceiling on
   * injected skill *body* content specifically, separate from `budgetTokens` above (which governs the
   * pinned-core/declared-inputs/retrieved layers `buildContextPack` already manages). */
  readonly skillsPackBudgetTokens: number;
  /** Where `@forge/templates`' own `SKILL_INDEX` paths resolve against -- the templates package's own
   * root directory, the same "caller resolves against wherever @forge/templates is actually installed"
   * contract every `@forge/templates` index constant already documents. */
  readonly templatesPackageRoot: AbsolutePath;
  /** Skill id -> real package directory (relative to `templatesPackageRoot`). Defaults to
   * `@forge/templates`' own real `SKILL_INDEX` (`15` §15.4.4's built-in library) -- injectable, not
   * hardwired to a module-level import, matching this whole function's own `kbBackend`/`kbTree`
   * dependency-injection shape (and, concretely, letting a test exercise a synthetic skill fixture
   * without needing a real, shipped `@forge/templates` entry for every code path). */
  readonly skillIndex?: Readonly<Record<string, string>> | undefined;
  /** `05` §5.4 point 1's own pinned-core items that are not KB data (`projectIdentity`, `level`,
   * `stageGoal`) and so have no source `@forge/kb/pack` can compute for itself -- the caller (which
   * holds the project config) supplies them here, forwarded verbatim as `PackRequest.
   * pinnedCoreOverrides`. Without this, a real step's pinned core always omitted the project's own
   * identity and level even though `05` §5.4 lists both as "always" included. */
  readonly pinnedCoreOverrides?: Partial<PinnedCore> | undefined;
}

/** `15` §15.4.3 point 2: a `path`/`language` hint upgrades a skill from metadata-only to injected-body
 * even at `activation: auto` (not just `always`) when the step's own file claim matches. Checked
 * against `produces`/`consumes` (the only per-step path signal `StepContext` carries -- there is no
 * per-step "language" signal available at this layer at all, so `applies_to.languages` is never
 * checked here; a real gap, recorded rather than faked, since inventing one from nothing this piece
 * has access to would be worse than honestly not matching on it). `produces` here is whatever its
 * caller put in `StepContext` -- `@forge/engine/dispatch`'s `assembleAgentSession` hands it the RESOLVED
 * claim (`resolveProduces`, `PLAN-M14.md` P6), a `docs/forge/<section>/` prefix already rewritten to the
 * project's configured root, so a path-scoped skill matches the path a session is actually held to under
 * a relocated layout too; this module has no roots of its own to resolve one from. */
function matchesStepFileClaim(
  applies: { readonly paths?: readonly string[] | undefined } | undefined,
  step: StepContext,
): boolean {
  if (applies?.paths === undefined) return false;
  const claims = [...step.produces, ...step.consumes];
  return applies.paths.some((pattern) =>
    claims.some((claim) => minimatch(claim, pattern) || minimatch(pattern, claim)),
  );
}

async function loadSkillEntry(
  skillId: string,
  options: PackForStepOptions,
  step: StepContext,
  remainingBudget: number,
): Promise<{ readonly entry: SkillPackEntry; readonly bodyTokens: number }> {
  const skillIndex = options.skillIndex ?? SKILL_INDEX;
  const relativePath = (skillIndex as Readonly<Record<string, string>>)[skillId];
  if (relativePath === undefined) {
    // A skill id an agent declares but this build's own @forge/templates never shipped -- a real
    // authoring inconsistency between two independently-versioned pieces of content, not something to
    // silently drop. Surfaced as a demoted, body-less entry rather than thrown: one missing skill
    // should not fail packing an otherwise-valid step.
    return {
      entry: {
        id: skillId,
        description: '(unresolved skill id)',
        whenToUse: '',
        bodyIncluded: false,
        demoted: true,
      },
      bodyTokens: 0,
    };
  }

  const dir = path.join(options.templatesPackageRoot, relativePath) as AbsolutePath;
  let parsed: Awaited<ReturnType<typeof parseSkillPackage>>;
  try {
    parsed = await parseSkillPackage(dir);
  } catch {
    // A resolved skill id whose own package is missing/malformed on disk (bad `SKILL.md`, unreadable
    // dir, etc) -- the same "one bad skill demotes, it never aborts the whole pack" contract the
    // unresolved-id and invalid-front-matter paths above already commit to. `parseSkillPackage` can
    // throw a `ForgeError` (CFG-005/006/007) or a raw fs error; neither is this call's to interpret,
    // so both collapse to the same demoted, body-less entry.
    return {
      entry: {
        id: skillId,
        description: '(skill package failed to load)',
        whenToUse: '',
        bodyIncluded: false,
        demoted: true,
      },
      bodyTokens: 0,
    };
  }
  const frontMatterResult = skillFrontMatterSchema.safeParse(parsed.frontMatter);
  if (!frontMatterResult.success) {
    return {
      entry: {
        id: skillId,
        description: '(invalid skill front matter)',
        whenToUse: '',
        bodyIncluded: false,
        demoted: true,
      },
      bodyTokens: 0,
    };
  }
  const frontMatter = frontMatterResult.data;

  // A fresh critic round found the original condition omitted the `activation === 'auto'` guard,
  // so an `activation: explicit` skill's own body was wrongly auto-injected on a bare path match --
  // `15` §15.4.3 point 2's own path/language upgrade applies to `auto`-activation skills specifically
  // ("only the front-matter... injected [by default]... Path/language hints upgrade a skill to
  // injected-body"); `explicit`'s own definition ("only loadable when a workflow step or the user
  // names it") is a *different*, narrower activation this piece has no signal for at all (there is no
  // "the step/user explicitly named this skill" input anywhere in `StepContext`) -- an explicit skill
  // is therefore never auto-upgraded to a body here, full stop.
  const wantsBody =
    frontMatter.activation === 'always' ||
    (frontMatter.activation === 'auto' && matchesStepFileClaim(frontMatter.applies_to, step));
  const bodyTokens = estimateTokens(parsed.body);
  const fitsBudget = bodyTokens <= remainingBudget;

  return {
    entry: {
      id: skillId,
      description: frontMatter.description,
      whenToUse: frontMatter.when_to_use,
      bodyIncluded: wantsBody && fitsBudget,
      body: wantsBody && fitsBudget ? parsed.body : undefined,
      // "over-budget skills are demoted to metadata-only ... the demotion is logged, never silent" (15
      // §15.4.3 point 3) -- demoted only means "wanted a body, budget said no," never "was never
      // eligible for one in the first place."
      demoted: wantsBody && !fitsBudget,
    },
    bodyTokens: wantsBody && fitsBudget ? bodyTokens : 0,
  };
}

/**
 * `05` §5.4's real context pack for one step: `buildContextPack`'s own three already-proven layers,
 * plus every one of `agent.skills`' own front-matter summaries (always) and bodies (only where
 * `activation: always` or the step's own file claim matches, and only while `skillsPackBudgetTokens`
 * allows it -- processed in `agent.skills`' own declared order, so an agent's own priority ordering of
 * its skills is what determines which bodies survive a tight budget, not an arbitrary re-sort).
 */
export async function packForStep(
  step: StepContext,
  agent: AgentDefinition,
  kbBackend: KbIndexBackend,
  kbTree: KbTree,
  options: PackForStepOptions,
): Promise<AgentContextPack> {
  const base = buildContextPack(
    {
      declaredInputIds: step.declaredInputIds,
      briefText: step.brief,
      budgetTokens: options.budgetTokens,
      ...(options.pinnedCoreOverrides === undefined
        ? {}
        : { pinnedCoreOverrides: options.pinnedCoreOverrides }),
    },
    kbBackend,
    kbTree,
  );

  const skills: SkillPackEntry[] = [];
  let remainingSkillsBudget = options.skillsPackBudgetTokens;
  for (const skillId of agent.skills ?? []) {
    const { entry, bodyTokens } = await loadSkillEntry(
      skillId,
      options,
      step,
      remainingSkillsBudget,
    );
    skills.push(entry);
    remainingSkillsBudget -= bodyTokens;
  }

  return { ...base, skills };
}
