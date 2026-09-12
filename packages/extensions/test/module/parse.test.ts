/**
 * `parseModule` — reads and validates one `module.yaml` file.
 *
 * @see specs/19 §19.1
 * @see PLAN-M10.md P2
 */
import { ProjectPaths, isForgeError, type AbsolutePath } from '@forge/core';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { parseModule } from '../../src/module/parse.ts';

let tmpRoot: string | undefined;

afterEach(() => {
  if (tmpRoot !== undefined) rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = undefined;
});

function freshManifestPath(): AbsolutePath {
  const root = mkdtempSync(path.join(tmpdir(), 'forge-module-parse-'));
  tmpRoot = root;
  const paths = new ProjectPaths(root);
  const dir = paths.resolveWithin('modules/fm-fixture');
  mkdirSync(dir, { recursive: true });
  return path.join(dir, 'module.yaml') as AbsolutePath;
}

async function expectForgeError(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
    expect.unreachable('parseModule should have thrown');
  } catch (error) {
    expect(isForgeError(error)).toBe(true);
    if (isForgeError(error)) expect(error.code).toBe(code);
  }
}

const VALID_YAML = `
id: fm-fixture
name: Fixture module
version: 1.0.0
forgeVersion: ">=1.0 <2"
requires: []
conflicts: []
levels: [L1, L2]
ceilings:
  backend: { write: true, exec: ["git *"], network: none, deploy: false }
provides:
  agents: [backend]
  workflows: []
  frameworks: []
  checks: []
  artifactTypes: []
`;

describe('parseModule', () => {
  it('parses a real, valid module.yaml into a typed ModuleDefinition', async () => {
    const manifestPath = freshManifestPath();
    writeFileSync(manifestPath, VALID_YAML);

    const definition = await parseModule(manifestPath);
    expect(definition.id).toBe('fm-fixture');
    expect(definition.version).toBe('1.0.0');
    expect(definition.provides.agents).toEqual(['backend']);
    expect(definition.ceilings['backend']).toEqual({
      write: true,
      exec: ['git *'],
      network: 'none',
      deploy: false,
    });
  });

  it('throws CFG-021 for syntactically invalid YAML', async () => {
    const manifestPath = freshManifestPath();
    writeFileSync(manifestPath, 'id: [unterminated');
    await expectForgeError(parseModule(manifestPath), 'CFG-021');
  });

  it('throws CFG-021 for YAML that does not match moduleSchema', async () => {
    const manifestPath = freshManifestPath();
    writeFileSync(manifestPath, 'id: fm-fixture\nname: Fixture\n');
    await expectForgeError(parseModule(manifestPath), 'CFG-021');
  });

  it('throws CFG-021 naming "(root)" for a document that fails validation at the top level', async () => {
    const manifestPath = freshManifestPath();
    writeFileSync(manifestPath, '"just a plain string, not an object at all"');
    try {
      await parseModule(manifestPath);
      expect.unreachable('parseModule should have thrown');
    } catch (error) {
      expect(isForgeError(error)).toBe(true);
      if (isForgeError(error)) {
        expect(error.code).toBe('CFG-021');
        expect(error.message).toMatch(/\(root\)/);
      }
    }
  });

  it('throws RUN-034 when the file does not exist', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'forge-module-parse-missing-'));
    tmpRoot = root;
    const missing = path.join(root, 'nope', 'module.yaml') as AbsolutePath;
    await expectForgeError(parseModule(missing), 'RUN-034');
  });
});
