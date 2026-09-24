/**
 * `loadTechnique`/`listTechniques` — `16` §16.4's technique library, against the real, shipped
 * `modules/fm-core/techniques/` directory and a fresh fixture tree.
 *
 * @see specs/16 §16.4
 * @see PLAN-M10.md P9
 */
import { ProjectPaths, type AbsolutePath } from '@forge/core';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { techniqueSchema } from '../../src/technique/schema.ts';
import {
  listTechniques,
  loadTechnique,
  listTechniquesInDir,
  loadTechniqueFromDir,
} from '../../src/technique/load.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const realModulesDir = new ProjectPaths(repoRoot).resolveWithin('modules');

const MINIMAL_TECHNIQUE = (id: string, phases: string): string =>
  `id: ${id}\nname: ${id}\nbestFor: testing\nphases: [${phases}]\nprompt: do the thing\n`;

// `16` §16.4's own three tables (12 divergent + 8 convergent) plus its own retro prose row (6 named
// techniques, one of which -- five-whys -- is shared with the divergent table): 20 + 5 new = 25 real
// files. See `schema.ts`'s own doc comment.
const ALL_TECHNIQUE_IDS = [
  'scamper',
  'first-principles',
  'inversion',
  'analogy',
  'constraint-removal',
  'constraint-addition',
  'jobs-to-be-done',
  'user-journey-walk',
  'failure-storming',
  'what-would-X-do',
  'five-whys',
  'assumption-audit',
  'dot-voting',
  'impact-effort',
  'rice',
  'moscow',
  'weighted-rubric',
  'steel-man-debate',
  'reversibility-sort',
  'cost-of-delay',
  'what-went-well-badly-next',
  'start-stop-continue',
  'timeline-review',
  'sailboat',
  'data-driven',
] as const;

describe('the real, shipped modules/fm-core/techniques/ library', () => {
  it('loads all 25 real technique files, each validating against techniqueSchema', async () => {
    const techniques = await listTechniques(realModulesDir);
    expect(techniques).toHaveLength(25);
    for (const technique of techniques) {
      expect(techniqueSchema.safeParse(technique).success).toBe(true);
    }
  });

  it('every real technique id from `16` §16.4 is present exactly once', async () => {
    const techniques = await listTechniques(realModulesDir);
    expect(techniques.map((technique) => technique.id).sort()).toEqual(
      [...ALL_TECHNIQUE_IDS].sort(),
    );
  });

  it.each(ALL_TECHNIQUE_IDS)('loadTechnique resolves %s by id', async (id) => {
    const technique = await loadTechnique(realModulesDir, id);
    expect(technique.id).toBe(id);
  });

  it('listTechniques(diverge) returns exactly the 12 divergent techniques, five-whys included', async () => {
    const diverge = await listTechniques(realModulesDir, 'diverge');
    expect(diverge).toHaveLength(12);
    expect(diverge.map((t) => t.id)).toContain('five-whys');
  });

  it('listTechniques(converge) returns exactly the 8 convergent techniques', async () => {
    const converge = await listTechniques(realModulesDir, 'converge');
    expect(converge).toHaveLength(8);
  });

  it('listTechniques(retro) returns exactly the 6 named retro techniques, five-whys included', async () => {
    const retro = await listTechniques(realModulesDir, 'retro');
    expect(retro).toHaveLength(6);
    expect(retro.map((t) => t.id)).toContain('five-whys');
  });

  it('rejects an unknown technique id with RUN-065, naming modules/*/techniques/ -- the tree this call actually searched, never .forge/techniques (round-1 critic finding)', async () => {
    const error: unknown = await loadTechnique(realModulesDir, 'not-a-real-technique').catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({ code: 'RUN-065' });
    expect((error as Error).message).toContain("any module's techniques/ directory");
    expect((error as Error).message).not.toContain('.forge/techniques');
  });
});

