/**
 * `checkBoundaries` — the pure decision logic behind `pnpm boundaries`.
 *
 * `PLAN-M1.md` P2's Checks bullet is specific: "A fixture package declaring `core → engine` fails
 * `pnpm boundaries` with a non-zero exit and names both packages." The fixture trees below are that
 * check, built as real directories rather than in-memory data, because the function under test reads
 * real `package.json` files off disk — the whole point of this half of P2 is to catch a boundary
 * violation the ESLint rules cannot see (a hand-edited manifest, a dependency reached only
 * dynamically), so the test has to exercise the same real I/O.
 *
 * @see specs/02 §2.2
 * @see PLAN-M1.md P2
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { checkBoundaries } from '../../../scripts/lib/check-boundaries.mjs';

const cliScript = fileURLToPath(new URL('../../../scripts/check-boundaries.mjs', import.meta.url));

let fixtureDir: string | undefined;

afterEach(() => {
  if (fixtureDir !== undefined) rmSync(fixtureDir, { recursive: true, force: true });
  fixtureDir = undefined;
});

/** Writes `{ packages/<name>/package.json: manifest }` for each entry and returns the root. */
function fixture(manifests: Readonly<Record<string, unknown>>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'forge-boundaries-'));
  for (const [pkg, manifest] of Object.entries(manifests)) {
    const dir = path.join(root, 'packages', pkg);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest));
  }
  fixtureDir = root;
  return root;
}

describe('checkBoundaries', () => {
  it('reports no violations for a graph-respecting tree', () => {
    const root = fixture({
      schemas: { name: '@forge/schemas', dependencies: {} },
      core: { name: '@forge/core', dependencies: { '@forge/schemas': 'workspace:*' } },
    });
    expect(checkBoundaries(root)).toEqual([]);
  });

  it('flags a fixture package declaring core -> engine, naming both packages', () => {
    // The exact scenario PLAN-M1.md P2 names: core does not declare engine as a dependency, and
    // engine depends on core, so this is also the upward/cyclic case.
    const root = fixture({
      core: {
        name: '@forge/core',
        dependencies: { '@forge/schemas': 'workspace:*', '@forge/engine': 'workspace:*' },
      },
      engine: { name: '@forge/engine', dependencies: {} },
      schemas: { name: '@forge/schemas', dependencies: {} },
    });

    const violations = checkBoundaries(root);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ from: 'core', to: 'engine' });
    expect(violations[0]?.reason).toContain('core');
    expect(violations[0]?.reason).toContain('engine');
  });

  it('flags a sibling-but-undeclared dependency', () => {
    const root = fixture({
      agents: { name: '@forge/agents', dependencies: { '@forge/catalog': 'workspace:*' } },
      catalog: { name: '@forge/catalog', dependencies: {} },
    });
    expect(checkBoundaries(root)).toEqual([
      expect.objectContaining({ from: 'agents', to: 'catalog' }),
    ]);
  });

  it('ignores non-@forge dependencies entirely', () => {
    const root = fixture({
      core: { name: '@forge/core', dependencies: { zod: '^3.0.0', typescript: '^5.0.0' } },
    });
    expect(checkBoundaries(root)).toEqual([]);
  });

  it('ignores devDependencies, since a build-time tool is not a runtime boundary', () => {
    const root = fixture({
      core: {
        name: '@forge/core',
        dependencies: {},
        devDependencies: { '@forge/engine': 'workspace:*' },
      },
    });
    expect(checkBoundaries(root)).toEqual([]);
  });

  it('flags any @forge/* dependency of a package specs/02 §2.2 does not declare at all', () => {
    // Catches the tools/ case from SPEC-QUESTIONS.md Q5: a package folder under packages/ whose
    // name is not in PACKAGE_GRAPH has no permitted edges, so every @forge/* dependency it declares
    // is a violation — including one that happens to share a name with a real tools/* package.
    const root = fixture({
      'not-a-real-package': {
        name: '@forge/not-a-real-package',
        dependencies: { '@forge/core': 'workspace:*' },
      },
    });
    expect(checkBoundaries(root)).toEqual([
      expect.objectContaining({ from: 'not-a-real-package', to: 'core' }),
    ]);
  });

  it('does not flag a package importing itself under its own scoped name', () => {
    const root = fixture({ core: { name: '@forge/core', dependencies: { '@forge/core': '*' } } });
    expect(checkBoundaries(root)).toEqual([]);
  });

  it('returns no violations, not a crash, when packages/ does not exist', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'forge-boundaries-empty-'));
    fixtureDir = root;
    expect(checkBoundaries(root)).toEqual([]);
  });

  it('skips a package.json that is not valid JSON, rather than crashing the whole check', () => {
    const root = fixture({ core: { name: '@forge/core', dependencies: {} } });
    writeFileSync(path.join(root, 'packages', 'core', 'package.json'), '{ not json');
    expect(checkBoundaries(root)).toEqual([]);
  });

  it.each([
    ['null', 'null'],
    ['an array', '[]'],
    ['a bare string', '"just a string"'],
    ['a number', '42'],
  ])(
    'skips a package.json that parses to %s, rather than crashing on manifest.dependencies',
    (_name, content) => {
      // Each of these is valid JSON — JSON.parse succeeds — but is not a manifest object. Reading
      // .dependencies off any of them threw a raw, uncaught TypeError that aborted the whole run
      // before later, real violations in the (sorted) directory listing were ever reported.
      const root = fixture({ core: { name: '@forge/core', dependencies: {} } });
      writeFileSync(path.join(root, 'packages', 'core', 'package.json'), content);
      expect(checkBoundaries(root)).toEqual([]);
    },
  );

  it('does not crash and reports nothing when dependencies itself is not an object', () => {
    const root = fixture({ core: { name: '@forge/core', dependencies: 'not-an-object' } });
    expect(checkBoundaries(root)).toEqual([]);
  });

  it('still reports a real violation in a later package after an earlier one has a bad manifest', () => {
    // The crash this guards against would have silently swallowed this violation: earlier versions
    // threw while reading the first (alphabetically) package's manifest and never reached "engine".
    const root = fixture({
      broken: { name: '@forge/broken' },
      engine: {
        name: '@forge/engine',
        dependencies: { '@forge/kb': 'workspace:*', '@forge/tui': 'workspace:*' },
      },
      kb: { name: '@forge/kb', dependencies: {} },
    });
    writeFileSync(path.join(root, 'packages', 'broken', 'package.json'), 'null');

    expect(checkBoundaries(root)).toEqual([expect.objectContaining({ from: 'engine', to: 'tui' })]);
  });

  it('checks the real repository and finds nothing to report', () => {
    // Integration sanity check: run the function against this actual repo, not only fixtures.
    const repoRoot = path.resolve(import.meta.dirname, '../../..');
    expect(checkBoundaries(repoRoot)).toEqual([]);
  });
});

