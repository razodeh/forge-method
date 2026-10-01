/**
 * `forge story evidence <storyId> [--json]` (`specs/22` M15 P7, `implement-story.workflow.yaml`'s own
 * `evidence` command step), invoked as a real subprocess — the identical "real subprocess, real project
 * directory" discipline `bin-story-verify.test.ts` already establishes for its sibling command.
 *
 * @see specs/18-persistence-config-and-schemas.md §18.7
 * @see PLAN-M15.md P7
 * @see SPEC-QUESTIONS.md Q286
 */
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileStepId } from '@forge/engine/plan';
import { evidenceBundleSchema } from '@forge/schemas';
import { DEFAULT_CONFIG } from '@forge/schemas/config';
import { appendEvent } from '@forge/telemetry/events';
import { afterEach, describe, expect, it } from 'vitest';
import * as YAML from 'yaml';

const LAUNCHER = fileURLToPath(new URL('../bin/forge.mjs', import.meta.url));

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

interface Result {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

function forge(
  args: readonly string[],
  cwd: string,
  env?: Readonly<Record<string, string>>,
): Result {
  try {
    const stdout = execFileSync(process.execPath, [LAUNCHER, ...args], {
      encoding: 'utf8',
      cwd,
      timeout: 60_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const e = error as { status: number | null; stdout: string; stderr: string };
    return { status: e.status ?? 1, stdout: e.stdout, stderr: e.stderr };
  }
}

const BASE = {
  schemaVersion: 1,
  created: '2026-01-01',
  updated: '2026-01-01',
  revision: 1,
  author: 'po',
  changelog: [],
};

const STORY = {
  ...BASE,
  id: 'STORY-001',
  type: 'Story',
  title: 'Fixture story',
  status: 'in-progress',
  epic: 'EPIC-001',
  capability: 'CAP-001',
  storyType: 'feature',
  size: 'M',
  owner_role: 'backend',
  depends_on: [],
  blocked_by: [],
  interfaces: [],
  data: [],
  files_expected: ['src/a.ts'],
  context_refs: [],
  acceptance: [{ id: 'AC-001-1', given: 'g', when: 'w', then: 't', kind: 'functional' }],
  tests: [],
  dod_profile: 'backend-default',
};

/** A bare project with a `done`-phase DoD check, `passingDone` deciding whether it passes — this
 * file's own job is `forge story evidence`'s wiring, not re-proving `story verify`'s own behaviour
 * (`bin-story-verify.test.ts` already does that exhaustively). */
async function project(passingDone = true): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-cli-story-evidence-'));
  dirs.push(dir);
  await mkdir(path.join(dir, '.forge'), { recursive: true });
  await writeFile(path.join(dir, '.forge/config.yaml'), YAML.stringify(DEFAULT_CONFIG), 'utf8');
  await mkdir(path.join(dir, 'docs/forge/specs/stories'), { recursive: true });
  await writeFile(
    path.join(dir, 'docs/forge/specs/stories/STORY-001.md'),
    `---\n${YAML.stringify(STORY)}---\n\nBody.\n`,
    'utf8',
  );
  await mkdir(path.join(dir, 'docs/forge/kb/engineering'), { recursive: true });
  const doneCheck = passingDone
    ? "'story.acceptance.length > 0'"
    : "'story.acceptance.length > 99'";
  await writeFile(
    path.join(dir, 'docs/forge/kb/engineering/dod-profiles.yaml'),
    `profiles:\n  backend-default:\n    ready: []\n    verify: []\n    done:\n      - ${doneCheck}\n`,
    'utf8',
  );
  return dir;
}

/** Seeds a real `ArtifactCreated`/`ReviewReport` event for `runId`'s own event log, at the exact
 * compiled step id a real `review` step of an `implement-story` run uses — the bare, unqualified
 * `implement-story:review` (`implement-story` always runs standalone, one story per `forge run`, so
 * `runId` alone already scopes this to one story; see `evidence-bundle.ts`'s own top-of-file doc
 * comment). The one piece of state `forge story evidence` cannot synthesize itself and must be given. */
async function seedReview(projectRoot: string, runId: string): Promise<void> {
  await appendEvent(projectRoot, runId, {
    ts: '2026-01-01T12:00:00.000Z',
    runId,
    type: 'ArtifactCreated',
    stepId: compileStepId('implement-story', 'review'),
    agentId: 'reviewer',
    payload: {
      type: 'ReviewReport',
      id: 'REVIEW-001',
      laneFile: 'x',
      verdict: 'clear',
      perspectives: [],
    },
  });
}

describe('forge story evidence (real subprocess)', () => {
  it('writes a real, schema-valid EvidenceBundle and exits 0 with a {v:1} envelope', async () => {
    const dir = await project();
    const runId = 'run-1';
    await seedReview(dir, runId);

    const result = forge(['story', 'evidence', 'STORY-001', '--json'], dir, {
      FORGE_RUN_ID: runId,
    });
    expect(result.status, result.stderr).toBe(0);
    const body = JSON.parse(result.stdout) as {
      v: number;
      id: string;
      path: string;
      story: string;
    };
    expect(body.id).toMatch(/^EVID-\d{3}$/);
    expect(body.story).toBe('STORY-001');

    const text = await readFile(path.join(dir, body.path), 'utf8');
    const parsed = evidenceBundleSchema.safeParse(YAML.parse(text.split('---\n')[1] ?? ''));
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
    if (parsed.success) {
      expect(parsed.data.story).toBe('STORY-001');
      expect(parsed.data.reviews).toEqual([{ id: 'REVIEW-001', verdict: 'clear' }]);
    }
  });

  it('refuses with GATE-516 (missing-review), exit 5 (a real precondition, not a usage mistake), naming the story, when no review was ever recorded for it', async () => {
    const dir = await project();
    const result = forge(['story', 'evidence', 'STORY-001', '--json'], dir, {
      FORGE_RUN_ID: 'run-1',
    });
    expect(result.status).toBe(5);
    expect(result.stderr).toContain('cannot assemble an EvidenceBundle');
    expect(result.stderr).toContain('STORY-001');
  });

  it('refuses, and writes no bundle, when the done-phase verification it just re-ran genuinely fails -- never commits a "passed: false" checkpoint as a success', async () => {
    const dir = await project(false);
    const runId = 'run-1';
    await seedReview(dir, runId);

    const result = forge(['story', 'evidence', 'STORY-001', '--json'], dir, {
      FORGE_RUN_ID: runId,
    });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ passed: false });
    // assembleAndWriteEvidenceBundle is never reached: no reports/evidence/ directory is ever created.
    await expect(readdir(path.join(dir, 'docs/forge/reports/evidence'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('propagates story verify\'s own "story not found" refusal, never attempting evidence assembly', async () => {
    const dir = await project();
    const result = forge(['story', 'evidence', 'STORY-404', '--json'], dir, {
      FORGE_RUN_ID: 'run-1',
    });
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('STORY-404');
  });

  it("refuses --dry-run (it re-runs the story's own done-phase verification) and runs nothing", async () => {
    const dir = await project();
    const result = forge(['story', 'evidence', 'STORY-001', '--dry-run'], dir);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--dry-run');
  });

  it('exits 2 for the usage mistakes: no id, two ids, a stray flag, a bad subcommand, none', async () => {
    const dir = await project();
    for (const args of [
      ['story', 'evidence'],
      ['story', 'evidence', 'STORY-001', 'STORY-002'],
      ['story', 'evidence', 'STORY-001', '--bogus'],
      ['story', 'nonsense', 'STORY-001'],
      ['story'],
    ]) {
      expect(forge(args, dir).status, args.join(' ')).toBe(2);
    }
  });

  it('checks the arguments before it reads the project: a bare directory still exits 2, not a config error', async () => {
    const bare = await mkdtemp(path.join(tmpdir(), 'forge-cli-story-evidence-bare-'));
    dirs.push(bare);
    expect(forge(['story', 'evidence'], bare).status).toBe(2);
    expect(forge(['story', 'evidence', 'STORY-001'], bare).status).toBe(5);
  });
});
