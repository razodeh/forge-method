/**
 * A Story's `owner_role` must be an implementation role (`PLAN-M13.md` P36, `09` §9.3, `10` §10.6), through the real launcher
 * as a subprocess against a project holding the shipped workflows and the real resolved agent roster (`.forge/agents`), with
 * `-C` (never the repository as cwd).
 *
 * `implement-story`'s steps run as `{{ownerRole}}` with that agent's own write grant, so an owner that authors documents
 * (`analyst`, `pm`, `security`) or judges work (`reviewer`, `sdet`) would write a story's source. The set of allowed roles is
 * derived from the roster (an agent that declares a `Code` output), never listed by the code under test: the test names the
 * roles it expects from the shipped agent files.
 *
 * @see specs/09 §9.3
 * @see specs/10 §10.6
 * @see PLAN-M13.md P36
 */
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { execa } from 'execa';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as YAML from 'yaml';
import { DEFAULT_CONFIG } from '@forge/schemas/config';

import { readResolvedAgents, readWorkflowFiles } from '../src/init/content.ts';

const LAUNCHER = fileURLToPath(new URL('../bin/forge.mjs', import.meta.url));
const MODULES_DIR = fileURLToPath(new URL('../../../modules', import.meta.url));

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

interface Result {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Run from a neutral cwd with `-C`, so the repository is never the project. */
function forge(args: readonly string[], project: string): Result {
  try {
    const stdout = execFileSync(process.execPath, [LAUNCHER, '-C', project, ...args], {
      encoding: 'utf8',
      cwd: tmpdir(),
      timeout: 90_000,
      stdio: ['ignore', 'pipe', 'pipe'],
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

async function writeDoc(dir: string, rel: string, front: Record<string, unknown>): Promise<void> {
  const file = path.join(dir, 'docs/forge/specs', rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `---\n${YAML.stringify(front)}---\n\nBody.\n`, 'utf8');
}

async function project(ownerRoles: readonly string[]): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-owner-role-'));
  dirs.push(dir);
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 't@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 'T'], { cwd: dir });
  await mkdir(path.join(dir, '.forge/workflows'), { recursive: true });
  await writeFile(path.join(dir, '.forge/config.yaml'), YAML.stringify(DEFAULT_CONFIG), 'utf8');
  await writeFile(path.join(dir, '.gitignore'), '.forge/state/\n');
  for (const file of await readWorkflowFiles()) {
    await writeFile(path.join(dir, '.forge/workflows', path.basename(file.relPath)), file.content);
  }
  await mkdir(path.join(dir, '.forge/agents'), { recursive: true });
  for (const agent of await readResolvedAgents(MODULES_DIR)) {
    await writeFile(path.join(dir, '.forge/agents', `${agent.id}.yaml`), agent.yaml);
  }
  await writeDoc(dir, 'epics/EPIC-001.md', {
    ...BASE,
    id: 'EPIC-001',
    type: 'Epic',
    title: 'Epic',
    status: 'ready',
    capability: 'CAP-001',
    stage: 'mvp',
    goal: 'A goal.',
    scope_in: [],
    scope_out: [],
    stories: ownerRoles.map((_role, index) => `STORY-00${String(index + 1)}`),
    interfaces: [],
    data: [],
    exit_criteria: [],
  });
  for (const [index, role] of ownerRoles.entries()) {
    const id = `STORY-00${String(index + 1)}`;
    await writeDoc(dir, `stories/${id}.md`, {
      ...BASE,
      id,
      type: 'Story',
      title: `Story ${id}`,
      status: 'ready',
      epic: 'EPIC-001',
      capability: 'CAP-001',
      storyType: 'feature',
      size: 'M',
      owner_role: role,
      depends_on: [],
      blocked_by: [],
      interfaces: [],
      data: [],
      files_expected: [`src/${id.toLowerCase()}/**`],
      context_refs: [],
      acceptance: [],
      tests: [],
      dod_profile: 'backend-default',
    });
  }
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: dir });
  return dir;
}

let implementers: readonly string[] = [];
let nonImplementers: readonly string[] = [];
beforeAll(async () => {
  const agents = await readResolvedAgents(MODULES_DIR);
  const declaresCode = (yaml: string): boolean =>
    (YAML.parse(yaml) as { outputs: readonly { type: string }[] }).outputs.some(
      (output) => output.type === 'Code',
    );
  implementers = agents.filter((agent) => declaresCode(agent.yaml)).map((agent) => agent.id);
  nonImplementers = agents.filter((agent) => !declaresCode(agent.yaml)).map((agent) => agent.id);
});

describe('the shipped roster', () => {
  it('has implementation roles and authoring roles, so the tests below are not vacuous', () => {
    expect(implementers).toEqual(expect.arrayContaining(['backend', 'frontend']));
    expect(nonImplementers).toEqual(
      expect.arrayContaining(['analyst', 'pm', 'security', 'reviewer', 'sdet']),
    );
  });
});

describe('forge run implement-story --story: an owner that is not an implementation role', () => {
  it('refuses analyst, pm, security, sre, release and ux (RUN-097), naming the roles that are allowed, before anything runs', async () => {
    const roles = ['analyst', 'pm', 'security', 'sre', 'release', 'ux'];
    const dir = await project(roles);
    for (const [index, role] of roles.entries()) {
      const id = `STORY-00${String(index + 1)}`;
      const result = forge(['run', 'implement-story', '--story', id, '--dry-run'], dir);
      expect(result.status, role).not.toBe(0);
      expect(result.stderr).toContain('cannot be implemented');
      expect(result.stderr).toContain(`owner_role "${role}" is not an implementation role`);
      for (const allowed of implementers) expect(result.stderr).toContain(allowed);
    }
  });

  it('refuses sdet and reviewer too: RUN-091 for the separation is unchanged, and the role is not an implementer either', async () => {
    const dir = await project(['sdet', 'reviewer']);
    const sdet = forge(['run', 'implement-story', '--story', 'STORY-001', '--dry-run'], dir);
    expect(sdet.status).not.toBe(0);
    expect(sdet.stderr).toContain('under the one role sdet');
    const reviewer = forge(['run', 'implement-story', '--story', 'STORY-002', '--dry-run'], dir);
    expect(reviewer.status).not.toBe(0);
    expect(reviewer.stderr).toContain('under the one role reviewer');
  });

  it('accepts every implementation role the roster declares', async () => {
    const dir = await project([...implementers]);
    for (const [index, role] of implementers.entries()) {
      const id = `STORY-00${String(index + 1)}`;
      const result = forge(['run', 'implement-story', '--story', id, '--dry-run'], dir);
      expect(result.status, `${role}: ${result.stderr}`).toBe(0);
    }
  });

  it('`forge implement` shares the refusal', async () => {
    const dir = await project(['pm']);
    const result = forge(['implement', 'STORY-001', '--dry-run'], dir);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('is not an implementation role');
  });

  it('a stage run refuses the story too (RUN-090 lists the finding), and `forge plan run-plan` reports it as an error', async () => {
    const dir = await project(['backend', 'security']);
    const stage = forge(['run', 'build-stage', '--stage', 'mvp', '--dry-run'], dir);
    expect(stage.status).not.toBe(0);
    expect(stage.stderr).toContain('owner-role-not-implementation');
    expect(stage.stderr).toContain('STORY-002');
    expect(stage.stderr).not.toContain('Story STORY-001: owner_role');
    const plan = forge(['plan', 'run-plan', 'mvp', '--json'], dir);
    expect(plan.status).not.toBe(0);
    const report = JSON.parse(plan.stdout) as { ok: boolean; findings: { code: string }[] };
    expect(report.ok).toBe(false);
    expect(report.findings.map((finding) => finding.code)).toContain(
      'owner-role-not-implementation',
    );
  });
});

describe('forge spec validate: a Story whose owner is not an implementation role is a validation error', () => {
  it('reports it with a remedy, for a story at any status, and stays quiet about an implementer', async () => {
    const dir = await project(['security', 'backend']);
    const result = forge(['spec', 'validate', '--json'], dir);
    expect(result.status).not.toBe(0);
    const report = JSON.parse(result.stdout) as {
      errors: number;
      documents: { path: string; valid: boolean; errors: string[] }[];
    };
    const bad = report.documents.find((doc) => doc.path.endsWith('STORY-001.md'));
    const good = report.documents.find((doc) => doc.path.endsWith('STORY-002.md'));
    expect(bad?.valid).toBe(false);
    expect(bad?.errors.join('\n')).toMatch(/owner_role "security" is not an implementation role/);
    expect(bad?.errors.join('\n')).toContain('Set owner_role to one of them');
    expect(good?.errors.join('\n') ?? '').not.toContain('owner_role');
  });

  it('`--rule definition-of-ready` (G-Ready) also refuses a ready story with such an owner', async () => {
    const dir = await project(['pm']);
    const result = forge(['spec', 'validate', '--rule', 'definition-of-ready', '--json'], dir);
    const body = JSON.parse(result.stdout) as {
      violations: { subject: string; message: string }[];
    };
    expect(body.violations.map((v) => v.message).join('\n')).toContain(
      'not an implementation role',
    );
  });

  it('one corrupt, unrelated agent file does not switch the check off: the owner is still refused', async () => {
    const dir = await project(['pm']);
    await writeFile(path.join(dir, '.forge/agents/zzz-broken.yaml'), 'id: [unterminated\n  :::\n');
    const run = forge(['run', 'implement-story', '--story', 'STORY-001', '--dry-run'], dir);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('is not an implementation role');
    const validate = forge(['spec', 'validate', '--json'], dir);
    const report = JSON.parse(validate.stdout) as { documents: { errors: string[] }[] };
    expect(report.documents.flatMap((doc) => doc.errors).join('\n')).toContain(
      'not an implementation role',
    );
  });

  it('a project without a roster is not judged (nothing to derive the roles from)', async () => {
    const dir = await project(['security']);
    await rm(path.join(dir, '.forge/agents'), { recursive: true, force: true });
    const result = forge(['spec', 'validate', '--json'], dir);
    const report = JSON.parse(result.stdout) as { documents: { errors: string[] }[] };
    expect(report.documents.flatMap((doc) => doc.errors).join('\n')).not.toContain(
      'implementation role',
    );
  });
});
