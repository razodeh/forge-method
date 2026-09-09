/**
 * `forge implement <storyId>` — `03` §3.2.5's single-story engineering loop: real, thin dispatch to
 * `implement-story` (`10` §10.5), the same `runWorkflow` (`PLAN-M6.md` C4) every other named-workflow
 * command in this module reuses unchanged — no second execution mechanism.
 *
 * `implement-story.workflow.yaml`'s own two required inputs are `storyId` and `ownerRole`; the CLI's
 * own literal surface (`03` §3.2.5's table) only ever names `storyId` — `ownerRole` is not guessed at
 * or defaulted, it is read from the real Story artifact's own already-required `owner_role` field
 * (`09` §9.3), the one place a real answer already exists.
 *
 * @see specs/03 §3.2.5
 * @see specs/10 §10.5
 */
import { ForgeError } from '@forge/core/errors';
import type { ExpressionContext } from '@forge/engine/expr';

import { listSpecArtifacts } from '../shared.ts';
import { runWorkflow, type DryRunResult, type RealRunResult, type RunDeps } from '../run/run.ts';

const IMPLEMENT_STORY_WORKFLOW_ID = 'implement-story';

/** `implement-story.workflow.yaml`'s own literal `{{storyId}}`/`{{ownerRole}}` template references
 * resolve against `ExpressionContext` at the top level (`@forge/engine/expr`'s own `resolvePath` walks
 * `context` itself, not a nested `vars` bag) — but `ExpressionContext`'s own declared shape is a closed
 * seven-field interface (`item`/`stage`/`run`/`config`/`kb`/`failures`/`vars`) with no index signature,
 * so passing these two real, runtime-required keys needs an honest, narrow extension of that type
 * rather than an unsafe cast — the same "the type undersells what a real caller needs" correction this
 * codebase's own `SPEC-QUESTIONS.md` already makes repeatedly for other pieces' signatures. */
interface ImplementStoryExpressionContext extends ExpressionContext {
  readonly storyId: string;
  readonly ownerRole: string;
}

export interface ImplementOptions {
  readonly specsRoot: string;
  readonly dryRun?: boolean;
  readonly host: string;
}

async function findStoryOwnerRole(
  deps: RunDeps,
  specsRoot: string,
  storyId: string,
): Promise<string> {
  const docs = await listSpecArtifacts(deps.paths, specsRoot);
  const story = docs.find((doc) => {
    const frontMatter = doc.frontMatter as { readonly id?: unknown; readonly type?: unknown };
    return frontMatter.id === storyId && frontMatter.type === 'Story';
  });
  if (story === undefined) {
    throw new ForgeError('SPEC-024', { id: storyId });
  }
  const frontMatter = story.frontMatter as { readonly owner_role?: unknown };
  const ownerRole = frontMatter.owner_role;
  if (typeof ownerRole !== 'string' || ownerRole.length === 0) {
    throw new ForgeError('SPEC-025', { id: storyId });
  }
  return ownerRole;
}

export async function implementStory(
  deps: RunDeps,
  storyId: string,
  options: ImplementOptions,
): Promise<DryRunResult | RealRunResult> {
  const ownerRole = await findStoryOwnerRole(deps, options.specsRoot, storyId);
  const expressionContext: ImplementStoryExpressionContext = { storyId, ownerRole };
  return runWorkflow(deps, {
    workflowId: IMPLEMENT_STORY_WORKFLOW_ID,
    expressionContext,
    dryRun: options.dryRun ?? false,
    host: options.host,
  });
}