describe('loadTechnique/listTechniques against a fresh fixture tree', () => {
  let tmpRoot: string | undefined;

  afterEach(() => {
    if (tmpRoot !== undefined) rmSync(tmpRoot, { recursive: true, force: true });
    tmpRoot = undefined;
  });

  function freshModulesDir(): {
    modulesDir: AbsolutePath;
    write: (moduleId: string, techniqueId: string, yaml: string) => void;
  } {
    const root = mkdtempSync(path.join(tmpdir(), 'forge-sessions-techniques-'));
    tmpRoot = root;
    const paths = new ProjectPaths(root);
    const modulesDir = paths.resolveWithin('modules');
    mkdirSync(modulesDir, { recursive: true });
    return {
      modulesDir,
      write: (moduleId, techniqueId, yaml) => {
        const techniquesDir = path.join(modulesDir, moduleId, 'techniques');
        mkdirSync(techniquesDir, { recursive: true });
        writeFileSync(path.join(techniquesDir, `${techniqueId}.technique.yaml`), yaml);
      },
    };
  }

  it('reads techniques from more than one module, combined into one list', async () => {
    const { modulesDir, write } = freshModulesDir();
    write('fm-core', 'a', MINIMAL_TECHNIQUE('a', 'diverge'));
    write('fm-web', 'b', MINIMAL_TECHNIQUE('b', 'converge'));
    const techniques = await listTechniques(modulesDir);
    expect(techniques.map((t) => t.id).sort()).toEqual(['a', 'b']);
  });

  it('skips a module directory with no techniques/ subdirectory at all, rather than throwing', async () => {
    const { modulesDir, write } = freshModulesDir();
    write('fm-core', 'a', MINIMAL_TECHNIQUE('a', 'diverge'));
    mkdirSync(path.join(modulesDir, 'fm-empty'), { recursive: true });
    const techniques = await listTechniques(modulesDir);
    expect(techniques.map((t) => t.id)).toEqual(['a']);
  });

  it('skips a stray non-directory file directly under modulesDir', async () => {
    const { modulesDir, write } = freshModulesDir();
    write('fm-core', 'a', MINIMAL_TECHNIQUE('a', 'diverge'));
    writeFileSync(path.join(modulesDir, 'README.md'), 'not a module');
    const techniques = await listTechniques(modulesDir);
    expect(techniques.map((t) => t.id)).toEqual(['a']);
  });

  it('reports a root-level schema issue (not a valid object at all) with the "(root)" path', async () => {
    const { modulesDir, write } = freshModulesDir();
    write('fm-core', 'not-an-object', 'just a string, not a mapping\n');
    await expect(listTechniques(modulesDir)).rejects.toThrow(/\(root\)/);
  });

  it('throws a plain Error on a malformed technique document -- shipped-content authoring bug, not ordinary runtime input', async () => {
    const { modulesDir, write } = freshModulesDir();
    write('fm-core', 'broken', 'id: broken\n');
    await expect(listTechniques(modulesDir)).rejects.toThrow(/broken/);
  });

  it('throws a plain Error on two modules declaring the same technique id', async () => {
    const { modulesDir, write } = freshModulesDir();
    write('fm-core', 'dup', MINIMAL_TECHNIQUE('dup', 'diverge'));
    write('fm-web', 'dup', MINIMAL_TECHNIQUE('dup', 'converge'));
    await expect(listTechniques(modulesDir)).rejects.toThrow(/duplicate technique id/);
  });

  it('rejects an unknown id with a ForgeError RUN-065, not a plain Error', async () => {
    const { modulesDir, write } = freshModulesDir();
    write('fm-core', 'a', MINIMAL_TECHNIQUE('a', 'diverge'));
    await expect(loadTechnique(modulesDir, 'nope')).rejects.toMatchObject({ code: 'RUN-065' });
  });
});

