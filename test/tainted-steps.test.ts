/**
 * `20` §20.5 point 3 / point 6, `SPEC-QUESTIONS.md` Q232 decision 15, `PLAN-M14.md` P27: exactly the
 * five agent steps across every shipped workflow that read an existing, FORGE-did-not-write codebase
 * declare `taint: external` today -- `adopt`'s `reverse-derive-specs`/`gap-analysis` and `migrate`'s
 * `plan-migration`/`expand`/`contract` (`17` §17.2) -- and no other shipped step anywhere does.
 *
 * Lives at the repository root, not inside `packages/engine/test/`: this is the one check that needs
 * both `@forge/engine/workflow` (`parseWorkflow`) and `@forge/templates` (`WORKFLOW_INDEX`), and `02`
 * §2.2 gives `@forge/templates` zero `@forge/*` dependencies while `@forge/engine` has no edge to
 * `@forge/templates` either -- neither package can import the other, in `src/` or in `test/` (the
 * boundary ESLint rules apply to `packages/**` with no test exemption), the identical reason
 * `test/workflows.test.ts` and `test/greenfield-fixture-generated.test.ts` already live here.
 *
 * @see specs/17 §17.2
 * @see specs/20 §20.5 points 3, 6
 * @see SPEC-QUESTIONS.md Q232 decision 15
 * @see PLAN-M14.md P27
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseWorkflow, type WorkflowStep } from '@forge/engine/workflow';
import { WORKFLOW_INDEX, type WorkflowId } from '@forge/templates';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const templatesPackageRoot = path.join(repoRoot, 'packages', 'templates');
const fixtureWorkflowsDir = path.join(
  repoRoot,
  'fixtures',
  'greenfield-service',
  '.forge',
  'workflows',
);

/** The exactly-five compiled-shaped ids (`${workflowId}:${stepId}`) this piece's own Mandate names,
 * sorted -- the one hard-coded expectation everything below is checked against. */
const EXPECTED_TAINTED_STEPS = [
  'adopt:gap-analysis',
  'adopt:reverse-derive-specs',
  'migrate:contract',
  'migrate:expand',
  'migrate:plan-migration',
].sort();

/** Every `taint: 'external'`-declaring step of `steps`, as `${workflowId}:${stepId}` -- descending
 * through `fanout`/`parallel`/`sequence` the same way `@forge/engine/workflow`'s own internal
 * `childFrames` does (`validate.ts`), since a real shipped workflow could in principle declare one
 * nested inside a group; none does today, but this walk does not silently miss one that did. */
function taintedStepIds(workflowId: string, steps: readonly WorkflowStep[]): readonly string[] {
  const found: string[] = [];
  const walk = (list: readonly WorkflowStep[]): void => {
    for (const step of list) {
      if (step.kind === 'fanout') {
        walk([step.step]);
      } else if (step.kind === 'parallel' || step.kind === 'sequence') {
        walk(step.steps);
      } else if (step.kind === 'agent' && step.taint === 'external' && step.id !== undefined) {
        found.push(`${workflowId}:${step.id}`);
      }
    }
  };
  walk(steps);
  return found;
}

function taintedStepsOf(workflowId: string, source: string): readonly string[] {
  const parsed = parseWorkflow(source);
  if (!parsed.success) {
    throw new Error(
      `"${workflowId}" does not parse: ${parsed.issues.map((i) => i.message).join('; ')}`,
    );
  }
  return taintedStepIds(workflowId, parsed.workflow.steps);
}

describe('exactly the five steps tainted across every shipped workflow (PLAN-M14.md P27)', () => {
  it('has a floor against a vacuous pass: 20 shipped workflows, at least one genuinely tainted', () => {
    expect(Object.keys(WORKFLOW_INDEX).length).toBe(20);
    expect(EXPECTED_TAINTED_STEPS.length).toBeGreaterThan(0);
  });

  it('every shipped workflow, taken together, tainted-steps to exactly the expected five -- no other workflow declares one', () => {
    const all = (Object.keys(WORKFLOW_INDEX) as WorkflowId[]).flatMap((id) => {
      const source = readFileSync(path.join(templatesPackageRoot, WORKFLOW_INDEX[id]), 'utf8');
      return taintedStepsOf(id, source);
    });
    expect(all.sort()).toEqual(EXPECTED_TAINTED_STEPS);
  });

  it('adopt alone: reverse-derive-specs and gap-analysis, not inventory-codebase (a command step)', () => {
    const source = readFileSync(path.join(templatesPackageRoot, WORKFLOW_INDEX.adopt), 'utf8');
    expect([...taintedStepsOf('adopt', source)].sort()).toEqual([
      'adopt:gap-analysis',
      'adopt:reverse-derive-specs',
    ]);
  });

  it('migrate alone: plan-migration, expand and contract, not migrate-data or verify-migration (command steps)', () => {
    const source = readFileSync(path.join(templatesPackageRoot, WORKFLOW_INDEX.migrate), 'utf8');
    expect([...taintedStepsOf('migrate', source)].sort()).toEqual([
      'migrate:contract',
      'migrate:expand',
      'migrate:plan-migration',
    ]);
  });

  describe('fixtures/greenfield-service/.forge/workflows agrees with the shipped source (P18/F3 regeneration)', () => {
    it('has the two regenerated fixture files at all (a floor against a vacuous pass)', () => {
      const files = readdirSync(fixtureWorkflowsDir);
      expect(files).toContain('adopt.workflow.yaml');
      expect(files).toContain('migrate.workflow.yaml');
    });

    it.each(['adopt', 'migrate'] as const)(
      '%s: the fixture copy declares the identical tainted-step set as the shipped source',
      (id) => {
        const shipped = readFileSync(path.join(templatesPackageRoot, WORKFLOW_INDEX[id]), 'utf8');
        const fixture = readFileSync(path.join(fixtureWorkflowsDir, `${id}.workflow.yaml`), 'utf8');
        expect([...taintedStepsOf(id, fixture)].sort()).toEqual(
          [...taintedStepsOf(id, shipped)].sort(),
        );
      },
    );
  });
});
