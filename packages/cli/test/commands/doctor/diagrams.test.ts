/**
 * `forge doctor`'s own diagram checks.
 *
 * @see specs/03 §3.7
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { checkDiagrams } from '../../../src/commands/doctor/diagrams.ts';
import { KB_ROOT, cleanupAll, createTestProject } from './helpers.ts';

afterEach(cleanupAll);

function diagramFixture(): string {
  return `id: DIAG-001
type: Diagram
schemaVersion: 1
title: Fixture diagram
status: active
created: 2026-01-01
updated: 2026-01-01
revision: 1
author: architect
changelog: []
kind: flowchart
notation: mermaid
source: |
  flowchart TD
    Client[Client] --> Server[Server]
generated: false
depicts: []
explains: []
caption: A fixture flowchart.
alt_text: A fixture flowchart from A to B.
owner: architect
`;
}

describe('checkDiagrams', () => {
  it('passes for a real, empty KB tree with no diagrams at all', async () => {
    const project = await createTestProject();
    const result = await checkDiagrams(project.paths, KB_ROOT);
    expect(result.ok).toBe(true);
    expect(result.message).toContain('0 real diagram');
  });

  it('passes for a real, valid, within-budget diagram', async () => {
    const project = await createTestProject();
    await mkdir(path.join(project.dir, KB_ROOT, 'architecture/views'), { recursive: true });
    await writeFile(
      path.join(project.dir, KB_ROOT, 'architecture/views/fixture.mmd.yaml'),
      diagramFixture(),
    );
    const result = await checkDiagrams(project.paths, KB_ROOT);
    expect(result.ok).toBe(true);
    expect(result.message).toContain('1 real diagram');
  });

  it('reports a real hard failure for a real error-severity finding (trivial caption)', async () => {
    const project = await createTestProject();
    await mkdir(path.join(project.dir, KB_ROOT, 'architecture/views'), { recursive: true });
    await writeFile(
      path.join(project.dir, KB_ROOT, 'architecture/views/fixture.mmd.yaml'),
      diagramFixture().replace('caption: A fixture flowchart.', 'caption: Client'),
    );
    const result = await checkDiagrams(project.paths, KB_ROOT);
    expect(result.ok).toBe(false);
    expect(result.severity).toBe('hard');
    expect(result.message).toContain('error');
    expect(result.fix).toBeDefined();
  });

  it('reports a real, non-hard warning for a real warn-severity-only finding (orphan node)', async () => {
    const project = await createTestProject();
    await mkdir(path.join(project.dir, KB_ROOT, 'architecture/views'), { recursive: true });
    await writeFile(
      path.join(project.dir, KB_ROOT, 'architecture/views/fixture.mmd.yaml'),
      diagramFixture().replace(
        'source: |\n  flowchart TD\n    Client[Client] --> Server[Server]\n',
        'source: |\n  flowchart TD\n    Client[Client] --> Server[Server]\n    Lonely[Lonely]\n',
      ),
    );
    const result = await checkDiagrams(project.paths, KB_ROOT);
    expect(result.ok).toBe(false);
    expect(result.severity).toBe('warning');
    expect(result.message).toContain('warning');
  });
});
