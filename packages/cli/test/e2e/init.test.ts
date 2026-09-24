/**
 * `E1 init` — `specs/22` M6's own literal exit-test line:
 * `pnpm test -- --grep "E1 init"   # full artifact set, all validators clean` -- clean again as of `PLAN-M13.md` P2/P3, which authored the content P1's real checks look for.
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
 * **`PLAN-M13.md` P1 -> P2/P3.** P1 replaced `agent validate --all`'s and `workflow validate --all`'s
 * permissive existence stubs with real checks that every agent `prompt.system`/`prompt.briefs.*` and
 * every workflow `brief:` (and, from P2c, every gate `brief:`) resolves to real, non-empty content
 * (`SPEC-QUESTIONS.md` Q197). For a while that made a fresh `forge init` report 62 `unknown-prompt` and
 * 53 `unknown-brief` findings, asserted here as an itemized list. P2a/P2b/P2c (briefs) and P3a/P3b
 * (prompts) authored all of it, so both validators were asserted clean (`[]`) again; a missing or
 * empty content file now fails this test with the offending id.
 *
 * **`PLAN-M14.md` P42.** `forge agent validate --all` is no longer literally `[]`: its own new
 * `unregistered-output-type` check fires exactly seven times, a deliberate, already-justified content
 * gap (`SPEC-QUESTIONS.md` Q224: six of the seven are its own already-tracked declarations on roles no
 * shipped step runs; the seventh is `fm-web`'s own real `ComponentSpec`, which Q224 tracked separately
 * rather than as part of its own "seven" -- the count matches by coincidence, not an identical set) --
 * asserted explicitly, by real agent id and message, below, alongside "no error of any kind" (which IS
 * still asserted unconditionally).
 *
 * @see specs/22 M6
 * @see PLAN-M6.md C9
 * @see PLAN-M13.md P1
 * @see PLAN-M14.md P42
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';
import { FakePlatformAdapter } from '@forge/testkit';
import { ProjectPaths, readTextFile } from '@forge/core/fs';
import type { ForgeConfig } from '@forge/schemas/config';
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

const REAL_MODULES_DIR = fileURLToPath(new URL('../../../../modules/', import.meta.url));

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
      env: {},
    });
    expect(kbLintCheck.ok).toBe(true);
    const specGraphCheck = await checkSpecGraph({
      paths,
      specsRoot: config.paths.specs,
      kbRoot: config.paths.kb,
    });
    expect(specGraphCheck.ok).toBe(true);

    // This milestone's own exit-test line, part 1: `forge agent validate --all`. Not genuinely clean of
    // every finding right now -- `PLAN-M14.md` P42's own `unregistered-output-type` warning fires exactly
    // seven times (six of Q224's own already-tracked declarations on roles no shipped step runs, plus
    // `fm-web`'s own real `ComponentSpec`, which Q224 tracked separately, `SPEC-QUESTIONS.md`), a
    // deliberate content choice, not a bug -- but genuinely clean of every ERROR: no
    // `output-ownership-overlap`, `kb-write-overlap`, `ceiling-exceeded` or `unknown-*`/`schema` finding.
    const agentFindings = await agentValidateAll({ paths, agentsRoot: '.forge/agents' });
    expect(agentFindings.every((finding) => finding.severity === 'warning')).toBe(true);
    expect(agentFindings.every((finding) => finding.code === 'unregistered-output-type')).toBe(true);
    expect(
      agentFindings.map((finding) => `${finding.agentId}:${finding.message}`).sort(),
    ).toEqual(
      [
        ['compliance', 'ComplianceMatrix'],
        ['critic', 'ObjectionList'],
        ['domain-modeler', 'ContextMap'],
        ['finops', 'CostModel'],
        ['frontend', 'ComponentSpec'],
        ['techwriter', 'Readme'],
        ['techwriter', 'DocsSet'],
      ]
        .map(
          ([agentId, type]) =>
            `${agentId}:outputs names ${JSON.stringify(type)}, which is neither a registered artifact type (18 §18.7) nor "Code".`,
        )
        .sort(),
    );

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
    expect(allWorkflowIssues).toEqual([]);
  });
});
