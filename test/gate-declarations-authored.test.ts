/**
 * `PLAN-M14.md` P21 — the four steps that write `architecture/version-skew.yaml` and
 * `data/migrations.yaml` (`build-stage:freeze-contracts`, fm-service `contract-test-cycle:draft-contract`,
 * `shape-solution:model-data`, `migrate:plan-migration`) actually claim the file they write, and their
 * briefs actually tell the agent the shape `packages/cli/src/commands/spec/integration-rules.ts`'s
 * `version-skew`/`migration-order-violations` rules read. `test/brief-write-paths-in-claim.test.ts`
 * already proves, for every shipped step, that every write a brief names is inside that step's claim
 * (the generic, content-driven half of this); this file adds what is specific to these two declarations:
 * that at least one brief per file names the exact path and every key
 * `VERSION_SKEW_KEYS`/`MIGRATION_KEYS` exports (derived from the real, module-private zod schemas, not
 * copied by hand, so neither list can drift silently), that the two "who says why" sentences the
 * mandate asks for are actually there, and that the YAML sample each of those briefs shows the agent is
 * not merely plausible prose but a real, round-trippable fixture the real rule functions accept — and
 * genuinely reject with one key misspelled.
 *
 * @see specs/10 §10.3
 * @see specs/12 F-DATA-6
 * @see specs/14 §14.4 rule 3
 * @see specs/06 §6.7
 * @see specs/20 §20.1
 * @see PLAN-M14.md P21
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';
import * as YAML from 'yaml';

import { ProjectPaths } from '@forge/core/fs';

import type { SpecCommandContext } from '../packages/cli/src/commands/spec.ts';
import {
  MIGRATION_KEYS,
  MIGRATIONS_FILE,
  validateMigrationOrder,
  validateVersionSkew,
  VERSION_SKEW_FILE,
  VERSION_SKEW_KEYS,
} from '../packages/cli/src/commands/spec/integration-rules.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const briefsDir = path.join(repoRoot, 'packages', 'templates', 'templates', 'briefs');
const workflowsDir = path.join(repoRoot, 'packages', 'templates', 'templates', 'workflows');
const modulesDir = path.join(repoRoot, 'modules');

const KB_ROOT = 'docs/forge/kb';
const SKEW_PATH = `${KB_ROOT}/${VERSION_SKEW_FILE}`;
const MIGRATIONS_PATH = `${KB_ROOT}/${MIGRATIONS_FILE}`;

async function brief(name: string): Promise<string> {
  return readFile(path.join(briefsDir, `${name}.md`), 'utf8');
}

interface RawStep {
  readonly id: string;
  readonly produces?: string | readonly string[];
}
interface RawWorkflow {
  readonly steps: readonly RawStep[];
}

/** The literal `produces` list of one step, straight off the real shipped YAML (not a compiled node):
 * this file checks the declared claim itself, independent of `compileRunPlan` or any fixture context. */
async function stepProduces(workflowPath: string, stepId: string): Promise<readonly string[]> {
  const source = await readFile(workflowPath, 'utf8');
  const parsed = YAML.parse(source) as RawWorkflow;
  const step = parsed.steps.find((candidate) => candidate.id === stepId);
  if (step === undefined) throw new Error(`${workflowPath}: no step "${stepId}"`);
  const produces = step.produces ?? [];
  return typeof produces === 'string' ? [produces] : produces;
}

describe('the four steps claim the declaration file their own brief tells them to write (PLAN-M14.md P21)', () => {
  it('build-stage:freeze-contracts claims version-skew.yaml', async () => {
    const produces = await stepProduces(
      path.join(workflowsDir, 'build-stage.workflow.yaml'),
      'freeze-contracts',
    );
    expect(produces).toContain(SKEW_PATH);
  });

  it('fm-service contract-test-cycle:draft-contract claims version-skew.yaml', async () => {
    const produces = await stepProduces(
      path.join(modulesDir, 'fm-service', 'workflows', 'contract-test-cycle.workflow.yaml'),
      'draft-contract',
    );
    expect(produces).toContain(SKEW_PATH);
  });

  it('shape-solution:model-data claims migrations.yaml', async () => {
    const produces = await stepProduces(
      path.join(workflowsDir, 'shape-solution.workflow.yaml'),
      'model-data',
    );
    expect(produces).toContain(MIGRATIONS_PATH);
  });

  it('migrate:plan-migration claims migrations.yaml', async () => {
    const produces = await stepProduces(
      path.join(workflowsDir, 'migrate.workflow.yaml'),
      'plan-migration',
    );
    expect(produces).toContain(MIGRATIONS_PATH);
  });
});

