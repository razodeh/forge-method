/**
 * A small, hand-built `Survey`/`Inventory` pair for `@forge/engine/adopt`'s own dispatch-orchestration
 * tests — real enough to be a real `EvidenceIndex`'s worth of citable paths/facts, small enough to read
 * in full at the call site. `packages/kb/test/adopt`'s own richer fixture (a real, walked repository)
 * already covers `buildEvidenceIndex`/`assembleCartography`/`assembleInference` themselves in depth
 * (`kb`'s own test suite); this module only needs *some* real evidence for these dispatch tests to check
 * against, not a second copy of that coverage.
 */
import type { AgentDefinition } from '@forge/agents/schema';
import type { Inventory, Survey } from '@forge/kb/adopt';

export function fixtureSurvey(): Survey {
  return {
    size: {
      totalFiles: 3,
      totalLines: 30,
      byLanguage: [{ language: 'TypeScript', files: 3, lines: 30 }],
    },
    manifests: [{ toolchain: 'node', path: 'package.json' }],
    entryPoints: [{ kind: 'package-main', path: 'package.json', value: 'src/index.js' }],
    deployableUnits: [],
    datastores: [{ kind: 'connection-string', path: 'src/db.ts', evidence: 'postgres://...' }],
    testSetup: { testDirs: [], frameworks: [], ciTestCommands: [] },
    ci: [],
    gitProfile: {
      hasCommits: true,
      ageDays: 10,
      commitCount: 5,
      contributorCount: 1,
      churnHotspots: [{ path: 'src/routes.ts', commitCount: 4 }],
      filesChangedTogether: [],
    },
    existingDocs: [],
    health: { todoFixmeCount: 0, lintConfigPresent: false, typeCheckConfigPresent: false },
  };
}

export function fixtureInventory(): Inventory {
  return {
    dependencyGraph: {
      nodes: [
        { module: 'src/routes', imports: ['src/db'] },
        { module: 'src/db', imports: [] },
      ],
      cycles: [],
    },
    publicApiSurface: [
      {
        kind: 'http-route',
        name: 'GET /health',
        path: 'src/routes.ts',
        evidence: "app.get('/health')",
      },
    ],
    dataSurface: [{ kind: 'orm-entity', path: 'prisma/schema.prisma', name: 'User' }],
    configSurface: [{ kind: 'env-var', name: 'PORT', path: 'src/routes.ts', line: 3 }],
    externalDependencies: [{ name: 'express', version: '4.18.0', ecosystem: 'npm' }],
  };
}

export function testAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: 'architect',
    name: 'Architect',
    version: '1.0.0',
    tier: 'core',
    mandate: 'Understand and record the real architecture.',
    decisions_owned: [],
    persona: { voice: 'analytical', stance: 'pragmatic', disagreement_style: 'direct' },
    inputs: { required: [] },
    outputs: [{ type: 'X', schema: 'x.schema.json', path: 'x.md' }],
    kb_write: [],
    tools: { read: true, write: true, network: false, git_commit: 'lane', deploy: false },
    model: { tier: 'balanced', thinking: 'medium' },
    limits: { max_turns: 10, wall_clock_ms: 600_000, max_cost_usd: 5 },
    parallel_safety: { file_ownership: [], exclusive: false },
    gates: { produces_evidence_for: [], may_approve: [] },
    skills: [],
    prompt: { system: 'p.md' },
    ...overrides,
  };
}
