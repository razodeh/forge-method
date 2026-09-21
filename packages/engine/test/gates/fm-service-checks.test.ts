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

/** `expect.stringContaining` is typed `any`; the assertion is a string match, so say so. */
const like = (text: string): string => expect.stringContaining(text) as string;

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
    expect(raw.failOn).toBe('testsCovering < contracts || errors > 0');
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
    expect(JSON.parse(result.checks[0]!.stdout)).toEqual({
      contracts: 1,
      testsCovering: 1,
      errors: 0,
    });
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
    expect(JSON.parse(result.checks[0]!.stdout)).toEqual({
      contracts: 1,
      testsCovering: 0,
      errors: 0,
    });
  });

  // `PLAN-M13.md` P41: these used to assert a PASS ("passes vacuously ... rather than crashing"). Zero contracts
  // verified is not a verified contract (`testsCovering < contracts` is `0 < 0`, false), so a missing input is now
  // a failure with a reason (P35: a check must positively show success).
  it('FAILS, with a reason, against a project with no interfaces directory: no contract verified is not a pass', async () => {
    const dir = await makeFixtureDir();
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, realRunner);
    expect(result.passed).toBe(false);
    expect(JSON.parse(result.checks[0]!.stdout)).toMatchObject({
      contracts: 0,
      testsCovering: 0,
      errors: 1,
      reason: like('no docs/forge/specs/interfaces directory'),
    });
  });

  it('counts .yml and .json contracts too: an untested one is not exempt by its extension', async () => {
    const dir = await makeFixtureDir();
    await mkdir(path.join(dir, 'docs', 'forge', 'specs', 'interfaces'), { recursive: true });
    await mkdir(path.join(dir, 'test', 'contract'), { recursive: true });
    for (const name of ['a.yaml', 'b.json', 'c.yml']) {
      await writeFile(path.join(dir, 'docs', 'forge', 'specs', 'interfaces', name), 'x: 1\n');
    }
    await writeFile(path.join(dir, 'test', 'contract', 'a.contract.test.ts'), '// a\n');
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, realRunner);
    expect(result.passed).toBe(false);
    expect(JSON.parse(result.checks[0]!.stdout)).toMatchObject({ contracts: 3, testsCovering: 1 });
  });

  it('FAILS on an EMPTY contract file: it cannot be verified, and it must not count as a contract that is covered', async () => {
    const dir = await makeFixtureDir();
    await mkdir(path.join(dir, 'docs', 'forge', 'specs', 'interfaces'), { recursive: true });
    await mkdir(path.join(dir, 'test', 'contract'), { recursive: true });
    await writeFile(path.join(dir, 'docs', 'forge', 'specs', 'interfaces', 'a.yaml'), '');
    await writeFile(path.join(dir, 'test', 'contract', 'a.contract.test.ts'), '// a\n');
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, realRunner);
    expect(result.passed).toBe(false);
    expect(JSON.parse(result.checks[0]!.stdout)).toMatchObject({
      errors: 1,
      reason: like('empty contract file'),
    });
  });

  it('does not count an EMPTY contract test file as covering the contract', async () => {
    const dir = await makeFixtureDir();
    await mkdir(path.join(dir, 'docs', 'forge', 'specs', 'interfaces'), { recursive: true });
    await mkdir(path.join(dir, 'test', 'contract'), { recursive: true });
    await writeFile(
      path.join(dir, 'docs', 'forge', 'specs', 'interfaces', 'orders-api.yaml'),
      'id: INT-001\n',
    );
    await writeFile(path.join(dir, 'test', 'contract', 'orders-api.contract.test.ts'), '');
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, realRunner);
    expect(result.passed).toBe(false);
    expect(JSON.parse(result.checks[0]!.stdout)).toMatchObject({ contracts: 1, testsCovering: 0 });
  });

  it('FAILS when the interfaces directory exists but freezes no contract', async () => {
    const dir = await makeFixtureDir();
    await mkdir(path.join(dir, 'docs', 'forge', 'specs', 'interfaces'), { recursive: true });
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, realRunner);
    expect(result.passed).toBe(false);
    expect(JSON.parse(result.checks[0]!.stdout)).toMatchObject({
      errors: 1,
      reason: like('no frozen contracts'),
    });
  });
});

