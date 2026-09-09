/**
 * `forge review [--diff <range>]` — `03` §3.2.5: "Multi-perspective review (design/security/perf/
 * testing)." Real dispatch to `@forge/engine/interaction`'s own `dispatchAgentStep(node, agent, ctx,
 * 'swarm-review', options)` (A6) — the identical mechanism `implement-story.workflow.yaml`'s own
 * inner-loop `review` step already drives (`agent: reviewer, mode: swarm-review, perspectives:
 * [design, security, testing, performance]`), called directly rather than through a synthetic
 * workflow: `10` §10.5's own 20-workflow table has no standalone `review` workflow at all (`review` is
 * only ever an inner-loop *step*, never its own top-level workflow document), so there is no real
 * workflow document `runWorkflow`/`runEngine` could compile and run here — the same "a real,
 * already-built mechanism exists; call it directly" treatment `forge panel` gets, not a "not yet
 * implemented" refusal (real machinery exists) and not an invented workflow file (none exists to run).
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
 */
import { execa } from 'execa';
import { SYSTEM_CLOCK, type Clock } from '@forge/core';
import type { ProjectPaths } from '@forge/core/fs';
import type { PlatformAdapter } from '@forge/adapter-kit/types';
import { dispatchAgentStep, type InteractionOutcome } from '@forge/engine/interaction';
import type { ForgeConfig } from '@forge/schemas/config';

import { buildAdHocStepNode } from './ad-hoc-step.ts';
import { loadProjectAgent } from './agent-loader.ts';
import { buildRunEngineContext } from '../run/context.ts';

/** `10` §10.1's own worked example, and `implement-story.workflow.yaml`'s own real review step —
 * `forge review` has no `--perspectives`/`--roles` flag of its own in `03` §3.2.5's table, so this is
 * the one real, fixed set every invocation reviews from, not a guessed-at default. */
const DEFAULT_REVIEW_PERSPECTIVES = ['design', 'security', 'testing', 'performance'] as const;
const REVIEWER_AGENT_ID = 'reviewer';

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
  const diff = await realDiff(deps.projectRoot, options.diff ?? 'HEAD');
  const agent = await loadProjectAgent(deps.paths, deps.agentsRoot, REVIEWER_AGENT_ID);

  const runId = `review-${clock.now().replace(/[^0-9]/g, '')}`;
  const ctx = await buildRunEngineContext({
    paths: deps.paths,
    projectRoot: deps.projectRoot,
    config: deps.config,
    runId,
    adapter: deps.adapter,
    checksRoot: deps.checksRoot,
    clock,
  });

  const brief = `Review the following real diff:\n\n\`\`\`diff\n${diff}\n\`\`\``;
  const node = buildAdHocStepNode(runId, REVIEWER_AGENT_ID, brief);

  return dispatchAgentStep(node, agent, ctx, 'swarm-review', {
    perspectives: [...DEFAULT_REVIEW_PERSPECTIVES],
  });
}
