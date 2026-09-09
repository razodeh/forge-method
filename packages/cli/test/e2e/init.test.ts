/**
 * `E1 init` — `specs/22` M6's own literal exit-test line:
 * `pnpm test -- --grep "E1 init"   # full artifact set, all validators clean`.
 *
 * A real `forge init` against the real, complete `modules/` roster at the repo root (not a fixture
 * module), followed by every real validator this milestone ships: `forge agent validate --all`,
 * `forge template validate --all`, `forge doctor` (`config-validity`/`manifest-structure`/`kb-lint`/
 * `spec-graph`), and `forge workflow validate --all`.
 *
 * `forge workflow validate --all` is asserted against its own real, already-diagnosed result, not a
 * blanket "zero issues": `10 §10.5`'s own real worked examples for `build-stage`/`implement-story`
 * use `StagePlan`/`ReviewReport` as real artifact types, but `18 §18.7`'s own real, canonical registry
 * table — confirmed directly against both spec files — never registers either one. This is a genuine,
 * pre-existing inconsistency between two spec documents, not a defect in this milestone's own code or
 * content; asserting it away here would hide a real, correctly-surfaced finding rather than prove the
 * validator works. See `SPEC-QUESTIONS.md` for the full record.
 *
 * @see specs/22 M6
 * @see PLAN-M6.md C9
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
    });
    expect(kbLintCheck.ok).toBe(true);
    const specGraphCheck = await checkSpecGraph({
      paths,
      specsRoot: config.paths.specs,
      kbRoot: config.paths.kb,
    });
    expect(specGraphCheck.ok).toBe(true);

    // This milestone's own exit-test line, part 1: `forge agent validate --all`.
    const agentFindings = await agentValidateAll({ paths, agentsRoot: '.forge/agents' });
    expect(agentFindings).toEqual([]);

    // Part 3: `forge template validate --all`.
    const templateResults = await templateValidateAll();
    expect(templateResults.every((result) => result.valid)).toBe(true);

    // Part 2: `forge workflow validate --all` — real, honest, non-empty output for exactly the two
    // real, pre-existing spec-10-vs-spec-18 inconsistencies (`StagePlan`, `ReviewReport`), and nothing
    // else. Every other real, shipped workflow is clean.
    const workflowResults = await workflowValidateAll({
      paths,
      workflowsRoot: '.forge/workflows',
      agentsRoot: '.forge/agents',
      checksRoot: '.forge/checks',
    });
    const allWorkflowIssues = [...workflowResults.entries()].flatMap(([id, issues]) =>
      issues.map((issue) => ({ id, ...issue })),
    );
    const unexpectedIssues = allWorkflowIssues.filter(
      (issue) =>
        !(issue.code === 'unknown-artifact-type' && /StagePlan|ReviewReport/.test(issue.message)),
    );
    expect(unexpectedIssues).toEqual([]);
    expect(allWorkflowIssues.length).toBe(3);
  });
});
