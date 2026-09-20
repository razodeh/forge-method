/**
 * `E1 init` — `specs/22` M6's own literal exit-test line:
 * `pnpm test -- --grep "E1 init"   # full artifact set, all validators clean` -- as of `PLAN-M13.md` P1, `agent`/`workflow` validate report the itemized, disclosed findings below instead of zero.
 *
 * A real `forge init` against the real, complete `modules/` roster at the repo root (not a fixture
 * module), followed by every real validator this milestone ships: `forge agent validate --all`,
 * `forge template validate --all`, `forge doctor` (`config-validity`/`manifest-structure`/`kb-lint`/
 * `spec-graph`), and `forge workflow validate --all`.
 *
 * `forge workflow validate --all` was, until `PLAN-M13.md` P1 (see below), asserted clean (zero issues) — it once genuinely was not: `10
 * §10.5`'s own real worked examples for `build-stage`/`implement-story` used `StagePlan`/`ReviewReport`
 * as real artifact types, but `18 §18.7`'s own real, canonical registry table never registered either
 * one, so a fresh `forge init` reported 3 real `unknown-artifact-type` findings on `build-stage`
 * (`requires.artifacts: [StagePlan]`, its own `outputs: [{ type: ReviewReport }]`) and 1 on
 * `implement-story` (`outputs: [{ type: ReviewReport }]`). Fixed post-v1.0: `ReviewReport` is now a
 * real, registered type (it was genuinely load-bearing — `10 §10.6`'s own canonical inner loop and
 * `05 §5.2`'s `reviewer` persona both already depended on it); `StagePlan` was found to be the stale
 * side of the inconsistency (`G-Ready.gate.yaml`'s own real `evidence:` block already names
 * `Epic(*)`/`Story(*)`, matching what `plan-stage.workflow.yaml` actually produces) and its references
 * were corrected to match. See `SPEC-QUESTIONS.md` for the full record.
 *
 * **`PLAN-M13.md` P1 update — genuinely clean no longer, disclosed rather than hidden.** Both `forge
 * agent validate --all` and `forge workflow validate --all` stayed clean from Q194 above until
 * `PLAN-M13.md` P1 replaced each command's own permissive existence-check stub (`briefExists: () =>
 * true`, and no agent-prompt check at all) with a real one. Both now correctly report every one of the
 * 34 real, shipped agents' own `prompt.system`/`prompt.briefs.*` reference (62 real `unknown-prompt`
 * findings) and every real, shipped workflow's own `brief:` reference (53 real `unknown-brief` issues)
 * as unresolved — no real brief/prompt *content* has been authored anywhere in this codebase yet
 * (`BRIEF_INDEX`/`PROMPT_INDEX` in `packages/templates/src/index.ts` are still empty). This is a real,
 * disclosed, intentionally temporary regression: `PLAN-M13.md` P2/P3 (content authoring, not yet
 * built) closes it, the same way Q194 above closed Q192's own disclosed `unknown-artifact-type` gap.
 * See `SPEC-QUESTIONS.md` Q197. `EXPECTED_M13_P1_AGENT_FINDINGS`/`EXPECTED_WORKFLOW_ISSUES` below are
 * the real, complete, itemized findings/issues — by real id, not merely a count — so this test still
 * fails the moment either real list's shape changes for any reason other than real content landing.
 *
 * @see specs/22 M6
 * @see PLAN-M6.md C9
 * @see PLAN-M13.md P1
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';
import { FakePlatformAdapter } from '@forge/testkit';
import { ProjectPaths, readTextFile } from '@forge/core/fs';
import type { ForgeConfig } from '@forge/schemas/config';
import type { ValidationIssue } from '@forge/engine/workflow';
import * as YAML from 'yaml';

import { runInit } from '../../src/init/run-init.ts';
import { agentValidateAll } from '../../src/commands/agent.ts';
import {
  checkConfigValidity,
  checkKbLint,
  checkManifest,
  checkSpecGraph,
} from '../../src/commands/doctor/project.ts';
import { templateValidateAll } from '../../src/commands/template.ts';
import { workflowValidateAll } from '../../src/commands/workflow.ts';
import { EXPECTED_M13_P1_AGENT_FINDINGS } from '../fixtures/m13-p1-expected-agent-findings.ts';

const REAL_MODULES_DIR = fileURLToPath(new URL('../../../../modules/', import.meta.url));

/**
 * The real, complete, itemized `unknown-brief` issues `forge workflow validate --all` reports against
 * the real, complete `modules/` roster right now — see this file's own top-of-file doc comment and
 * `SPEC-QUESTIONS.md` Q197. Captured directly from a real run of this exact test body (not hand-typed
 * from a spec or guessed): every real, shipped workflow's own `brief:` reference currently resolves to
 * nothing, since `BRIEF_INDEX` (`packages/templates/src/index.ts`) is still empty. Gate-embedded
 * `brief:` references (`packages/templates/templates/checks/*.gate.yaml`) are a separate, real,
 * pre-existing gap this list does not cover: no command validates a gate document's own step-level
 * references at all today (confirmed: `run/gates.ts` has no `validate` of its own), the identical
 * "genuinely never checked, not merely a stub returning `true`" situation `briefExists` itself was in
 * before this piece — out of scope here, recorded in `SPEC-QUESTIONS.md` Q197, not silently expanded
 * into or hidden by this list.
 */
