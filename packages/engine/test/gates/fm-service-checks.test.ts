/**
 * `modules/fm-service/checks/{contract-verify,api-breaking-change}.check.yaml` (`PLAN-M10.md` P4, `19`
 * §19.1's own worked-example `checks: [ contract:verify, api:breaking-change ]` row) -- the identical
 * "first standalone `*.check.yaml` content" pattern `packages/engine/test/gates/fm-web-checks.test.ts`
 * already establishes, mirrored here for fm-service's own two checks.
 *
 * `19` §19.3's own Check-authoring "test" row, literally: run each real check against both a passing
 * and a failing fixture, via a real child process (`execa`, not a stub) fed through `@forge/engine/
 * gates`' own real, already-tested `evaluateGate`.
 *
 * @see specs/19 §19.1, §19.3
 * @see PLAN-M10.md P4
 */
import { execa } from 'execa';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { evaluateGate } from '../../src/gates/evaluate.ts';
import type { CheckRunner, DeterministicCheck, GateDefinition } from '../../src/gates/types.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const checksDir = path.join(repoRoot, 'modules', 'fm-service', 'checks');

interface RawCheckFile {
  readonly id: string;
  readonly run: string;
  readonly parser?: string;
  readonly failOn: string;
  readonly remedy: string;
}

function readCheck(fileName: string): RawCheckFile {
  return parseYaml(readFileSync(path.join(checksDir, fileName), 'utf8')) as RawCheckFile;
}

function toDeterministicCheck(raw: RawCheckFile): DeterministicCheck {
  return raw.parser === undefined
    ? { id: raw.id, run: raw.run, failOn: raw.failOn }
    : { id: raw.id, run: raw.run, parser: raw.parser, failOn: raw.failOn };
}

const realRunner: CheckRunner = async (check, cwd) => {
  const result = await execa(check.run, { cwd, shell: true, reject: false });
  return { stdout: result.stdout, exitCode: result.exitCode ?? -1 };
};

function oneCheckGate(check: DeterministicCheck): GateDefinition {
  return {
    id: 'G-Test',
    checks: { deterministic: [check], advisory: [] },
    openQuestionsPolicy: 'block',
  };
}

const tempDirs: string[] = [];
async function makeFixtureDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'fm-service-check-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('checks/contract-verify.check.yaml — real command, real parser, real failOn', () => {
  const raw = readCheck('contract-verify.check.yaml');

  it('has the real DeterministicCheck shape plus a non-empty remedy (19 §19.6)', () => {
    expect(raw.id).toBe('contract:verify');
    expect(raw.run.length).toBeGreaterThan(0);
    expect(raw.failOn).toBe('testsCovering < contracts');
    expect(raw.remedy.trim().length).toBeGreaterThan(0);
  });

  it('passes when every frozen contract has a matching contract test', async () => {
    const dir = await makeFixtureDir();
    await mkdir(path.join(dir, 'docs', 'forge', 'specs', 'interfaces'), { recursive: true });
    await mkdir(path.join(dir, 'test', 'contract'), { recursive: true });
    await writeFile(
      path.join(dir, 'docs', 'forge', 'specs', 'interfaces', 'orders-api.yaml'),
      'id: INT-001\n',
    );
    await writeFile(
      path.join(dir, 'test', 'contract', 'orders-api.contract.test.ts'),
      '// covers orders-api\n',
    );
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, realRunner);
    expect(result.passed).toBe(true);
    expect(JSON.parse(result.checks[0]!.stdout)).toEqual({ contracts: 1, testsCovering: 1 });
  });

  it('fails when a frozen contract has no matching contract test', async () => {
    const dir = await makeFixtureDir();
    await mkdir(path.join(dir, 'docs', 'forge', 'specs', 'interfaces'), { recursive: true });
    await writeFile(
      path.join(dir, 'docs', 'forge', 'specs', 'interfaces', 'orders-api.yaml'),
      'id: INT-001\n',
    );
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, realRunner);
    expect(result.passed).toBe(false);
    expect(JSON.parse(result.checks[0]!.stdout)).toEqual({ contracts: 1, testsCovering: 0 });
  });

  it('passes vacuously (0 contracts) against a project with no interfaces directory yet, rather than crashing', async () => {
    const dir = await makeFixtureDir();
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, realRunner);
    expect(result.passed).toBe(true);
    expect(JSON.parse(result.checks[0]!.stdout)).toEqual({ contracts: 0, testsCovering: 0 });
  });
});