describe('every brief that writes one of the two files names its exact path (PLAN-M14.md P21)', () => {
  it.each([
    ['freeze-contracts', SKEW_PATH],
    ['draft-contract', SKEW_PATH],
    ['model-data', MIGRATIONS_PATH],
    ['plan-migration', MIGRATIONS_PATH],
  ])('%s.md names `%s`', async (name, filePath) => {
    const text = await brief(name);
    expect(text).toContain(filePath);
  });
});

describe('for each file, at least one brief names every key the real schema exports (PLAN-M14.md P21)', () => {
  /** Strips fenced code blocks (their own round-trip is a separate test below) so this check falls on
   * the brief's own PROSE explanation of the shape, not merely on a sample that happens to type every
   * field name as YAML: a brief whose explaining paragraph was deleted, leaving only the sample, must
   * fail here (the piece's own "schema-key paragraph removed" mutation evidence) — checking the whole
   * text (sample included) would let the sample alone satisfy this vacuously for every key the sample
   * happens to show. */
  function stripFencedCode(text: string): string {
    return text.replace(/```[\s\S]*?```/g, '');
  }

  /** Whether `text`'s own PROSE (fenced samples excluded) mentions `filePath` and every one of `keys` —
   * deliberately a plain substring test: every key here is a distinctive `snake_case`/short identifier
   * the brief writes backticked, so a false positive would need the key's exact spelling to appear by
   * coincidence, which the mutation check below rules out for the two briefs this actually asserts on. */
  function namesPathAndEveryKey(text: string, filePath: string, keys: readonly string[]): boolean {
    const prose = stripFencedCode(text);
    return prose.includes(filePath) && keys.every((key) => prose.includes(key));
  }

  it('at least one of freeze-contracts.md/draft-contract.md names every VERSION_SKEW_KEYS key', async () => {
    // Every module-private schema key VERSION_SKEW_KEYS exports actually reached this list (guards the
    // guard: a helper that silently returned nothing would make the assertion below vacuous).
    expect(VERSION_SKEW_KEYS.length).toBeGreaterThanOrEqual(9);
    const texts = await Promise.all(['freeze-contracts', 'draft-contract'].map(brief));
    expect(texts.some((text) => namesPathAndEveryKey(text, SKEW_PATH, VERSION_SKEW_KEYS))).toBe(
      true,
    );
  });

  it('at least one of model-data.md/plan-migration.md names every MIGRATION_KEYS key', async () => {
    expect(MIGRATION_KEYS.length).toBeGreaterThanOrEqual(7);
    const texts = await Promise.all(['model-data', 'plan-migration'].map(brief));
    expect(texts.some((text) => namesPathAndEveryKey(text, MIGRATIONS_PATH, MIGRATION_KEYS))).toBe(
      true,
    );
  });

  it('freeze-contracts.md says every contract is declared', async () => {
    const text = await brief('freeze-contracts');
    expect(text).toMatch(/every valid contract is declared/i);
  });

  it('plan-migration.md names `expands` and `release`', async () => {
    const text = await brief('plan-migration');
    expect(text).toContain('expands');
    expect(text).toContain('release');
  });

  it('critique-integration.md names the check that reads each file, and stays read-only', async () => {
    const text = await brief('critique-integration');
    expect(text).toContain('version:skew');
    expect(text).toContain(SKEW_PATH);
    expect(text).toContain('migration:order');
    expect(text).toContain(MIGRATIONS_PATH);
    // The advisory reviewer never writes: no sentence here should read as a write instruction to the
    // extractor `test/brief-write-paths-in-claim.test.ts` defines (it is not a workflow `agent` step, so
    // that file never scans it directly; this is a second, direct guard against this brief ever gaining
    // one).
    expect(text).not.toMatch(/\b(write|update|append)\s+`docs\/forge\/kb/i);
  });
});

/** A fixture project's `SpecCommandContext`, real enough for `validateVersionSkew`/
 * `validateMigrationOrder` to run against (the same shape `cli/test/commands/spec/integration-rules.test.ts`
 * itself uses), scoped to this file so the round-trip below needs no other package's test helpers. */
interface FixtureProject {
  readonly dir: string;
  readonly ctx: SpecCommandContext;
}

const cleanupDirs: string[] = [];
afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixtureProject(): Promise<FixtureProject> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-gate-declarations-'));
  cleanupDirs.push(dir);
  await mkdir(path.join(dir, KB_ROOT), { recursive: true });
  return {
    dir,
    ctx: { paths: new ProjectPaths(dir), specsRoot: 'docs/forge/specs', kbRoot: KB_ROOT },
  };
}

async function put(project: FixtureProject, relative: string, text: string): Promise<void> {
  const target = path.join(project.dir, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, text, 'utf8');
}

/** A real, schema-valid `InterfaceContract` (`cli/test/commands/spec/integration-rules.test.ts`'s own
 * `contract()` fixture shape): `freeze-contracts.md`'s sample declares `INT-001`, and `version-skew`
 * fails any declared id no contract defines, so the round-trip below needs the contract to actually
 * exist, not only the declaration. */
async function putContract(project: FixtureProject, id: string): Promise<void> {
  await put(
    project,
    `docs/forge/specs/interfaces/${id.toLowerCase()}.yaml`,
    `id: ${id}
type: InterfaceContract
schemaVersion: 1
title: Orders API
status: draft
created: 2026-01-15
updated: 2026-01-15
revision: 1
author: architect
changelog: []
openapi: 3.1.0
`,
  );
}

/** The first ```yaml fenced sample in `text` — the embedded declaration example a brief shows the agent,
 * extracted VERBATIM (no re-typing), so this test proves the sample actually committed is real, not a
 * hand-copied stand-in that could silently drift from it. */
function embeddedYamlSample(text: string): string {
  const match = /```yaml\n([\s\S]*?)```/.exec(text);
  if (match?.[1] === undefined) throw new Error('no ```yaml fenced sample found in this brief');
  return match[1];
}

describe('the embedded declaration samples round-trip through the real rule functions (PLAN-M14.md P21)', () => {
  it('freeze-contracts.md’s version-skew.yaml sample passes version-skew with errors: 0, and a misspelled key fails naming it', async () => {
    const sample = embeddedYamlSample(await brief('freeze-contracts'));
    expect(sample).toContain('max_skew');

    const good = await fixtureProject();
    await putContract(good, 'INT-001');
    await put(good, SKEW_PATH, sample);
    expect((await validateVersionSkew(good.ctx)).violations).toEqual([]);

    const misspelled = sample.replace('max_skew', 'max_skewx');
    expect(misspelled).not.toBe(sample);
    const bad = await fixtureProject();
    await putContract(bad, 'INT-001');
    await put(bad, SKEW_PATH, misspelled);
    const violations = await validateVersionSkew(bad.ctx);
    expect(violations.violations.length).toBeGreaterThan(0);
    expect(violations.violations.map((violation) => violation.message).join(' ')).toContain(
      'max_skew',
    );
  });

  it('model-data.md’s migrations.yaml sample passes migration-order-violations with errors: 0, and a misspelled key fails naming it', async () => {
    const sample = embeddedYamlSample(await brief('model-data'));
    expect(sample).toContain('none_reason');

    const good = await fixtureProject();
    await put(good, MIGRATIONS_PATH, sample);
    expect((await validateMigrationOrder(good.ctx)).violations).toEqual([]);

    const misspelled = sample.replace('none_reason', 'none_reasonx');
    expect(misspelled).not.toBe(sample);
    const bad = await fixtureProject();
    await put(bad, MIGRATIONS_PATH, misspelled);
    const violations = await validateMigrationOrder(bad.ctx);
    expect(violations.violations.length).toBeGreaterThan(0);
    expect(violations.violations.map((violation) => violation.message).join(' ')).toContain(
      'none_reason',
    );
  });
});
