/**
 * `fm-core`'s own real `module.yaml` (`19` §19.1, `PLAN-M10.md` P1) -- proves every id it `provides`
 * resolves to something real, not merely that the manifest is shaped correctly.
 *
 * Lives at the repository root, not inside any one package's own `test/`, for the identical
 * cross-package-check reason `test/workflows.test.ts`/`test/gates.test.ts`/`test/templates.test.ts`
 * already document: this is the one check that needs `@forge/templates` (`WORKFLOW_INDEX`/
 * `GATE_INDEX`/`FRAMEWORK_INDEX`/`SKILL_INDEX`/`TEMPLATE_INDEX`) *and* direct filesystem access to
 * `modules/fm-core/` (a bare workspace directory with no package of its own, so it has no `src`/`test`
 * to hold this check either) -- `02` §2.2's boundary rules apply to `packages/**` only, and the
 * repository root sits outside that glob.
 *
 * No L1 `module.yaml` schema or parser exists yet (that is `PLAN-M10.md` P2's own job) -- this test
 * therefore parses `module.yaml` as plain YAML and checks its shape and every referenced id by hand,
 * against the literal fields `19` §19.1's own worked example names (`id`, `requires`, `conflicts`,
 * `levels`, `ceilings`, `provides`), not against any schema.
 *
 * @see specs/19 §19.1
 * @see PLAN-M10.md P1
 * @see SPEC-QUESTIONS.md Q150
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';

import {
  FRAMEWORK_INDEX,
  GATE_INDEX,
  SKILL_INDEX,
  TEMPLATE_INDEX,
  WORKFLOW_INDEX,
  type FrameworkId,
  type GateId,
  type SkillId,
  type TemplateArtifactTypeId,
  type WorkflowId,
} from '@forge/templates';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modulesRoot = path.join(repoRoot, 'modules');
const fmCoreRoot = path.join(modulesRoot, 'fm-core');
const templatesPackageRoot = path.join(repoRoot, 'packages', 'templates');

interface ToolGrant {
  readonly write: boolean;
  readonly exec?: readonly string[];
  readonly network: boolean | 'none' | 'allowlist' | 'full';
  readonly deploy: boolean;
}

interface RawModuleFile {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly forgeVersion: string;
  readonly requires: readonly string[];
  readonly conflicts: readonly string[];
  readonly levels: readonly string[];
  readonly ceilings: Readonly<Record<string, ToolGrant>>;
  readonly provides: {
    readonly agents: readonly string[];
    readonly workflows: readonly string[];
    readonly gates: readonly string[];
    readonly frameworks: readonly string[];
    readonly checks: readonly string[];
    readonly skills: readonly string[];
    readonly artifactTypes: readonly string[];
    readonly catalog: readonly string[];
    readonly techniques: readonly string[];
  };
}

function readFmCoreModule(): RawModuleFile {
  return parseYaml(readFileSync(path.join(fmCoreRoot, 'module.yaml'), 'utf8')) as RawModuleFile;
}

describe('fm-core/module.yaml (19 §19.1) parses as valid YAML matching the worked-example shape', () => {
  const mod = readFmCoreModule();

  it('has the literal top-level fields the 19 §19.1 worked example names', () => {
    expect(mod.id).toBe('fm-core');
    expect(typeof mod.name).toBe('string');
    expect(mod.name.length).toBeGreaterThan(0);
    expect(mod.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(typeof mod.forgeVersion).toBe('string');
    expect(Array.isArray(mod.requires)).toBe(true);
    expect(Array.isArray(mod.conflicts)).toBe(true);
    expect(mod.levels).toEqual(['L1', 'L2', 'L3', 'L4']);
  });

  it('always-installed with nothing else installed: requires and conflicts are both empty', () => {
    expect(mod.requires).toEqual([]);
    expect(mod.conflicts).toEqual([]);
  });

  it('declares a ceiling for every one of the 29 real agent roles it provides, no more and no fewer', () => {
    expect(Object.keys(mod.ceilings).sort()).toEqual([...mod.provides.agents].sort());
  });

  it('every declared ceiling is a well-formed ToolGrant', () => {
    for (const [role, grant] of Object.entries(mod.ceilings)) {
      expect(typeof grant.write).toBe('boolean');
      expect(typeof grant.deploy).toBe('boolean');
      expect(['boolean', 'string']).toContain(typeof grant.network);
      if (grant.exec !== undefined) {
        expect(Array.isArray(grant.exec)).toBe(true);
        for (const pattern of grant.exec) expect(typeof pattern).toBe('string');
      }
      // Sanity anchor against real, independently-known data: `sre` is the one agent whose own
      // `tools:` block grants `deploy: true` (confirmed directly against
      // `modules/fm-core/agents/sre.agent.yaml`); every other role's ceiling must not.
      if (role !== 'sre') expect(grant.deploy).toBe(false);
    }
    expect(mod.ceilings['sre']?.deploy).toBe(true);
  });
});

describe('every id fm-core/module.yaml provides resolves to something real on disk', () => {
  const mod = readFmCoreModule();

  it.each(mod.provides.agents)('agent %s has a real modules/fm-core/agents/%s.agent.yaml', (id) => {
    const filePath = path.join(fmCoreRoot, 'agents', `${id}.agent.yaml`);
    expect(existsSync(filePath)).toBe(true);
    const parsed = parseYaml(readFileSync(filePath, 'utf8')) as { readonly id: string };
    expect(parsed.id).toBe(id);
  });

  it('provides.agents names exactly the 29 real files on disk, no more and no fewer', () => {
    expect([...mod.provides.agents].sort()).toEqual([
      'analyst',
      'architect',
      'backend',
      'base-engineer',
      'compliance',
      'critic',
      'data-architect',
      'data-engineer',
      'diagnostician',
      'domain-modeler',
      'em',
      'facilitator',
      'finops',
      'frontend',
      'integration-architect',
      'ml-engineer',
      'mobile',
      'orchestrator',
      'platform',
      'pm',
      'po',
      'release',
      'reviewer',
      'sdet',
      'security',
      'sre',
      'techwriter',
      'test-architect',
      'ux',
    ]);
  });

  it.each(mod.provides.workflows)(
    'workflow %s resolves via @forge/templates WORKFLOW_INDEX to a real file',
    (id) => {
      const relPath = WORKFLOW_INDEX[id as WorkflowId];
      expect(relPath).toBeDefined();
      expect(existsSync(path.join(templatesPackageRoot, relPath))).toBe(true);
    },
  );

  it('provides.workflows names exactly all 20 real WORKFLOW_INDEX ids -- fm-core ships every lifecycle workflow, not a ten-of-twenty subset (Q88)', () => {
    expect([...mod.provides.workflows].sort()).toEqual(Object.keys(WORKFLOW_INDEX).sort());
  });

  it.each(mod.provides.gates)(
    'gate %s resolves via @forge/templates GATE_INDEX to a real file',
    (id) => {
      const relPath = GATE_INDEX[id as GateId];
      expect(relPath).toBeDefined();
      expect(existsSync(path.join(templatesPackageRoot, relPath))).toBe(true);
    },
  );

  it('provides.gates names exactly all 10 real GATE_INDEX ids -- "all gates" per the shipped-modules row', () => {
    expect([...mod.provides.gates].sort()).toEqual(Object.keys(GATE_INDEX).sort());
  });

  it.each(mod.provides.frameworks)(
    'framework %s resolves via @forge/templates FRAMEWORK_INDEX to a real file',
    (id) => {
      const relPath = FRAMEWORK_INDEX[id as FrameworkId];
      expect(relPath).toBeDefined();
      expect(existsSync(path.join(templatesPackageRoot, relPath))).toBe(true);
    },
  );

  it("provides.frameworks names all real FRAMEWORK_INDEX ids except analytical-pipeline-design (F-DATA-8, fm-data's own contribution per 19 §19.1)", () => {
    const allFrameworkIds = Object.keys(FRAMEWORK_INDEX);
    const expected = allFrameworkIds.filter((id) => id !== 'analytical-pipeline-design');
    expect([...mod.provides.frameworks].sort()).toEqual(expected.sort());
    expect(mod.provides.frameworks).not.toContain('analytical-pipeline-design');
  });

  it.each(mod.provides.skills)(
    'skill %s resolves via @forge/templates SKILL_INDEX to a real directory containing SKILL.md',
    (id) => {
      const relPath = SKILL_INDEX[id as SkillId];
      expect(relPath).toBeDefined();
      const skillDir = path.join(templatesPackageRoot, relPath);
      expect(existsSync(skillDir)).toBe(true);
      expect(existsSync(path.join(skillDir, 'SKILL.md'))).toBe(true);
    },
  );

  it('provides.skills names exactly all 32 real SKILL_INDEX ids -- the full base skill library', () => {
    expect([...mod.provides.skills].sort()).toEqual(Object.keys(SKILL_INDEX).sort());
  });

  it.each(mod.provides.artifactTypes)(
    'artifact type %s resolves via @forge/templates TEMPLATE_INDEX to a real file',
    (id) => {
      const relPath = TEMPLATE_INDEX[id as TemplateArtifactTypeId];
      expect(relPath).toBeDefined();
      expect(existsSync(path.join(templatesPackageRoot, relPath))).toBe(true);
    },
  );

  it('provides.artifactTypes names exactly all 21 real TEMPLATE_INDEX ids -- the full base template registry', () => {
    expect([...mod.provides.artifactTypes].sort()).toEqual(Object.keys(TEMPLATE_INDEX).sort());
  });

  it('provides.checks/catalog/techniques are deliberately empty -- no standalone check content, catalog-agnostic ownership, and techniques are a later piece (P9), not silently omitted keys', () => {
    expect(mod.provides.checks).toEqual([]);
    expect(mod.provides.catalog).toEqual([]);
    expect(mod.provides.techniques).toEqual([]);
  });
});

describe('fm-core does not duplicate @forge/templates content on disk (SPEC-QUESTIONS.md Q150)', () => {
  it('modules/fm-core has no workflows/gates/frameworks/skills/templates directory of its own -- that content is real and already lives in @forge/templates, never forked into a second on-disk copy here', () => {
    const entries = new Set(readdirSync(fmCoreRoot).filter((name) => !name.startsWith('.')));
    for (const forkedDir of ['workflows', 'gates', 'frameworks', 'skills', 'templates']) {
      expect(entries.has(forkedDir)).toBe(false);
    }
    // `agents/` and `module.yaml` are always expected; other module-layout directories (e.g.
    // `techniques/`, a separate piece this plan assigns elsewhere) may legitimately appear over time
    // and are not this test's concern.
    expect(entries.has('agents')).toBe(true);
    expect(entries.has('module.yaml')).toBe(true);
  });
});