describe('checks/api-breaking-change.check.yaml — real command, real parser, real failOn, against a real git repository', () => {
  const raw = readCheck('api-breaking-change.check.yaml');

  /** FORGE_BASE_REF is required (an unset ref is a failure, below); these tests compare against HEAD, the
   * uncommitted edits, unless a test names another ref itself. */
  const headRunner: CheckRunner = async (check, cwd) => {
    const ran = await execa(check.run, {
      cwd,
      shell: true,
      reject: false,
      env: { FORGE_BASE_REF: process.env['FORGE_BASE_REF'] ?? 'HEAD' },
    });
    return { stdout: ran.stdout, exitCode: ran.exitCode ?? -1 };
  };

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
    expect(raw.failOn).toBe('removedOperations > 0 || errors > 0');
    expect(raw.remedy.trim().length).toBeGreaterThan(0);
  });

  it('passes when the working tree makes no change to any interface contract', async () => {
    const dir = await makeGitFixture();
    await commitInterfaceFile(dir, ORIGINAL_CONTRACT);
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, headRunner);
    expect(result.passed).toBe(true);
    expect(JSON.parse(result.checks[0]!.stdout)).toEqual({ removedOperations: 0, errors: 0 });
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
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, headRunner);
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
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, headRunner);
    expect(result.passed).toBe(true);
    expect(JSON.parse(result.checks[0]!.stdout)).toEqual({ removedOperations: 0, errors: 0 });
  });

  // `PLAN-M13.md` P41: the check used to swallow a failing `git diff` (`catch { diff = "" }`) and report
  // `removedOperations: 0`, so a repository with no commits, or a base ref that does not exist, PASSED without
  // comparing anything. A diff that could not be taken is now a failure with git's own reason.
  it('FAILS when FORGE_BASE_REF is not set: git diff HEAD only sees uncommitted edits, so a committed removal would go unseen', async () => {
    const dir = await makeGitFixture();
    await commitInterfaceFile(dir, ORIGINAL_CONTRACT);
    await rm(path.join(dir, 'docs', 'forge', 'specs', 'interfaces', 'orders-api.yaml'));
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '-m', 'remove the contract'], { cwd: dir });
    const env = { ...process.env };
    delete env['FORGE_BASE_REF'];
    const result = await evaluateGate(
      oneCheckGate(toDeterministicCheck(raw)),
      dir,
      async (check, cwd) => {
        const ran = await execa(check.run, {
          cwd,
          shell: true,
          reject: false,
          env,
          extendEnv: false,
        });
        return { stdout: ran.stdout, exitCode: ran.exitCode ?? -1 };
      },
    );
    expect(result.passed).toBe(false);
    expect(JSON.parse(result.checks[0]!.stdout)).toMatchObject({
      errors: 1,
      reason: like('FORGE_BASE_REF is not set'),
    });
    // ...and with the ref named, the committed removal is seen
    const seen = await evaluateGate(
      oneCheckGate(toDeterministicCheck(raw)),
      dir,
      async (check, cwd) => {
        const ran = await execa(check.run, {
          cwd,
          shell: true,
          reject: false,
          env: { FORGE_BASE_REF: 'HEAD~1' },
        });
        return { stdout: ran.stdout, exitCode: ran.exitCode ?? -1 };
      },
    );
    expect(seen.passed).toBe(false);
    expect(
      (JSON.parse(seen.checks[0]!.stdout) as { removedOperations: number }).removedOperations,
    ).toBeGreaterThan(0);
  });

  it('FAILS when git diff fails (a repository with no commits has nothing to compare against)', async () => {
    const dir = await makeGitFixture();
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, headRunner);
    expect(result.passed).toBe(false);
    expect(JSON.parse(result.checks[0]!.stdout)).toMatchObject({
      removedOperations: 0,
      errors: 1,
      reason: like('git diff HEAD failed, so nothing was compared'),
    });
  });

  it('FAILS when FORGE_BASE_REF names a ref that does not exist, instead of falling back to HEAD', async () => {
    const dir = await makeGitFixture();
    await commitInterfaceFile(dir, ORIGINAL_CONTRACT);
    const result = await evaluateGate(
      oneCheckGate(toDeterministicCheck(raw)),
      dir,
      async (check, cwd) => {
        const ran = await execa(check.run, {
          cwd,
          shell: true,
          reject: false,
          env: { FORGE_BASE_REF: 'no-such-branch' },
        });
        return { stdout: ran.stdout, exitCode: ran.exitCode ?? -1 };
      },
    );
    expect(result.passed).toBe(false);
    expect(JSON.parse(result.checks[0]!.stdout)).toMatchObject({
      errors: 1,
      reason: like('git diff no-such-branch failed'),
    });
  });

  it('FAILS a committed repository that has no interfaces directory at all: there is nothing to compare (a pass here would say "no breaking change" about nothing)', async () => {
    const dir = await makeGitFixture();
    await writeFile(path.join(dir, 'README.md'), '# service\n');
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '-m', 'init'], { cwd: dir });
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, headRunner);
    expect(result.passed).toBe(false);
    expect(JSON.parse(result.checks[0]!.stdout)).toMatchObject({
      errors: 1,
      reason: like('nothing to compare'),
    });
  });

  it('a deleted interfaces directory is still the breaking change it is (removed operations, not a "nothing to compare" pass)', async () => {
    const dir = await makeGitFixture();
    await commitInterfaceFile(dir, ORIGINAL_CONTRACT);
    await rm(path.join(dir, 'docs', 'forge', 'specs', 'interfaces'), { recursive: true });
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, headRunner);
    expect(result.passed).toBe(false);
    expect(JSON.parse(result.checks[0]!.stdout)).toMatchObject({ errors: 0 });
    expect(
      (JSON.parse(result.checks[0]!.stdout) as { removedOperations: number }).removedOperations,
    ).toBeGreaterThan(0);
  });

  const withRef = (ref: string) => async (check: DeterministicCheck, cwd: string) => {
    const ran = await execa(check.run, {
      cwd,
      shell: true,
      reject: false,
      env: { FORGE_BASE_REF: ref },
    });
    return { stdout: ran.stdout, exitCode: ran.exitCode ?? -1 };
  };

  it.each(['HEAD..HEAD', 'HEAD...HEAD', 'main..main', 'HEAD@{1}', '-x', 'a b'])(
    'refuses the FORGE_BASE_REF %s (a range compares nothing; it used to pass with 0 removed)',
    async (ref) => {
      const dir = await makeGitFixture();
      await commitInterfaceFile(dir, ORIGINAL_CONTRACT);
      await rm(path.join(dir, 'docs', 'forge', 'specs', 'interfaces', 'orders-api.yaml'));
      const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, withRef(ref));
      expect(result.passed).toBe(false);
      expect(JSON.parse(result.checks[0]!.stdout)).toMatchObject({
        errors: 1,
        reason: like('not a plain ref name'),
      });
    },
  );

  it.each(['HEAD~1', 'HEAD^', 'main', 'origin/main'])(
    'accepts the ordinary ref %s (it reaches git, which may still say the ref does not exist)',
    async (ref) => {
      const dir = await makeGitFixture();
      await commitInterfaceFile(dir, ORIGINAL_CONTRACT);
      const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, withRef(ref));
      expect(JSON.stringify(JSON.parse(result.checks[0]!.stdout))).not.toContain(
        'not a plain ref name',
      );
    },
  );

  it('sees removals under git colour config (an ESC byte before every diff line hid them from the key pattern)', async () => {
    const dir = await makeGitFixture();
    await commitInterfaceFile(dir, ORIGINAL_CONTRACT);
    await execa('git', ['config', 'color.ui', 'always'], { cwd: dir });
    await execa('git', ['config', 'color.diff', 'always'], { cwd: dir });
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
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, headRunner);
    expect(result.passed).toBe(false);
    expect(
      (JSON.parse(result.checks[0]!.stdout) as { removedOperations: number }).removedOperations,
    ).toBeGreaterThan(0);
  });

  it('counts removals by multiplicity: removing one of two identical method keys is a removal even when the other stays', async () => {
    const dir = await makeGitFixture();
    await commitInterfaceFile(dir, ORIGINAL_CONTRACT);
    // `get:` appears twice in the contract; one is deleted, none added
    await writeFile(
      path.join(dir, 'docs', 'forge', 'specs', 'interfaces', 'orders-api.yaml'),
      [
        'openapi: 3.1.0',
        'paths:',
        '  /orders:',
        '    get:',
        '      operationId: listOrders',
        '  /orders/{id}:',
        '',
      ].join('\n'),
    );
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, headRunner);
    expect(result.passed).toBe(false);
  });

  it('FAILS when the interfaces directory exists but is empty (nothing frozen to compare)', async () => {
    const dir = await makeGitFixture();
    await writeFile(path.join(dir, 'README.md'), '# service\n');
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '-m', 'init'], { cwd: dir });
    await mkdir(path.join(dir, 'docs', 'forge', 'specs', 'interfaces'), { recursive: true });
    const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, headRunner);
    expect(result.passed).toBe(false);
    expect(JSON.parse(result.checks[0]!.stdout)).toMatchObject({ errors: 1 });
  });

  it('a hostile FORGE_BASE_REF (shell-metacharacter-shaped, mirroring an attacker-influenced CI ref) achieves no side effect -- a real defect a critic round found and this pins: the first draft built its own git-diff command as a template string and ran it through execSync, which always spawns a real shell regardless of an explicit "shell" option', async () => {
    const dir = await makeGitFixture();
    await commitInterfaceFile(dir, ORIGINAL_CONTRACT);
    const sentinel = path.join(dir, 'pwned');
    const previousBaseRef = process.env['FORGE_BASE_REF'];
    process.env['FORGE_BASE_REF'] = `main; touch ${sentinel}`;
    try {
      const result = await evaluateGate(oneCheckGate(toDeterministicCheck(raw)), dir, headRunner);
      // The hostile value fails the ref-name allowlist and is REFUSED (it used to fall back to HEAD, which
      // passed without comparing what the caller asked to compare, `PLAN-M13.md` P41): no shell ever saw it.
      expect(result.passed).toBe(false);
      expect(JSON.parse(result.checks[0]!.stdout)).toMatchObject({
        errors: 1,
        reason: like('FORGE_BASE_REF is not a plain ref name'),
      });
    } finally {
      if (previousBaseRef === undefined) delete process.env['FORGE_BASE_REF'];
      else process.env['FORGE_BASE_REF'] = previousBaseRef;
    }
    await expect(access(sentinel)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
