/**
 * `forge review [--diff <range>]` — `03` §3.2.5: "Multi-perspective review (design/security/perf/
 * testing)." Real dispatch to `@forge/engine/interaction`'s own `dispatchAgentStep(node, agent, ctx,
 * 'swarm-review', options)` (A6) — the identical mechanism `implement-story.workflow.yaml`'s own
 * inner-loop `review` step already drives, called directly rather than through a synthetic workflow:
 * `10` §10.5's own 20-workflow table has no standalone `review` workflow at all (`review` is only ever
 * an inner-loop *step*, never its own top-level workflow document), so there is no real workflow
 * document `runWorkflow`/`runEngine` could compile and run here — the same "a real, already-built
 * mechanism exists; call it directly" treatment `forge panel` gets, not a "not yet implemented" refusal
 * (real machinery exists) and not an invented workflow file (none exists to run).
 *
 * `dispatchAgentStep` itself never resolves a step's own `inputs` (`diff:lane`, `artifact:X` — that is
 * `@forge/agents`' own context-packing, `05` §5.4, which runs before a real compiled step ever reaches
 * dispatch); every perspective's own prompt is built from `node.brief` alone (confirmed directly
 * against `runParticipantSession`'s own real code). A standalone `forge review` has no lane to read a
 * `diff:lane` reference against anyway, so the real diff text is embedded directly into `node.brief`
 * here — the one place this command's own real caller can put it.
 *
 * Known, accepted limitation: each invocation's own `telemetry.emit` calls append real events to
 * `.forge/state/runs/<runId>/` the same durable way `forge run` does, but — unlike `forge run` — this
 * command writes no manifest and no `last-run.json` pointer, and nothing here or elsewhere ever prunes
 * these directories. Harmless to correctness (`forge status`/`forge resume` only ever look up an
 * explicit runId or `last-run.json`, neither of which a `forge review` invocation ever becomes), but a
 * real, unbounded, silent source of directories under `.forge/state/runs/` over time — a real cleanup
 * mechanism (`forge doctor`'s own remit, C6) is this piece's own explicit non-goal, not an oversight.
 *
 * @see specs/03 §3.2.5
 * @see specs/10 §10.1
 * @see specs/13 §13.3 F-REVIEW-1
 * @see specs/13 §13.3 F-REVIEW-2
 */
import { execa } from 'execa';
import { SYSTEM_CLOCK, type Clock } from '@forge/core';
import type { ProjectPaths } from '@forge/core/fs';
import type { PlatformAdapter } from '@forge/adapter-kit/types';
import { readProjectAgent } from '@forge/engine/dispatch';
import { dispatchAgentStep, type InteractionOutcome } from '@forge/engine/interaction';
import type { ForgeConfig } from '@forge/schemas/config';

import { agentStepLimits, buildAdHocStepNode } from './ad-hoc-step.ts';
import { buildRunEngineContext } from '../run/context.ts';

/** `13` §13.3's own F-REVIEW-1 table, verbatim — `forge review` has no `--perspectives`/`--roles` flag
 * of its own in `03` §3.2.5's table, so this is the one, real, fixed set every invocation reviews from,
 * not a guessed-at default. Each row's own real "Asks" text is embedded per-perspective inside
 * `dispatchSwarmReview` itself (`@forge/engine/interaction`), not duplicated here. */
const DEFAULT_REVIEW_PERSPECTIVES = [
  'spec-conformance',
  'design',
  'correctness',
  'security',
  'performance',
  'testing',
  'operability',
  'documentation',
] as const;
const REVIEWER_AGENT_ID = 'reviewer';

/** `@forge/vcs`'s own real `Co-Authored-By: <role> <role@agents.forge.invalid>` trailer shape
 * (`agentCoAuthorTrailer`, `06` §6.4 step 3), matched verbatim — a backreference ties the role named
 * in the trailer's own "name" position to the one in its own email local-part, so a hand-forged trailer
 * naming two different roles across those two positions is never read as a real, coherent one. Global,
 * not the single-match `.exec` a first draft used: a fresh critic round reproduced directly that a real
 * commit can carry more than one real `Co-Authored-By` trailer (a human co-author alongside an agent
 * one, e.g.) — a single-match read silently checked only whichever trailer happened to come first. */
const AGENT_CO_AUTHOR_TRAILER = /^Co-Authored-By: ([a-z][a-z0-9-]*) <\1@agents\.forge\.invalid>$/gm;

function agentTrailersIn(message: string): readonly string[] {
  return [...message.matchAll(AGENT_CO_AUTHOR_TRAILER)]
    .map((match) => match[1])
    .filter((role): role is string => role !== undefined);
}

