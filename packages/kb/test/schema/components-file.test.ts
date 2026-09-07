/**
 * `componentSchema`/`componentsFileSchema` — `architecture/components.md`'s own on-disk shape.
 *
 * @see specs/08 §8.2
 * @see SPEC-QUESTIONS.md Q56
 * @see PLAN-M3.md P10
 */
import { describe, expect, it } from 'vitest';

import { componentSchema, componentsFileSchema } from '../../src/schema/components-file.ts';

function componentsFile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'Component',
    schemaVersion: 1,
    title: 'Component inventory',
    status: 'active',
    created: '2026-01-05',
    updated: '2026-01-05',
    revision: 1,
    author: 'architect',
    changelog: [],
    components: [
      {
        id: 'component:api',
        label: 'API',
        responsibility: 'Serves the public HTTP interface.',
        owner: 'platform',
        dependsOn: ['component:db'],
        failureModes: ['Database unreachable: 503s on every request'],
      },
    ],
    ...overrides,
  };
}

describe('componentSchema', () => {
  it('accepts a well-formed component', () => {
    const result = componentSchema.safeParse({
      id: 'component:api',
      label: 'API',
      responsibility: 'Serves the public HTTP interface.',
      owner: 'platform',
      dependsOn: ['component:db'],
      failureModes: ['Database unreachable: 503s on every request'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an id that does not use the component:<slug> tag format', () => {
    const result = componentSchema.safeParse({
      id: 'CMP-001',
      label: 'API',
      responsibility: 'x',
      owner: 'platform',
      dependsOn: [],
      failureModes: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a dependsOn entry that does not use the component:<slug> tag format either', () => {
    const result = componentSchema.safeParse({
      id: 'component:api',
      label: 'API',
      responsibility: 'x',
      owner: 'platform',
      dependsOn: ['db'],
      failureModes: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown field (.strict())', () => {
    const result = componentSchema.safeParse({
      id: 'component:api',
      label: 'API',
      responsibility: 'x',
      owner: 'platform',
      dependsOn: [],
      failureModes: [],
      extra: 'nope',
    });
    expect(result.success).toBe(false);
  });
});

describe('componentsFileSchema', () => {
  it('accepts a well-formed components file with more than one entry', () => {
    const result = componentsFileSchema.safeParse(
      componentsFile({
        components: [
          {
            id: 'component:api',
            label: 'API',
            responsibility: 'x',
            owner: 'platform',
            dependsOn: ['component:db'],
            failureModes: [],
          },
          {
            id: 'component:db',
            label: 'Database',
            responsibility: 'y',
            owner: 'platform',
            dependsOn: [],
            failureModes: [],
          },
        ],
      }),
    );
    expect(result.success).toBe(true);
  });

  it('carries the base front matter fields every other collection file already has (title/status/created/updated/revision/author/changelog)', () => {
    const result = componentsFileSchema.safeParse(componentsFile());
    expect(result.success).toBe(true);
    expect(result.success && result.data.title).toBe('Component inventory');
    expect(result.success && result.data.revision).toBe(1);
  });

  it('has no id field of its own — a collection file names many ids, not one', () => {
    const result = componentsFileSchema.safeParse(componentsFile({ id: 'CMP-FILE-0001' }));
    expect(result.success).toBe(false);
  });

  it('rejects a type other than the literal "Component"', () => {
    const result = componentsFileSchema.safeParse(componentsFile({ type: 'Risk' }));
    expect(result.success).toBe(false);
  });
});