describe('the pnpm boundaries command wrapper', () => {
  // `scripts/check-boundaries.mjs` itself is excluded from coverage (vitest.config.ts) — it is file
  // IO and a process exit code, nothing else — and driven here as a real subprocess instead, the
  // same split and the same reasoning `scripts/ratchet.test.ts` uses for the coverage ratchet's CLI.
  const run = (args: readonly string[]): { status: number; stdout: string; stderr: string } => {
    try {
      const stdout = execFileSync(process.execPath, [cliScript, ...args], { encoding: 'utf8' });
      return { status: 0, stdout, stderr: '' };
    } catch (error) {
      const failure = error as { status?: number; stdout?: string; stderr?: string };
      return {
        status: failure.status ?? 1,
        stdout: failure.stdout ?? '',
        stderr: failure.stderr ?? '',
      };
    }
  };

  it('exits 0 with no output for a graph-respecting tree', () => {
    const root = fixture({
      schemas: { name: '@forge/schemas', dependencies: {} },
      core: { name: '@forge/core', dependencies: { '@forge/schemas': 'workspace:*' } },
    });
    const result = run(['--root', root]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('exits non-zero and names both packages for core -> engine, per PLAN-M1.md P2', () => {
    const root = fixture({
      core: {
        name: '@forge/core',
        dependencies: { '@forge/schemas': 'workspace:*', '@forge/engine': 'workspace:*' },
      },
      engine: { name: '@forge/engine', dependencies: {} },
      schemas: { name: '@forge/schemas', dependencies: {} },
    });
    const result = run(['--root', root]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('core');
    expect(result.stderr).toContain('engine');
  });

  it('resolves a symlinked --root the same way the check itself resolves cwd', () => {
    // scripts/check-boundaries.mjs realpath-resolves its default root; --root must match that
    // behaviour or a symlinked checkout would silently check the wrong tree.
    const root = fixture({ core: { name: '@forge/core', dependencies: {} } });
    expect(run(['--root', realpathSync(root)]).status).toBe(0);
  });

  it('exits with a usage error when --root is given no path', () => {
    expect(run(['--root']).status).toBe(2);
  });

  it('checks this real repository and exits 0 with no --root at all', () => {
    // No --root: falls back to the repository the script itself lives in.
    const result = run([]);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });
});
