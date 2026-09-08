/**
 * `packForStep` — `05` §5.4 points 4-7's own real, new work over `@forge/kb/pack`'s already-proven
 * layers.
 *
 * @see specs/05 §5.4
 * @see specs/15 §15.4.3
 * @see PLAN-M6.md A4
 */
import { ProjectPaths, type AbsolutePath } from '@forge/core';
import { JsonBackend } from '@forge/kb';
import type { KbTree } from '@forge/kb';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import {
  packForStep,
  type PackForStepOptions,
  type StepContext,
} from '../../src/context/pack-for-step.ts';
import type { AgentDefinition } from '../../src/schema/types.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const realTemplatesPackageRoot = new ProjectPaths(repoRoot).resolveWithin('packages/templates');

const EMPTY_TREE: KbTree = { entries: [], errors: [] };

let scratchDirs: string[] = [];
afterEach(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
  scratchDirs = [];
});

function freshBackend(): JsonBackend {
  const dir = mkdtempSync(path.join(tmpdir(), 'forge-agents-pack-'));
  scratchDirs.push(dir);
  return new JsonBackend(path.join(dir, 'index.json'));
}

/** A synthetic, throwaway skill fixture -- `packForStep`'s own `skillIndex` option is injectable
 * specifically so a test can exercise a real body-inclusion/budget/path-match code path without
 * needing every case to already exist among `@forge/templates`' own 32 real, deliberately thin skills
 * (T5), none of which happen to declare `activation: always` or `applies_to.paths`. */
function writeSyntheticSkill(
  id: string,
  frontMatterExtra: string,
  body: string,
): { skillsPackageRoot: AbsolutePath; skillIndex: Readonly<Record<string, string>> } {
  const root = mkdtempSync(path.join(tmpdir(), 'forge-agents-skill-fixture-'));
  scratchDirs.push(root);
  const skillDir = path.join(root, 'skills', id);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    `---\nid: ${id}\nname: ${id}\nversion: 1.0.0\ndescription: A synthetic test skill.\nwhen_to_use: In this test only.\nbudget_tokens: 3000\n${frontMatterExtra}---\n\n${body}\n`,
  );
  return { skillsPackageRoot: root as AbsolutePath, skillIndex: { [id]: `skills/${id}` } };
}

const BASE_STEP: StepContext = {
  brief: 'implement the story',
  declaredInputIds: [],
  produces: [],
  consumes: [],
};

function agentWithSkills(skills: readonly string[]): AgentDefinition {
  return {
    id: 'test-agent',
    name: 'Test Agent',
    version: '1.0.0',
    tier: 'core',
    mandate: 'test',
    decisions_owned: ['x.y'],
    persona: { voice: 'v', stance: 's', disagreement_style: 'd' },
    inputs: { required: [] },
    outputs: [{ type: 'X', schema: 'x.schema.json', path: 'x.md' }],
    kb_write: [],
    tools: { read: true, write: false, network: false, git_commit: 'none', deploy: false },
    model: { tier: 'balanced', thinking: 'medium' },
    limits: { max_turns: 1, wall_clock_ms: 1, max_cost_usd: 1 },
    parallel_safety: { file_ownership: [], exclusive: false },
    gates: { produces_evidence_for: [], may_approve: [] },
    skills,
    prompt: { system: 'p.md' },
  };
}

const BASE_OPTIONS: Omit<
  PackForStepOptions,
  'templatesPackageRoot' | 'skillIndex' | 'skillsPackBudgetTokens'
> = { budgetTokens: 10_000 };

