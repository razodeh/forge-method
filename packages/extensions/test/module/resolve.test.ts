/**
 * `resolveInstalledModules` — `19` §19.1's own `requires`/`conflicts`/`forgeVersion`/`provides`
 * cross-module checks.
 *
 * @see specs/19 §19.1
 * @see PLAN-M10.md P2
 */
import { ProjectPaths, isForgeError, type AbsolutePath } from '@forge/core';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { compareProvideConflicts, resolveInstalledModules } from '../../src/module/resolve.ts';
import type { ProvideConflict } from '../../src/module/types.ts';

let tmpRoot: string | undefined;

afterEach(() => {
  if (tmpRoot !== undefined) rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = undefined;
});

function freshModulesDir(): {
  modulesDir: AbsolutePath;
  write: (id: string, yaml: string) => void;
} {
  const root = mkdtempSync(path.join(tmpdir(), 'forge-module-resolve-'));
  tmpRoot = root;
  const paths = new ProjectPaths(root);
  const modulesDir = paths.resolveWithin('modules');
  mkdirSync(modulesDir, { recursive: true });
  return {
    modulesDir,
    write: (id, yaml) => {
      const dir = path.join(modulesDir, id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'module.yaml'), yaml);
    },
  };
}

function moduleYaml(overrides: {
  id: string;
  requires?: readonly string[];
  conflicts?: readonly string[];
  forgeVersion?: string;
  agents?: readonly string[];
  workflows?: readonly string[];
}): string {
  const requires = overrides.requires ?? [];
  const conflicts = overrides.conflicts ?? [];
  const forgeVersion = overrides.forgeVersion ?? '>=1.0 <2';
  const agents = overrides.agents ?? [];
  const workflows = overrides.workflows ?? [];
  return `
id: ${overrides.id}
name: ${overrides.id}
version: 1.0.0
forgeVersion: "${forgeVersion}"
requires: [${requires.join(', ')}]
conflicts: [${conflicts.join(', ')}]
levels: [L1, L2, L3, L4]
ceilings: {}
provides:
  agents: [${agents.join(', ')}]
  workflows: [${workflows.join(', ')}]
  frameworks: []
  checks: []
  artifactTypes: []
`;
}

async function expectForgeError(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
    expect.unreachable('resolveInstalledModules should have thrown');
  } catch (error) {
    expect(isForgeError(error)).toBe(true);
    if (isForgeError(error)) expect(error.code).toBe(code);
  }
}

const FORGE_VERSION = '1.4.0';