/** The real ref whose own commit trailer(s) F-REVIEW-2's own self-review check should read — the *tip*
 * of whatever `--diff <range>` actually compares against, not unconditionally `HEAD`. A fresh critic
 * round reproduced directly that always reading `HEAD` regardless of `range` is a real, two-sided bug:
 * a false positive (an unrelated, later `HEAD` commit authored by the reviewing agent wrongly refuses a
 * review of an *earlier*, different range that never touched it) and, separately, a would-be false
 * negative for any range whose own real tip is not `HEAD` at all. `git diff`'s own real range grammar:
 * a two-ref range (`A...B` or `A..B`) always compares against `B`, its own second endpoint, never the
 * first; a bare, single ref (`main`, the default `HEAD`) compares that ref against the *current
 * checkout* (working tree/index) — the tip of that comparison is the checkout itself, i.e. `HEAD`,
 * regardless of which single ref was named as the *base*. */
function tipRefFor(range: string): string {
  const parts = range.split(/\.{2,3}/);
  const lastPart = parts.at(-1);
  return parts.length >= 2 && lastPart !== undefined && lastPart !== '' ? lastPart : 'HEAD';
}

/** F-REVIEW-2's own "a reviewer may not approve a change it authored" needs to know *who* authored the
 * real diff under review. A real merge commit (`@forge/vcs`'s own merge queue, `06` §6.7) is the one
 * real complication: a fresh critic round reproduced directly that `formatMergeCommitMessage` never
 * writes a `Co-Authored-By` trailer on the merge commit itself (only `Forge-Step`/`Forge-Run`) — the
 * real authorship lives on each merged-in lane's own tip commit, `git`'s own second-and-later parent(s)
 * of a real `--no-ff` merge (the first parent is always the integration branch's own prior tip, never a
 * lane). Checking every non-first parent — not just the first — is what correctly covers a real
 * multi-lane merge step too, `06` §6.7's own "merge-queue processing for a *set* of lanes." An ordinary,
 * non-merge commit has at most one real parent, so this falls back to checking the tip itself.
 * Returns every distinct real agent role found across every ref checked — an empty array (nothing
 * found at all, a human's own commit or one predating this convention) is a real, meaningful answer in
 * its own right, always passed through to `dispatchAgentStep` below rather than omitted:
 * `reviewChange` always *can* determine this (even when the real answer turns out to be "no agent"),
 * unlike a caller this dispatch layer has no way to ask at all (`DispatchAgentStepOptions
 * .authoringAgentIds`'s own doc comment covers that distinct, genuinely-can't-know case). */
async function realAuthoringAgentIds(
  projectRoot: string,
  range: string,
): Promise<readonly string[]> {
  const tip = tipRefFor(range);
  const { stdout: parentsRaw } = await execa('git', ['log', '-1', '--format=%P', tip], {
    cwd: projectRoot,
  });
  const parents = parentsRaw
    .trim()
    .split(/\s+/)
    .filter((parent) => parent !== '');
  const refsToCheck = parents.length >= 2 ? parents.slice(1) : [tip];
  const ids = new Set<string>();
  for (const ref of refsToCheck) {
    const { stdout } = await execa('git', ['log', '-1', '--format=%B', ref], { cwd: projectRoot });
    for (const id of agentTrailersIn(stdout)) ids.add(id);
  }
  return [...ids];
}

export interface ReviewDeps {
  readonly paths: ProjectPaths;
  readonly projectRoot: string;
  readonly config: ForgeConfig;
  readonly adapter: PlatformAdapter;
  readonly checksRoot: string;
  readonly agentsRoot: string;
}

export interface ReviewOptions {
  /** A real `git diff` range (`git diff <range>`), e.g. `main...HEAD` — omitted defaults to `HEAD`
   * (every real uncommitted change), matching `git diff`'s own no-argument default. */
  readonly diff?: string;
  readonly clock?: Clock;
}

async function realDiff(projectRoot: string, range: string): Promise<string> {
  const { stdout } = await execa('git', ['diff', range], { cwd: projectRoot });
  return stdout;
}

export async function reviewChange(
  deps: ReviewDeps,
  options: ReviewOptions = {},
): Promise<InteractionOutcome> {
  const clock = options.clock ?? SYSTEM_CLOCK;
  const range = options.diff ?? 'HEAD';
  const diff = await realDiff(deps.projectRoot, range);
  const agent = await readProjectAgent(deps.paths, deps.agentsRoot, REVIEWER_AGENT_ID);
  const authoringAgentIds = await realAuthoringAgentIds(deps.projectRoot, range);

  const runId = `review-${clock.now().replace(/[^0-9]/g, '')}`;
  const ctx = await buildRunEngineContext({
    paths: deps.paths,
    projectRoot: deps.projectRoot,
    config: deps.config,
    runId,
    adapter: deps.adapter,
    checksRoot: deps.checksRoot,
    agentsRoot: deps.agentsRoot,
    clock,
  });

  const brief = `Review the following real diff:\n\n\`\`\`diff\n${diff}\n\`\`\``;
  const node = buildAdHocStepNode(runId, REVIEWER_AGENT_ID, brief, agentStepLimits(agent));

  return dispatchAgentStep(node, agent, ctx, 'swarm-review', {
    perspectives: [...DEFAULT_REVIEW_PERSPECTIVES],
    authoringAgentIds,
  });
}