describe('loadTechniqueFromDir/listTechniquesInDir -- the flat, one-per-project .forge/techniques/ layout (PLAN-M14.md P29)', () => {
  let tmpRoot: string | undefined;

  afterEach(() => {
    if (tmpRoot !== undefined) rmSync(tmpRoot, { recursive: true, force: true });
    tmpRoot = undefined;
  });

  function freshFlatDir(): {
    dir: AbsolutePath;
    write: (fileName: string, yaml: string) => void;
  } {
    const root = mkdtempSync(path.join(tmpdir(), 'forge-sessions-techniques-flat-'));
    tmpRoot = root;
    const dir = new ProjectPaths(root).resolveWithin('techniques');
    mkdirSync(dir, { recursive: true });
    return {
      dir,
      write: (fileName, yaml) => {
        writeFileSync(path.join(dir, fileName), yaml);
      },
    };
  }

  it('loads every real technique file directly under the directory, no module subdirectory', async () => {
    const { dir, write } = freshFlatDir();
    write('a.technique.yaml', MINIMAL_TECHNIQUE('a', 'diverge'));
    write('b.technique.yaml', MINIMAL_TECHNIQUE('b', 'converge'));
    const techniques = await listTechniquesInDir(dir);
    expect(techniques.map((t) => t.id).sort()).toEqual(['a', 'b']);
  });

  it('listTechniquesInDir(phase) filters like listTechniques', async () => {
    const { dir, write } = freshFlatDir();
    write('a.technique.yaml', MINIMAL_TECHNIQUE('a', 'diverge'));
    write('b.technique.yaml', MINIMAL_TECHNIQUE('b', 'converge'));
    expect((await listTechniquesInDir(dir, 'diverge')).map((t) => t.id)).toEqual(['a']);
    expect((await listTechniquesInDir(dir, 'converge')).map((t) => t.id)).toEqual(['b']);
  });

  it('loadTechniqueFromDir resolves a technique by id', async () => {
    const { dir, write } = freshFlatDir();
    write('steel-man-debate.technique.yaml', MINIMAL_TECHNIQUE('steel-man-debate', 'converge'));
    const technique = await loadTechniqueFromDir(dir, 'steel-man-debate');
    expect(technique?.id).toBe('steel-man-debate');
  });

  it('an absent id returns undefined, not a throw -- the caller degrades to panel, visibly', async () => {
    const { dir, write } = freshFlatDir();
    write('a.technique.yaml', MINIMAL_TECHNIQUE('a', 'diverge'));
    await expect(loadTechniqueFromDir(dir, 'steel-man-debate')).resolves.toBeUndefined();
  });

  it('an absent directory is an empty list / undefined for any id, not a throw', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'forge-sessions-techniques-flat-'));
    tmpRoot = root;
    const dir = new ProjectPaths(root).resolveWithin('no-such-techniques-dir');
    await expect(listTechniquesInDir(dir)).resolves.toEqual([]);
    await expect(loadTechniqueFromDir(dir, 'steel-man-debate')).resolves.toBeUndefined();
  });

  it('a malformed file throws ForgeError RUN-065 naming the real file path', async () => {
    const { dir, write } = freshFlatDir();
    write('broken.technique.yaml', 'id: broken\n');
    const error = await listTechniquesInDir(dir).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'RUN-065' });
    expect((error as { details?: { path?: string } }).details?.path).toContain(
      'broken.technique.yaml',
    );
    await expect(loadTechniqueFromDir(dir, 'broken')).rejects.toMatchObject({ code: 'RUN-065' });
  });

  it('a file whose id disagrees with its file name is refused RUN-065 (it must not lend its content to another id)', async () => {
    const { dir, write } = freshFlatDir();
    write('a.technique.yaml', MINIMAL_TECHNIQUE('impostor', 'diverge'));
    await expect(listTechniquesInDir(dir)).rejects.toMatchObject({ code: 'RUN-065' });
  });
});
