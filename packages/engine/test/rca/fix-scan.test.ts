/**
 * The FIX claim of `forge debug` (`PLAN-M13.md` P28, `SPEC-QUESTIONS.md` Q222; `20` §20.2 points 2 and 3, `20` §20.4,
 * `20` §20.5 point 5; `13` §13.2 step 7): ordinary source and test files, not the protected set, no symlink, no
 * secret-shaped value, no ignored file. The input is git's own listing of what the lane changed (`FixChange`); the
 * real-git side is tested in `packages/cli/test/commands/loop/lane-guard.test.ts`. Secret-shaped values are synthetic.
 */
import { describe, expect, it } from 'vitest';

import type { DocRoots } from '../../src/dispatch/types.ts';
import { protectedFixGlobs, scanFixDiff, type FixChange } from '../../src/rca/fix-scan.ts';

const ROOTS = {
  kb: 'docs/forge/kb',
  specs: 'docs/forge/specs',
  plans: 'docs/forge/plans',
  sessions: 'docs/forge/sessions',
  reports: 'docs/forge/reports',
};

function change(path: string, extra: Partial<FixChange> = {}): FixChange {
  return { path, mode: '100644', deleted: false, submodule: false, added: '', ...extra };
}

function scan(paths: readonly string[], ignored: readonly string[] = []) {
  return scanFixDiff({ changes: paths.map((path) => change(path)), ignored, docRoots: ROOTS });
}

const AWS_SHAPED = 'AKIA' + 'ABCDEFGHIJKLMNOP'; // synthetic

describe('scanFixDiff: paths', () => {
  it('ordinary source and test files are inside the claim', () => {
    expect(
      scan([
        'src/billing/total.ts',
        'tests/billing/regression/DEF-014.test.ts',
        'README.md',
        'lib/a/b/c.py',
      ]),
    ).toEqual([]);
  });

  const protectedPaths = [
    '.git/config',
    '.git/hooks/pre-commit',
    '.forge/config.yaml',
    '.forge/overlays/x.yaml',
    '.forge/state/runs/r/events.ndjson',
    '.env',
    'apps/web/.env.production',
    'node_modules/left-pad/index.js',
    'deploy/server.pem',
    'keys/id_rsa',
    'infra/.aws/credentials',
    '.npmrc',
    'secrets.local.yaml',
    '.github/workflows/ci.yml',
    '.husky/pre-commit',
    '.gitlab-ci.yml',
    'Jenkinsfile',
    '.gitattributes',
    '.gitmodules',
    // what the project's tooling executes when it runs the tests
    'package.json',
    'packages/a/package.json',
    '.yarnrc.yml',
    '.pnpmfile.cjs',
    '.envrc',
    'Makefile',
    '.cargo/config.toml',
    'lefthook.yml',
    'apps/web/.github/workflows/ci.yml',
    'sub/.gitattributes',
    'sub/.husky/pre-commit',
    'Vitest.Config.ts',
    'PACKAGE.JSON',
    'vite.config.ts',
    'conftest.py',
    '.claude/settings.json',
    '.claude/commands/x.md',
    '.mcp.json',
    '.vscode/tasks.json',
    '.devcontainer/devcontainer.json',
    '.cursor/rules/x.mdc',
    '.travis.yml',
    'azure-pipelines.yml',
    '.buildkite/pipeline.yml',
    'pyproject.toml',
    'vitest.config.ts',
    'apps/x/jest.config.js',
    'docs/forge/specs/stories/STORY-001.md',
    'docs/forge/kb/decisions/ADR-0001.md',
    'docs/forge/sessions/rca/RCA-001.md',
    'docs/forge/reports/defects/DEF-001.md',
  ];
  it.each(protectedPaths)('%s is protected', (file) => {
    const found = scan([file]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ rule: 'protected-path', path: file });
  });

  it('a path that leaves the project is refused, whatever it is called', () => {
    expect(scan(['../outside.ts', '/etc/passwd', 'a/../../b'])).toHaveLength(3);
  });

  it('the document roots are the project’s configured ones, not a fixed docs/forge', () => {
    expect(scan(['records/kb/x.md'])).toEqual([]);
    const moved = scanFixDiff({
      changes: [change('records/kb/x.md')],
      docRoots: { ...ROOTS, kb: 'records/kb' },
    });
    expect(moved).toHaveLength(1);
    expect(protectedFixGlobs({ ...ROOTS, kb: './records/kb/' })).toContain('records/kb/**');
  });

  // A root that merely STARTS WITH the two characters `..` is not a `..` path-segment escape (the same
  // string-prefix-vs-path-segment bug this session's sibling fixes closed elsewhere, here with the risk
  // direction inverted: under-protection, not an over-strict refusal). `..cache` is a real, literal
  // sibling-looking name one level under the project root, never a parent-directory climb.
  it('a configured root that merely starts with ".." (not a real ".." escape) is still protected', () => {
    const odd: DocRoots = { ...ROOTS, kb: '..cache' };
    expect(protectedFixGlobs(odd)).toContain('..cache/**');
    const found = scanFixDiff({
      changes: [change('..cache/decisions/ADR-0001.md')],
      docRoots: odd,
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      rule: 'protected-path',
      path: '..cache/decisions/ADR-0001.md',
    });
  });

  it('a configured root nested under a literal ".."-prefixed directory is also protected', () => {
    const odd: DocRoots = { ...ROOTS, specs: '..cache/specs' };
    const found = scanFixDiff({
      changes: [change('..cache/specs/stories/STORY-002.md')],
      docRoots: odd,
    });
    expect(found).toHaveLength(1);
  });

  // A root that IS a genuine escape (a real ".." path segment) must stay excluded from the protected set:
  // the fix above must not flip the bug into its own opposite failure mode (wrongly including an escape).
  it('a configured root that really is a ".." escape contributes no glob, and is not itself writable', () => {
    for (const escaping of ['..', '../elsewhere', '../../elsewhere']) {
      const odd: DocRoots = { ...ROOTS, reports: escaping };
      const globs = protectedFixGlobs(odd);
      expect(globs.some((glob) => glob === escaping || glob.startsWith(`${escaping}/`))).toBe(
        false,
      );
    }
  });
});