describe('packForStep', () => {
  it('includes a description/whenToUse summary for every attached skill, always', async () => {
    const agent = agentWithSkills(['git-hygiene-for-lanes']);
    const pack = await packForStep(BASE_STEP, agent, freshBackend(), EMPTY_TREE, {
      ...BASE_OPTIONS,
      skillsPackBudgetTokens: 8000,
      templatesPackageRoot: realTemplatesPackageRoot,
    });
    expect(pack.skills).toHaveLength(1);
    expect(pack.skills[0]?.id).toBe('git-hygiene-for-lanes');
    expect(pack.skills[0]?.description.length).toBeGreaterThan(0);
    expect(pack.skills[0]?.whenToUse.length).toBeGreaterThan(0);
  });

  it('does not include a body for an auto-activation skill with no applicable path match (a real shipped skill, T5)', async () => {
    const agent = agentWithSkills(['tdd-loop-discipline']);
    const pack = await packForStep(BASE_STEP, agent, freshBackend(), EMPTY_TREE, {
      ...BASE_OPTIONS,
      skillsPackBudgetTokens: 8000,
      templatesPackageRoot: realTemplatesPackageRoot,
    });
    expect(pack.skills[0]?.bodyIncluded).toBe(false);
    expect(pack.skills[0]?.body).toBeUndefined();
    expect(pack.skills[0]?.demoted).toBe(false);
  });

  it('includes the real body for an activation: always skill, unconditionally', async () => {
    const { skillsPackageRoot, skillIndex } = writeSyntheticSkill(
      'always-skill',
      'activation: always\n',
      'The real body content.',
    );
    const agent = agentWithSkills(['always-skill']);
    const pack = await packForStep(BASE_STEP, agent, freshBackend(), EMPTY_TREE, {
      ...BASE_OPTIONS,
      skillsPackBudgetTokens: 8000,
      templatesPackageRoot: skillsPackageRoot,
      skillIndex,
    });
    expect(pack.skills[0]?.bodyIncluded).toBe(true);
    expect(pack.skills[0]?.body).toContain('The real body content.');
    expect(pack.skills[0]?.demoted).toBe(false);
  });

  it("includes the body for an activation: auto skill whose applies_to.paths matches the step's own produces claim", async () => {
    const { skillsPackageRoot, skillIndex } = writeSyntheticSkill(
      'path-matched-skill',
      "applies_to:\n  paths: [ 'src/billing/**' ]\n",
      'Billing-specific guidance.',
    );
    const agent = agentWithSkills(['path-matched-skill']);
    const step: StepContext = { ...BASE_STEP, produces: ['src/billing/invoice.ts'] };
    const pack = await packForStep(step, agent, freshBackend(), EMPTY_TREE, {
      ...BASE_OPTIONS,
      skillsPackBudgetTokens: 8000,
      templatesPackageRoot: skillsPackageRoot,
      skillIndex,
    });
    expect(pack.skills[0]?.bodyIncluded).toBe(true);
    expect(pack.skills[0]?.body).toContain('Billing-specific guidance.');
  });

  it("does NOT include the body for an activation: auto skill whose applies_to.paths does not match the step's own claims", async () => {
    const { skillsPackageRoot, skillIndex } = writeSyntheticSkill(
      'path-unmatched-skill',
      "applies_to:\n  paths: [ 'src/billing/**' ]\n",
      'Billing-specific guidance.',
    );
    const agent = agentWithSkills(['path-unmatched-skill']);
    const step: StepContext = { ...BASE_STEP, produces: ['src/shipping/label.ts'] };
    const pack = await packForStep(step, agent, freshBackend(), EMPTY_TREE, {
      ...BASE_OPTIONS,
      skillsPackBudgetTokens: 8000,
      templatesPackageRoot: skillsPackageRoot,
      skillIndex,
    });
    expect(pack.skills[0]?.bodyIncluded).toBe(false);
  });

  it('demotes a body-eligible skill to metadata-only when the skills pack budget is exhausted, and records the demotion', async () => {
    const { skillsPackageRoot, skillIndex } = writeSyntheticSkill(
      'always-skill',
      'activation: always\n',
      'A body long enough to definitely exceed a tiny budget in tokens.',
    );
    const agent = agentWithSkills(['always-skill']);
    const pack = await packForStep(BASE_STEP, agent, freshBackend(), EMPTY_TREE, {
      ...BASE_OPTIONS,
      skillsPackBudgetTokens: 1,
      templatesPackageRoot: skillsPackageRoot,
      skillIndex,
    });
    expect(pack.skills[0]?.bodyIncluded).toBe(false);
    expect(pack.skills[0]?.body).toBeUndefined();
    expect(pack.skills[0]?.demoted).toBe(true);
    expect(pack.skills[0]?.description.length).toBeGreaterThan(0);
  });

  it("processes skills in the agent's own declared order, so an earlier skill's body can exhaust the budget before a later one's", async () => {
    // 400 chars ~= 100 tokens (estimateTokens' own ~4 chars/token ratio) -- fits inside a 150-token
    // budget; the second skill's own 400-char body needs another ~100 tokens, which only 50 remain for.
    const first = writeSyntheticSkill('first-always', 'activation: always\n', 'x'.repeat(400));
    const secondDir = path.join(first.skillsPackageRoot, 'skills', 'second-always');
    mkdirSync(secondDir, { recursive: true });
    writeFileSync(
      path.join(secondDir, 'SKILL.md'),
      `---\nid: second-always\nname: second-always\nversion: 1.0.0\ndescription: second.\nwhen_to_use: test.\nbudget_tokens: 3000\nactivation: always\n---\n\n${'y'.repeat(400)}\n`,
    );
    const skillIndex = { ...first.skillIndex, 'second-always': 'skills/second-always' };

    const agent = agentWithSkills(['first-always', 'second-always']);
    const pack = await packForStep(BASE_STEP, agent, freshBackend(), EMPTY_TREE, {
      ...BASE_OPTIONS,
      skillsPackBudgetTokens: 150,
      templatesPackageRoot: first.skillsPackageRoot,
      skillIndex,
    });
    expect(pack.skills[0]?.bodyIncluded).toBe(true);
    expect(pack.skills[1]?.bodyIncluded).toBe(false);
    expect(pack.skills[1]?.demoted).toBe(true);
  });

  it("does NOT include the body for an activation: explicit skill even when its applies_to.paths matches the step's own claim (never auto-upgraded)", async () => {
    const { skillsPackageRoot, skillIndex } = writeSyntheticSkill(
      'explicit-path-matched-skill',
      "activation: explicit\napplies_to:\n  paths: [ 'src/billing/**' ]\n",
      'Billing-specific guidance.',
    );
    const agent = agentWithSkills(['explicit-path-matched-skill']);
    const step: StepContext = { ...BASE_STEP, produces: ['src/billing/invoice.ts'] };
    const pack = await packForStep(step, agent, freshBackend(), EMPTY_TREE, {
      ...BASE_OPTIONS,
      skillsPackBudgetTokens: 8000,
      templatesPackageRoot: skillsPackageRoot,
      skillIndex,
    });
    expect(pack.skills[0]?.bodyIncluded).toBe(false);
    expect(pack.skills[0]?.body).toBeUndefined();
    expect(pack.skills[0]?.demoted).toBe(false);
  });

  it('a resolved skill id whose own package fails to load (missing/malformed SKILL.md) is a demoted, body-less entry, not a thrown error', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'forge-agents-broken-skill-fixture-'));
    scratchDirs.push(root);
    // no SKILL.md written under skills/broken-skill at all -- parseSkillPackage must throw.
    mkdirSync(path.join(root, 'skills', 'broken-skill'), { recursive: true });
    const skillIndex = { 'broken-skill': 'skills/broken-skill' };

    const agent = agentWithSkills(['broken-skill']);
    const pack = await packForStep(BASE_STEP, agent, freshBackend(), EMPTY_TREE, {
      ...BASE_OPTIONS,
      skillsPackBudgetTokens: 8000,
      templatesPackageRoot: root as AbsolutePath,
      skillIndex,
    });
    expect(pack.skills[0]?.bodyIncluded).toBe(false);
    expect(pack.skills[0]?.demoted).toBe(true);
  });

  it('an unresolved skill id (declared by the agent, not shipped by @forge/templates) is a demoted, body-less entry, not a thrown error', async () => {
    const agent = agentWithSkills(['this-skill-does-not-exist']);
    const pack = await packForStep(BASE_STEP, agent, freshBackend(), EMPTY_TREE, {
      ...BASE_OPTIONS,
      skillsPackBudgetTokens: 8000,
      templatesPackageRoot: realTemplatesPackageRoot,
    });
    expect(pack.skills[0]?.bodyIncluded).toBe(false);
    expect(pack.skills[0]?.demoted).toBe(true);
  });

  it('an agent with no skills produces an empty skills array, and the underlying buildContextPack layers are unaffected', async () => {
    const agent = agentWithSkills([]);
    const pack = await packForStep(BASE_STEP, agent, freshBackend(), EMPTY_TREE, {
      ...BASE_OPTIONS,
      skillsPackBudgetTokens: 8000,
      templatesPackageRoot: realTemplatesPackageRoot,
    });
    expect(pack.skills).toEqual([]);
    expect(pack.pinnedCore).toBeDefined();
    expect(pack.declaredInputs).toEqual([]);
    expect(pack.retrieved).toEqual([]);
  });
});
