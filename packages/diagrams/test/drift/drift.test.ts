/**
 * `checkDrift` — `08` §8.11.6, exercised against the real `fixtures/diagram-drift` fixture.
 *
 * @see specs/22 M3 (fixtures/diagram-drift)
 * @see PLAN-M3.md P4
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { isForgeError } from '@forge/core';
import { diagramSchema, type Diagram } from '@forge/schemas';
import { describe, expect, it } from 'vitest';

import { checkDrift } from '../../src/index.ts';
import type { ComponentsToC4Input } from '../../src/index.ts';

const FIXTURE_ROOT = path.resolve(
  import.meta.dirname,
  '../../../../fixtures/diagram-drift/docs/forge/kb/architecture',
);

function buildDiagram(overrides: Partial<Diagram> = {}): Diagram {
  return diagramSchema.parse({
    id: 'DIAG-001',
    type: 'Diagram',
    schemaVersion: 1,
    title: 'Container decomposition',
    status: 'active',
    created: '2026-03-05',
    updated: '2026-03-05',
    revision: 1,
    author: 'architect',
    changelog: [],
    kind: 'flowchart',
    notation: 'mermaid',
    source: 'docs/forge/kb/architecture/views/containers.mmd',
    generated: true,
    generator: 'components-to-c4',
    depicts: ['component:api', 'component:db'],
    explains: [],
    caption: 'The container-level decomposition of the billing service.',
    alt_text: 'Two boxes, API and Database, with API depending on Database.',
    owner: 'architect',
    ...overrides,
  });
}

/** The fixture's own record of `components-to-c4`'s real current input — see
 * `fixtures/diagram-drift/docs/forge/kb/architecture/components.yaml`. */
const REAL_COMPONENTS_INPUT: ComponentsToC4Input = {
  components: [
    { id: 'component:api', label: 'API', dependsOn: ['component:db'] },
    { id: 'component:db', label: 'Database', dependsOn: [] },
  ],
};

describe('checkDrift — against the real fixtures/diagram-drift fixture', () => {
  it("reports hasDrift: true for the fixture's intentionally out-of-sync containers.mmd", () => {
    const actualSource = readFileSync(path.join(FIXTURE_ROOT, 'views/containers.mmd'), 'utf8');
    const diagram = buildDiagram();
    const result = checkDrift(diagram, actualSource, REAL_COMPONENTS_INPUT);
    expect(result).toEqual({
      diagramId: 'DIAG-001',
      hasDrift: true,
      expected: [
        'flowchart TB',
        '  component_api["API"]',
        '  component_db["Database"]',
        '  component_api --> component_db',
      ].join('\n'),
      actual: actualSource,
    });
  });
});

describe('checkDrift', () => {
  it('reports hasDrift: false when the committed source exactly matches regeneration', () => {
    const diagram = buildDiagram();
    const expected = [
      'flowchart TB',
      '  component_api["API"]',
      '  component_db["Database"]',
      '  component_api --> component_db',
    ].join('\n');
    const result = checkDrift(diagram, expected, REAL_COMPONENTS_INPUT);
    expect(result.hasDrift).toBe(false);
    expect(result.expected).toBe(result.actual);
  });

  it('rejects a generated:true diagram with no generator name (KB-003)', () => {
    // `diagramSchema` itself already refuses to construct this combination ("generated: true
    // requires a generator," M1 P7) — this test is `checkDrift`'s own independent defence for a
    // `Diagram`-shaped value that reached it some other way, so it deliberately bypasses the schema
    // rather than going through `buildDiagram`.
    const diagram = { ...buildDiagram(), generator: undefined } as unknown as Diagram;
    let thrown: unknown;
    try {
      checkDrift(diagram, 'flowchart TB', {});
    } catch (error) {
      thrown = error;
    }
    expect(isForgeError(thrown) && thrown.code === 'KB-003').toBe(true);
  });

  it('rejects a diagram naming a generator this package does not register (KB-003)', () => {
    const diagram = buildDiagram({ generator: 'not-a-real-generator' });
    let thrown: unknown;
    try {
      checkDrift(diagram, 'flowchart TB', {});
    } catch (error) {
      thrown = error;
    }
    expect(isForgeError(thrown) && thrown.code === 'KB-003').toBe(true);
  });

  it('is deterministic: identical inputs always produce the same result', () => {
    const diagram = buildDiagram();
    const first = checkDrift(diagram, 'flowchart TB\n  a["a"]', REAL_COMPONENTS_INPUT);
    const second = checkDrift(diagram, 'flowchart TB\n  a["a"]', REAL_COMPONENTS_INPUT);
    expect(second).toEqual(first);
  });

  it('does not report drift purely from a CRLF-vs-LF line-ending difference', () => {
    // A gauntlet verify pass, probing beyond the original findings, found `checkTransclusion`'s own
    // CRLF fix had a sibling gap here: a real .mmd file checked out with CRLF (the ordinary Windows
    // default) would otherwise report drift against byte-identical-in-content generator output.
    const diagram = buildDiagram();
    const actualSourceWithCrlf = [
      'flowchart TB',
      '  component_api["API"]',
      '  component_db["Database"]',
      '  component_api --> component_db',
    ].join('\r\n');
    const result = checkDrift(diagram, actualSourceWithCrlf, REAL_COMPONENTS_INPUT);
    expect(result.hasDrift).toBe(false);
  });
});