describe('checks/api-breaking-change.check.yaml — real command, real parser, real failOn, against a real git repository', () => {
  const raw = readCheck('api-breaking-change.check.yaml');

  async function makeGitFixture(): Promise<string> {
    const dir = await makeFixtureDir();
    await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
    await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    await execa('git', ['config', 'user.name', 'Test'], { cwd: dir });
    return dir;
  }

  async function commitInterfaceFile(dir: string, content: string): Promise<void> {
    await mkdir(path.join(dir, 'docs', 'forge', 'specs', 'interfaces'), { recursive: true });
    await writeFile(
      path.join(dir, 'docs', 'forge', 'specs', 'interfaces', 'orders-api.yaml'),
      content,
    );
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '-m', 'commit contract'], { cwd: dir });
  }

  const ORIGINAL_CONTRACT = [
    'openapi: 3.1.0',
    'paths:',
    '  /orders:',
    '    get:',
    '      operationId: listOrders',
    '  /orders/{id}:',
    '    get:',
    '      operationId: getOrder',
    '',
  ].join('\n');

  it('has the real DeterministicCheck shape plus a non-empty remedy (19 §19.6)', () => {
    expect(raw.id).toBe('api:breaking-change');
    expect(raw.run.length).toBeGreaterThan(0);
    expect(raw.failOn).toBe('removedOperations > 0');
    expect(raw.remedy.trim().length).toBeGreaterThan(0);
  });

  it('passes when the working tree makes no change to any interface contract', async () => {
    const dir = await makeGitFixture();
    await commitInterfaceFile(dir, ORIGINAL_CONTRACT);
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, realRunner);
    expect(result.passed).toBe(true);
    expect(JSON.parse(result.checks[0]!.stdout)).toEqual({ removedOperations: 0 });
  });

  it('fails when a path is removed from the working tree with no matching addition', async () => {
    const dir = await makeGitFixture();
    await commitInterfaceFile(dir, ORIGINAL_CONTRACT);
    // Remove "/orders/{id}" entirely, uncommitted -- a real, mechanically-detectable breaking change.
    await writeFile(
      path.join(dir, 'docs', 'forge', 'specs', 'interfaces', 'orders-api.yaml'),
      [
        'openapi: 3.1.0',
        'paths:',
        '  /orders:',
        '    get:',
        '      operationId: listOrders',
        '',
      ].join('\n'),
    );
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, realRunner);
    expect(result.passed).toBe(false);
    const parsed = JSON.parse(result.checks[0]!.stdout) as { removedOperations: number };
    expect(parsed.removedOperations).toBeGreaterThan(0);
  });

  it('does not flag a pure reorder of the same paths/methods (identical removed+added text nets to zero)', async () => {
    const dir = await makeGitFixture();
    await commitInterfaceFile(dir, ORIGINAL_CONTRACT);
    // Reorder the two paths -- every removed line has an identical added line elsewhere in the diff.
    await writeFile(
      path.join(dir, 'docs', 'forge', 'specs', 'interfaces', 'orders-api.yaml'),
      [
        'openapi: 3.1.0',
        'paths:',
        '  /orders/{id}:',
        '    get:',
        '      operationId: getOrder',
        '  /orders:',
        '    get:',
        '      operationId: listOrders',
        '',
      ].join('\n'),
    );
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, realRunner);
    expect(result.passed).toBe(true);
    expect(JSON.parse(result.checks[0]!.stdout)).toEqual({ removedOperations: 0 });
  });

  it('passes vacuously (0 removed) against a project with no interfaces directory or no commits yet, rather than crashing', async () => {
    const dir = await makeGitFixture();
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, realRunner);
    expect(result.passed).toBe(true);
    expect(JSON.parse(result.checks[0]!.stdout)).toEqual({ removedOperations: 0 });
  });

  it('a hostile FORGE_BASE_REF (shell-metacharacter-shaped, mirroring an attacker-influenced CI ref) achieves no side effect -- a real defect a critic round found and this pins: the first draft built its own git-diff command as a template string and ran it through execSync, which always spawns a real shell regardless of an explicit "shell" option', async () => {
    const dir = await makeGitFixture();
    await commitInterfaceFile(dir, ORIGINAL_CONTRACT);
    const sentinel = path.join(dir, 'pwned');
    const previousBaseRef = process.env['FORGE_BASE_REF'];
    process.env['FORGE_BASE_REF'] = `main; touch ${sentinel}`;
    try {
      const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, realRunner);
      // Falls back to HEAD (the hostile value fails the ref-name allowlist), so the check still runs
      // safely and reports the real, unremarkable result rather than crashing or hanging.
      expect(result.passed).toBe(true);
      expect(JSON.parse(result.checks[0]!.stdout)).toEqual({ removedOperations: 0 });
    } finally {
      if (previousBaseRef === undefined) delete process.env['FORGE_BASE_REF'];
      else process.env['FORGE_BASE_REF'] = previousBaseRef;
    }
    await expect(access(sentinel)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