describe('resolveInstalledModules — module id containment (CFG-025)', () => {
  it('rejects a path-traversal-shaped installOrder entry rather than reading a manifest outside modulesDir', async () => {
    const { modulesDir, write } = freshModulesDir();
    write('fm-core', moduleYaml({ id: 'fm-core' }));

    // Plant a real, valid module.yaml entirely outside modulesDir, and try to reach it with a
    // traversal-shaped id — the exact hole a critic round found: `path.join` alone happily resolves
    // this outside the intended tree.
    const outsideDir = mkdtempSync(path.join(tmpdir(), 'forge-module-outside-'));
    try {
      writeFileSync(path.join(outsideDir, 'module.yaml'), moduleYaml({ id: 'evil' }));
      const traversal = `../${path.basename(outsideDir)}`;

      await expectForgeError(
        resolveInstalledModules(['fm-core', traversal], modulesDir, {
          forgeVersion: FORGE_VERSION,
        }),
        'CFG-025',
      );
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('rejects an absolute-path-shaped installOrder entry', async () => {
    const { modulesDir } = freshModulesDir();
    await expectForgeError(
      resolveInstalledModules(['/etc/passwd'], modulesDir, { forgeVersion: FORGE_VERSION }),
      'CFG-025',
    );
  });

  it('rejects an installOrder entry containing a path separator', async () => {
    const { modulesDir } = freshModulesDir();
    await expectForgeError(
      resolveInstalledModules(['fm-core/../fm-core'], modulesDir, { forgeVersion: FORGE_VERSION }),
      'CFG-025',
    );
  });

  it('names the offending id in the CFG-025 message', async () => {
    const { modulesDir } = freshModulesDir();
    try {
      await resolveInstalledModules(['../nope'], modulesDir, { forgeVersion: FORGE_VERSION });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(isForgeError(error)).toBe(true);
      if (isForgeError(error)) expect(error.message).toMatch(/\.\.\/nope/);
    }
  });

  it('rejects a symlink whose own name is a legal module id but whose target escapes modulesDir — CFG-025 alone cannot catch this, since the string itself is innocent', async () => {
    // A second critic round found this exact gap: `MODULE_ID_PATTERN` only checks the *id string*,
    // never whether `modulesDir/<id>` is itself a symlink pointing somewhere else entirely. Real
    // containment needs a real filesystem check, not just a string check — this is why
    // `resolveInstalledModules` resolves the manifest path through `ProjectPaths.resolveWithin`
    // (`CFG-003`) rather than a raw `path.join`.
    const { modulesDir } = freshModulesDir();
    const outsideDir = mkdtempSync(path.join(tmpdir(), 'forge-module-symlink-outside-'));
    try {
      writeFileSync(path.join(outsideDir, 'module.yaml'), moduleYaml({ id: 'evil' }));
      symlinkSync(outsideDir, path.join(modulesDir, 'evil-module'), 'dir');

      await expectForgeError(
        resolveInstalledModules(['evil-module'], modulesDir, { forgeVersion: FORGE_VERSION }),
        'CFG-003',
      );
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});

describe('resolveInstalledModules — requires', () => {
  it('resolves cleanly when every requires target is installed', async () => {
    const { modulesDir, write } = freshModulesDir();
    write('fm-core', moduleYaml({ id: 'fm-core' }));
    write('fm-service', moduleYaml({ id: 'fm-service', requires: ['fm-core'] }));

    const result = await resolveInstalledModules(['fm-core', 'fm-service'], modulesDir, {
      forgeVersion: FORGE_VERSION,
    });
    expect([...result.modules.keys()]).toEqual(['fm-core', 'fm-service']);
  });

  it('fails compile with CFG-022, naming the module and the missing requirement, when requires is absent', async () => {
    const { modulesDir, write } = freshModulesDir();
    write('fm-service', moduleYaml({ id: 'fm-service', requires: ['fm-core'] }));

    try {
      await resolveInstalledModules(['fm-service'], modulesDir, { forgeVersion: FORGE_VERSION });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(isForgeError(error)).toBe(true);
      if (isForgeError(error)) {
        expect(error.code).toBe('CFG-022');
        expect(error.message).toMatch(/fm-service/);
        expect(error.message).toMatch(/fm-core/);
      }
    }
  });
});

describe('resolveInstalledModules — conflicts', () => {
  it('fails compile with CFG-023 when a conflicting module is also installed', async () => {
    const { modulesDir, write } = freshModulesDir();
    write('fm-core', moduleYaml({ id: 'fm-core' }));
    write('fm-alt', moduleYaml({ id: 'fm-alt', conflicts: ['fm-core'] }));

    try {
      await resolveInstalledModules(['fm-core', 'fm-alt'], modulesDir, {
        forgeVersion: FORGE_VERSION,
      });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(isForgeError(error)).toBe(true);
      if (isForgeError(error)) {
        expect(error.code).toBe('CFG-023');
        expect(error.message).toMatch(/fm-alt/);
        expect(error.message).toMatch(/fm-core/);
      }
    }
  });

  it('does not fail when a conflicting module is simply not installed', async () => {
    const { modulesDir, write } = freshModulesDir();
    write('fm-alt', moduleYaml({ id: 'fm-alt', conflicts: ['fm-core'] }));

    const result = await resolveInstalledModules(['fm-alt'], modulesDir, {
      forgeVersion: FORGE_VERSION,
    });
    expect([...result.modules.keys()]).toEqual(['fm-alt']);
  });
});

describe('resolveInstalledModules — forgeVersion', () => {
  it('fails compile with CFG-024 when the running forge version is outside the module range', async () => {
    const { modulesDir, write } = freshModulesDir();
    write('fm-core', moduleYaml({ id: 'fm-core', forgeVersion: '>=2.0 <3' }));

    await expectForgeError(
      resolveInstalledModules(['fm-core'], modulesDir, { forgeVersion: FORGE_VERSION }),
      'CFG-024',
    );
  });

  it('resolves cleanly when the running forge version satisfies the module range', async () => {
    const { modulesDir, write } = freshModulesDir();
    write('fm-core', moduleYaml({ id: 'fm-core', forgeVersion: '>=1.0 <2' }));

    const result = await resolveInstalledModules(['fm-core'], modulesDir, {
      forgeVersion: FORGE_VERSION,
    });
    expect(result.modules.has('fm-core')).toBe(true);
  });
});

describe('resolveInstalledModules — provides conflicts (install-order resolution)', () => {
  it('two modules providing the same agent id resolve deterministically by install order, naming both contributors', async () => {
    const { modulesDir, write } = freshModulesDir();
    write('fm-a', moduleYaml({ id: 'fm-a', agents: ['backend'] }));
    write('fm-b', moduleYaml({ id: 'fm-b', agents: ['backend'] }));

    const result = await resolveInstalledModules(['fm-a', 'fm-b'], modulesDir, {
      forgeVersion: FORGE_VERSION,
    });

    expect(result.provideConflicts).toEqual([
      {
        kind: 'agents',
        id: 'backend',
        winner: 'fm-b',
        contributors: ['fm-a', 'fm-b'],
      },
    ]);
  });

  it('install order is what decides the winner, not alphabetical or declaration order', async () => {
    const { modulesDir, write } = freshModulesDir();
    write('fm-z', moduleYaml({ id: 'fm-z', agents: ['backend'] }));
    write('fm-a', moduleYaml({ id: 'fm-a', agents: ['backend'] }));

    // fm-z installed AFTER fm-a, despite sorting earlier alphabetically.
    const result = await resolveInstalledModules(['fm-a', 'fm-z'], modulesDir, {
      forgeVersion: FORGE_VERSION,
    });

    expect(result.provideConflicts[0]?.winner).toBe('fm-z');
  });

  it('reports multiple provide conflicts sorted deterministically by kind then id', async () => {
    const { modulesDir, write } = freshModulesDir();
    write(
      'fm-a',
      moduleYaml({ id: 'fm-a', agents: ['zebra', 'apple'], workflows: ['shared-flow'] }),
    );
    write(
      'fm-b',
      moduleYaml({ id: 'fm-b', agents: ['zebra', 'apple'], workflows: ['shared-flow'] }),
    );

    const result = await resolveInstalledModules(['fm-a', 'fm-b'], modulesDir, {
      forgeVersion: FORGE_VERSION,
    });

    // Sorted by kind first ("agents" < "workflows"), then by id within a kind ("apple" < "zebra") —
    // never insertion order, which would put "zebra" before "apple".
    expect(result.provideConflicts).toEqual([
      { kind: 'agents', id: 'apple', winner: 'fm-b', contributors: ['fm-a', 'fm-b'] },
      { kind: 'agents', id: 'zebra', winner: 'fm-b', contributors: ['fm-a', 'fm-b'] },
      { kind: 'workflows', id: 'shared-flow', winner: 'fm-b', contributors: ['fm-a', 'fm-b'] },
    ]);
  });

  it('reports no provide conflicts when every id is provided by exactly one module', async () => {
    const { modulesDir, write } = freshModulesDir();
    write('fm-a', moduleYaml({ id: 'fm-a', agents: ['backend'] }));
    write('fm-b', moduleYaml({ id: 'fm-b', agents: ['frontend'] }));

    const result = await resolveInstalledModules(['fm-a', 'fm-b'], modulesDir, {
      forgeVersion: FORGE_VERSION,
    });
    expect(result.provideConflicts).toEqual([]);
  });
});

describe('compareProvideConflicts', () => {
  function conflict(kind: ProvideConflict['kind'], id: string): ProvideConflict {
    return { kind, id, winner: 'x', contributors: ['x', 'y'] };
  }

  it('orders by kind first, in both directions', () => {
    expect(compareProvideConflicts(conflict('agents', 'z'), conflict('workflows', 'a'))).toBe(-1);
    expect(compareProvideConflicts(conflict('workflows', 'a'), conflict('agents', 'z'))).toBe(1);
  });

  it('orders by id within the same kind, in both directions', () => {
    expect(compareProvideConflicts(conflict('agents', 'apple'), conflict('agents', 'zebra'))).toBe(
      -1,
    );
    expect(compareProvideConflicts(conflict('agents', 'zebra'), conflict('agents', 'apple'))).toBe(
      1,
    );
  });

  it('is 0 for the same kind and id', () => {
    expect(
      compareProvideConflicts(conflict('agents', 'backend'), conflict('agents', 'backend')),
    ).toBe(0);
  });
});

describe('resolveInstalledModules — parse failures propagate before cross-module checks run', () => {
  it('throws CFG-021 for a malformed installed module', async () => {
    const { modulesDir, write } = freshModulesDir();
    write('fm-broken', 'id: fm-broken\nname: broken\n'); // missing required fields

    await expectForgeError(
      resolveInstalledModules(['fm-broken'], modulesDir, { forgeVersion: FORGE_VERSION }),
      'CFG-021',
    );
  });

  it('reports CFG-021 for a malformed module rather than CFG-022 for a different, requires-failing module later in installOrder — proving parsing really does finish before requires/conflicts/forgeVersion are checked at all', async () => {
    const { modulesDir, write } = freshModulesDir();
    // fm-service is schema-valid but requires an absent module — on its own this would be CFG-022.
    write('fm-service', moduleYaml({ id: 'fm-service', requires: ['fm-core'] }));
    // fm-broken is not schema-valid at all.
    write('fm-broken', 'id: fm-broken\nname: broken\n');

    await expectForgeError(
      resolveInstalledModules(['fm-service', 'fm-broken'], modulesDir, {
        forgeVersion: FORGE_VERSION,
      }),
      'CFG-021',
    );
  });
});
