/**
 * `forge doctor`'s own project checks.
 *
 * @see specs/03 §3.7
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  checkConfigValidity,
  checkKbLint,
  checkManifest,
  checkSpecGraph,
} from '../../../src/commands/doctor/project.ts';
import { KB_ROOT, SPECS_ROOT, cleanupAll, createTestProject } from './helpers.ts';

afterEach(cleanupAll);

describe('checkConfigValidity', () => {
  it('passes for a real, schema-valid .forge/config.yaml', async () => {
    const project = await createTestProject();
    const result = await checkConfigValidity(project.paths);
    expect(result.ok).toBe(true);
    expect(result.severity).toBe('hard');
  });

  it('fails with a real, informative message when the file is missing', async () => {
    const project = await createTestProject();
    await rm(path.join(project.dir, '.forge/config.yaml'));
    const result = await checkConfigValidity(project.paths);
    expect(result.ok).toBe(false);
    expect(result.fix).toBeDefined();
  });

  it('fails for real, invalid YAML', async () => {
    const project = await createTestProject();
    await writeFile(path.join(project.dir, '.forge/config.yaml'), 'not: [valid, yaml');
    const result = await checkConfigValidity(project.paths);
    expect(result.ok).toBe(false);
  });

  it('fails for real, schema-invalid content', async () => {
    const project = await createTestProject();
    await writeFile(path.join(project.dir, '.forge/config.yaml'), 'project:\n  name: 5\n');
    const result = await checkConfigValidity(project.paths);
    expect(result.ok).toBe(false);
  });
});

describe('checkManifest', () => {
  it('passes for a real, well-formed .forge/manifest.yaml', async () => {
    const project = await createTestProject();
    const result = await checkManifest(project.paths);
    expect(result.ok).toBe(true);
    expect(result.message).toContain('1 modules');
  });

  it('fails when the file is missing', async () => {
    const project = await createTestProject();
    await rm(path.join(project.dir, '.forge/manifest.yaml'));
    const result = await checkManifest(project.paths);
    expect(result.ok).toBe(false);
  });

  it('fails for a real manifest missing a required field', async () => {
    const project = await createTestProject();
    await writeFile(
      path.join(project.dir, '.forge/manifest.yaml'),
      'version: 1\nmodules:\n  - id: fm-core\n',
    );
    const result = await checkManifest(project.paths);
    expect(result.ok).toBe(false);
  });
});

describe('checkKbLint', () => {
  it('passes for a real, empty KB tree', async () => {
    const project = await createTestProject();
    const result = await checkKbLint({
      paths: project.paths,
      kbRoot: KB_ROOT,
      specsRoot: SPECS_ROOT,
      level: project.config.project.level,
      env: {},
    });
    expect(result.ok).toBe(true);
  });

  it('reports a real hard failure for a real dangling-reference finding', async () => {
    const project = await createTestProject();
    const relPath = `${KB_ROOT}/architecture/KB-ARCH-0001.md`;
    await mkdir(path.dirname(path.join(project.dir, relPath)), { recursive: true });
    await writeFile(
      path.join(project.dir, relPath),
      `---
id: KB-ARCH-0001
type: knowledge
section: architecture
title: Fixture knowledge entry
status: active
confidence: verified
owner: architect
sources: []
created: 2026-01-01
updated: 2026-01-01
review_by: 2026-06-01
supersedes: []
superseded_by: null
related: [KB-ARCH-9999]
diagrams: []
tags: []
applies_to: []
---

## Verification

Confirmed directly against the real system.
`,
    );
    const result = await checkKbLint({
      paths: project.paths,
      kbRoot: KB_ROOT,
      specsRoot: SPECS_ROOT,
      level: project.config.project.level,
      env: {},
    });
    expect(result.ok).toBe(false);
    expect(result.severity).toBe('hard');
    expect(result.message).toMatch(/error/);
  });
});

describe('checkSpecGraph', () => {
  it('passes for a real, empty spec tree', async () => {
    const project = await createTestProject();
    const result = await checkSpecGraph({
      paths: project.paths,
      specsRoot: SPECS_ROOT,
      kbRoot: KB_ROOT,
    });
    expect(result.ok).toBe(true);
  });

  it('reports a real hard failure for a real, schema-invalid spec document', async () => {
    const project = await createTestProject();
    const relPath = `${SPECS_ROOT}/vision.md`;
    await mkdir(path.dirname(path.join(project.dir, relPath)), { recursive: true });
    await writeFile(path.join(project.dir, relPath), '---\nid: VIS-001\ntype: Vision\n---\nbody\n');
    const result = await checkSpecGraph({
      paths: project.paths,
      specsRoot: SPECS_ROOT,
      kbRoot: KB_ROOT,
    });
    expect(result.ok).toBe(false);
    expect(result.severity).toBe('hard');
    expect(result.message).toContain('invalid document');
  });
});
