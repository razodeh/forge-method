/**
 * `findSchemaDrift`/`runEmitSchemas` and the `assert-schema-drift.mjs` command wrapper.
 *
 * `PLAN-M1.md` P9's Checks: emitting is deterministic within and across processes; the emitted file
 * set matches the registry (in both directions); mutating a committed file is caught by name; the
 * `specs/22` M1 exit test runs verbatim and passes.
 *
 * @see specs/02 §2.1
 * @see specs/22 M1 exit test
 * @see PLAN-M1.md P9
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, onTestFinished } from 'vitest';

import { findSchemaDrift, runEmitSchemas } from './lib/schema-drift.mjs';

const driftScript = fileURLToPath(new URL('assert-schema-drift.mjs', import.meta.url));

/** A disposable `<root>/packages/schemas/json/` directory, cleaned up after the test. */
function fixtureJsonDir(files: Readonly<Record<string, string>>): {
  root: string;
  jsonDir: string;
} {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'forge-schema-drift-')));
  const jsonDir = path.join(root, 'packages', 'schemas', 'json');
  mkdirSync(jsonDir, { recursive: true });
  for (const [filename, content] of Object.entries(files)) {
    writeFileSync(path.join(jsonDir, filename), content);
  }
  onTestFinished(() => {
    rmSync(root, { recursive: true, force: true });
  });
  return { root, jsonDir };
}

describe('runEmitSchemas', () => {
  it('emits exactly one file per registered artifact type, plus one for config', () => {
    const schemas = runEmitSchemas();
    // 21 registry types (specs/18 §18.7) + configSchema.
    expect(schemas.size).toBe(22);
    expect(schemas.has('config.schema.json')).toBe(true);
  });

  it('is deterministic: two calls in this same process produce byte-identical output', () => {
    const first = runEmitSchemas();
    const second = runEmitSchemas();
    expect([...second.entries()]).toEqual([...first.entries()]);
  });

  it('is deterministic across two separate processes', () => {
    const run = () =>
      execFileSync(
        process.execPath,
        [
          '--experimental-strip-types',
          '-e',
          `
          import('./scripts/lib/schema-drift.mjs').then((m) => {
            process.stdout.write(JSON.stringify([...m.runEmitSchemas().entries()]));
          });
        `,
        ],
        { encoding: 'utf8', cwd: fileURLToPath(new URL('..', import.meta.url)) },
      );
    expect(run()).toBe(run());
  });

  it('every emitted file ends with a trailing newline and no carriage returns', () => {
    for (const [filename, content] of runEmitSchemas()) {
      expect(content.endsWith('\n'), filename).toBe(true);
      expect(content.includes('\r'), filename).toBe(false);
    }
  });
});

describe('findSchemaDrift', () => {
  it('reports no drift when the committed directory matches a fresh emission exactly', () => {
    const fresh = runEmitSchemas();
    const { jsonDir } = fixtureJsonDir(Object.fromEntries(fresh));
    expect(findSchemaDrift(jsonDir)).toEqual([]);
  });

  it('names a file whose committed content no longer matches the fresh emission', () => {
    const fresh = runEmitSchemas();
    const files = Object.fromEntries(fresh);
    files['vision.schema.json'] = '{"mutated": true}\n';
    const { jsonDir } = fixtureJsonDir(files);
    const drift = findSchemaDrift(jsonDir);
    expect(drift).toHaveLength(1);
    expect(drift[0]).toContain('vision.schema.json');
  });

  it('names a schema with no committed file at all', () => {
    const fresh = runEmitSchemas();
    const files = Object.fromEntries(fresh);
    delete files['vision.schema.json'];
    const { jsonDir } = fixtureJsonDir(files);
    const drift = findSchemaDrift(jsonDir);
    expect(drift).toHaveLength(1);
    expect(drift[0]).toContain('vision.schema.json');
  });

  it('names a committed file no schema emits anymore', () => {
    const fresh = runEmitSchemas();
    const files = Object.fromEntries(fresh);
    files['retired-type.schema.json'] = '{}\n';
    const { jsonDir } = fixtureJsonDir(files);
    const drift = findSchemaDrift(jsonDir);
    expect(drift).toHaveLength(1);
    expect(drift[0]).toContain('retired-type.schema.json');
  });

  it('ignores a non-schema file in the same directory', () => {
    const fresh = runEmitSchemas();
    const files = Object.fromEntries(fresh);
    files['README.md'] = '# not a schema\n';
    const { jsonDir } = fixtureJsonDir(files);
    expect(findSchemaDrift(jsonDir)).toEqual([]);
  });

  it('reports one entry per drifted file when several drift at once', () => {
    const fresh = runEmitSchemas();
    const files = Object.fromEntries(fresh);
    files['vision.schema.json'] = '{"mutated": true}\n';
    delete files['risk.schema.json'];
    const { jsonDir } = fixtureJsonDir(files);
    expect(findSchemaDrift(jsonDir)).toHaveLength(2);
  });

  it('reports every schema missing when the json directory does not exist at all', () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'forge-schema-drift-')));
    onTestFinished(() => {
      rmSync(root, { recursive: true, force: true });
    });
    const jsonDir = path.join(root, 'packages', 'schemas', 'json');
    const drift = findSchemaDrift(jsonDir);
    expect(drift).toHaveLength(runEmitSchemas().size);
    expect(drift.every((entry) => entry.includes('missing'))).toBe(true);
  });
});

describe('the command wrapper (assert-schema-drift.mjs)', () => {
  const run = (args: readonly string[]) => {
    try {
      return {
        status: 0,
        output: execFileSync(process.execPath, [driftScript, ...args], { encoding: 'utf8' }),
      };
    } catch (error) {
      const failure = error as { status?: number; stderr?: string };
      return { status: failure.status ?? 1, output: failure.stderr ?? '' };
    }
  };

  it("exits 0 against this repository's own real, committed schemas", () => {
    // Proves the committed packages/schemas/json/*.schema.json files actually are what
    // emitJsonSchemas() produces right now — not just that the mechanism works on a fixture.
    expect(run([]).status).toBe(0);
  });

  it('exits non-zero and names the file against a fixture with a mutated schema', () => {
    const fresh = runEmitSchemas();
    const files = Object.fromEntries(fresh);
    files['story.schema.json'] = '{"mutated": true}\n';
    const { root } = fixtureJsonDir(files);
    const { status, output } = run(['--root', root]);
    expect(status).not.toBe(0);
    expect(output).toContain('story.schema.json');
  });

  it('requires --root to take a path argument', () => {
    expect(run(['--root']).status).not.toBe(0);
  });
});
