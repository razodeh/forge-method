/**
 * `moduleSchema` — `19` §19.1's `module.yaml` document shape, checked against its own worked example.
 *
 * @see specs/19 §19.1
 * @see PLAN-M10.md P2
 */
import { describe, expect, it } from 'vitest';

import { moduleSchema } from '../../src/module/schema.ts';

/** `19` §19.1's own worked example, verbatim. */
const FM_SERVICE_EXAMPLE = {
  id: 'fm-service',
  name: 'Backend services and APIs',
  version: '1.3.0',
  forgeVersion: '>=1.0 <2',
  requires: ['fm-core'],
  conflicts: [],
  levels: ['L1', 'L2', 'L3', 'L4'],
  ceilings: {
    backend: {
      write: true,
      exec: ['pnpm *', 'git *', 'docker *'],
      network: 'allowlist',
      deploy: false,
    },
    reviewer: { write: false, exec: ['git *', 'rg*'], network: 'none', deploy: false },
  },
  provides: {
    agents: ['domain-modeler', 'integration-architect'],
    workflows: ['contract-test-cycle'],
    frameworks: ['integration-design', 'api-versioning'],
    checks: ['contract:verify', 'api:breaking-change'],
    artifactTypes: [],
  },
};

describe('moduleSchema', () => {
  it("19 §19.1's own fm-service worked example parses cleanly", () => {
    const result = moduleSchema.safeParse(FM_SERVICE_EXAMPLE);
    expect(result.success).toBe(true);
  });

  it('defaults requires/conflicts/ceilings when omitted', () => {
    const result = moduleSchema.parse({
      ...FM_SERVICE_EXAMPLE,
      requires: undefined,
      conflicts: undefined,
      ceilings: undefined,
    });
    expect(result.requires).toEqual([]);
    expect(result.conflicts).toEqual([]);
    expect(result.ceilings).toEqual({});
  });

  it('rejects a module requiring itself', () => {
    const result = moduleSchema.safeParse({ ...FM_SERVICE_EXAMPLE, requires: ['fm-service'] });
    expect(result.success).toBe(false);
  });

  it('rejects a module conflicting with itself', () => {
    const result = moduleSchema.safeParse({ ...FM_SERVICE_EXAMPLE, conflicts: ['fm-service'] });
    expect(result.success).toBe(false);
  });

  it('rejects a module that both requires and conflicts with the same id', () => {
    const result = moduleSchema.safeParse({
      ...FM_SERVICE_EXAMPLE,
      requires: ['fm-core'],
      conflicts: ['fm-core'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-kebab-case id', () => {
    const result = moduleSchema.safeParse({ ...FM_SERVICE_EXAMPLE, id: 'FmService' });
    expect(result.success).toBe(false);
  });

  it('rejects a version that is not a real major.minor.patch', () => {
    const result = moduleSchema.safeParse({ ...FM_SERVICE_EXAMPLE, version: '1.3' });
    expect(result.success).toBe(false);
  });

  it('rejects an unparseable forgeVersion range', () => {
    const result = moduleSchema.safeParse({ ...FM_SERVICE_EXAMPLE, forgeVersion: 'whatever' });
    expect(result.success).toBe(false);
  });

  it('rejects an empty levels array', () => {
    const result = moduleSchema.safeParse({ ...FM_SERVICE_EXAMPLE, levels: [] });
    expect(result.success).toBe(false);
  });

  it('rejects an unrecognised top-level key', () => {
    const result = moduleSchema.safeParse({ ...FM_SERVICE_EXAMPLE, extra: true });
    expect(result.success).toBe(false);
  });

  it('rejects an overlay array-operator directive inside a ceiling grant — ceilings are flat literal grants, not overlay-mergeable fields', () => {
    // A critic round found the ceiling grant schema was reused from `@forge/extensions/agents`'
    // overlay schema, which also accepts `{ $append: [...] }`/`{ $set: [...] }`/etc. for `exec`/
    // `allowlistHosts` — the right shape for an *overlay* document, wrong for a module's own
    // declared ceiling (`19` §19.1: "ceilings are declared by the module," never a merge target).
    const result = moduleSchema.safeParse({
      ...FM_SERVICE_EXAMPLE,
      ceilings: {
        backend: { ...FM_SERVICE_EXAMPLE.ceilings.backend, exec: { $append: ['curl *'] } },
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an overlay array-operator directive inside allowlistHosts too', () => {
    const result = moduleSchema.safeParse({
      ...FM_SERVICE_EXAMPLE,
      ceilings: {
        backend: {
          ...FM_SERVICE_EXAMPLE.ceilings.backend,
          allowlistHosts: { $set: ['evil.example'] },
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unrecognised provides kind', () => {
    const result = moduleSchema.safeParse({
      ...FM_SERVICE_EXAMPLE,
      provides: { ...FM_SERVICE_EXAMPLE.provides, madeUpKind: ['x'] },
    });
    expect(result.success).toBe(false);
  });

  it("accepts every real provides kind fm-core's own module.yaml uses (gates, skills, catalog, techniques)", () => {
    const result = moduleSchema.safeParse({
      ...FM_SERVICE_EXAMPLE,
      provides: {
        agents: ['x'],
        workflows: [],
        frameworks: [],
        gates: ['G-Verify'],
        checks: [],
        skills: ['writing-an-adr'],
        artifactTypes: [],
        catalog: [],
        techniques: ['five-whys'],
      },
    });
    expect(result.success).toBe(true);
  });
});