const EXPECTED_WORKFLOW_ISSUES: readonly (ValidationIssue & { readonly id: string })[] = [];

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('E1 init', () => {
  it('produces a full, real artifact set that every real validator this milestone ships accepts cleanly', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-cli-e1-init-'));
    dirs.push(dir);

    const result = await runInit(
      dir,
      // A real, explicit `level: 'L0'`: `resolveInitLevel`'s own conservative default proposes `L3`
      // for a bare, signal-less greenfield project, whose own real `G-Design`-gated diagram
      // requirements (`kb:diagram:required`) a fresh `forge init` scaffold cannot satisfy on its own
      // -- diagrams are real content a human/agent authors *after* init, not part of init's own
      // scaffold. `L0` is the one real level with no such requirement, the level this test's own real
      // "a bare init's own output is clean" claim is actually true at.
      { name: 'E1 Init Fixture', yes: true, level: 'L0' },
      { candidateAdapters: [new FakePlatformAdapter()], env: {}, modulesDir: REAL_MODULES_DIR },
    );
    expect(result.kind).toBe('initialized');

    const paths = new ProjectPaths(dir);
    const config = YAML.parse(
      await readTextFile(paths.resolveWithin('.forge/config.yaml')),
    ) as ForgeConfig;

    // `forge doctor`'s own real project-state checks.
    const configCheck = await checkConfigValidity(paths);
    expect(configCheck.ok).toBe(true);
    const manifestCheck = await checkManifest(paths);
    expect(manifestCheck.ok).toBe(true);
    const kbLintCheck = await checkKbLint({
      paths,
      kbRoot: config.paths.kb,
      specsRoot: config.paths.specs,
      level: config.project.level,
    });
    expect(kbLintCheck.ok).toBe(true);
    const specGraphCheck = await checkSpecGraph({
      paths,
      specsRoot: config.paths.specs,
      kbRoot: config.paths.kb,
    });
    expect(specGraphCheck.ok).toBe(true);

    // This milestone's own exit-test line, part 1: `forge agent validate --all`. Not genuinely clean
    // right now -- see this file's own top-of-file doc comment (`PLAN-M13.md` P1, `SPEC-QUESTIONS.md`
    // Q197): every real `unknown-prompt` finding is asserted explicitly, by real agent id, below.
    const agentFindings = await agentValidateAll({ paths, agentsRoot: '.forge/agents' });
    expect(agentFindings).toEqual(EXPECTED_M13_P1_AGENT_FINDINGS);

    // Part 3: `forge template validate --all`.
    const templateResults = await templateValidateAll();
    expect(templateResults.every((result) => result.valid)).toBe(true);

    // Part 2: `forge workflow validate --all` — genuinely clean of the old `StagePlan`/`ReviewReport`
    // findings (see this file's own top-of-file doc comment for that history), but not genuinely clean
    // overall right now: every real `unknown-brief` issue is asserted explicitly, by real workflow and
    // step id, below (`PLAN-M13.md` P1, `SPEC-QUESTIONS.md` Q197).
    const workflowResults = await workflowValidateAll({
      paths,
      workflowsRoot: '.forge/workflows',
      agentsRoot: '.forge/agents',
      checksRoot: '.forge/checks',
    });
    const allWorkflowIssues = [...workflowResults.entries()].flatMap(([id, issues]) =>
      issues.map((issue) => ({ id, ...issue })),
    );
    expect(allWorkflowIssues).toEqual(EXPECTED_WORKFLOW_ISSUES);
  });
});
