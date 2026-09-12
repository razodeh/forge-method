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
import { listTechniques, loadTechnique } from '../../src/technique/load.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const realModulesDir = new ProjectPaths(repoRoot).resolveWithin('modules');

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

  it('rejects an unknown technique id with RUN-065', async () => {
    await expect(loadTechnique(realModulesDir, 'not-a-real-technique')).rejects.toMatchObject({
      code: 'RUN-065',
    });
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

  const MINIMAL_TECHNIQUE = (id: string, phases: string): string =>
    `id: ${id}\nname: ${id}\nbestFor: testing\nphases: [${phases}]\nprompt: do the thing\n`;

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