describe('scanFixDiff: content, modes and ignored files', () => {
  it('a symlink is refused, and a submodule', () => {
    const found = scanFixDiff({
      changes: [
        change('src/link', { mode: '120000', added: '/etc/passwd' }),
        change('vendor/sub', { mode: '160000', submodule: true }),
      ],
      docRoots: ROOTS,
    });
    expect(found.map((violation) => violation.rule).sort()).toEqual(['submodule', 'symlink']);
  });

  it('a secret-shaped value in the ADDED text is refused, whatever the file, and never quoted back', () => {
    const found = scanFixDiff({
      changes: [
        change('src/config.ts', { added: `const id = '${AWS_SHAPED}';` }),
        change('ä.txt', { added: `x\n++ ${AWS_SHAPED}` }),
        change('src/k.ts', { added: '-----BEGIN ' + 'PRIVATE KEY-----' }),
        change('src/c.ts', { added: 'sk-ant-' + 'a'.repeat(30) }),
        change('src/g.ts', { added: 'AIza' + 'b'.repeat(35) }),
      ],
      docRoots: ROOTS,
    });
    expect(found.map((violation) => violation.path)).toEqual([
      'src/config.ts',
      'ä.txt',
      'src/k.ts',
      'src/c.ts',
      'src/g.ts',
    ]);
    expect(found.every((violation) => violation.rule === 'secret')).toBe(true);
    expect(JSON.stringify(found)).not.toContain(AWS_SHAPED);
  });

  it('a deleted file adds nothing (a fix may delete a secret)', () => {
    expect(
      scanFixDiff({
        changes: [change('src/old.ts', { deleted: true, mode: '000000', added: '' })],
        docRoots: ROOTS,
      }),
    ).toEqual([]);
  });

  it('an ignored file is refused: git add -A never lists it, and the tests would still run it', () => {
    const found = scan(['src/a.ts'], ['.env', 'node_modules/x/index.js']);
    expect(found.map((violation) => [violation.rule, violation.path])).toEqual([
      ['ignored-file', '.env'],
      ['ignored-file', 'node_modules/x/index.js'],
    ]);
  });

  it('reports every rule a change set breaks together', () => {
    const rules = scanFixDiff({
      changes: [
        change('.github/workflows/x.yml', { added: `k: ${AWS_SHAPED}` }),
        change('src/l', { mode: '120000' }),
      ],
      ignored: ['.env'],
      docRoots: ROOTS,
    }).map((violation) => violation.rule);
    expect(rules.sort()).toEqual(['ignored-file', 'protected-path', 'secret', 'symlink']);
  });
});
