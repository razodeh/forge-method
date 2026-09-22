/**
 * `M14 P1` (`SPEC-QUESTIONS.md` Q233, `PLAN-M14.md` P1): the mechanical spec amendments Q232's
 * "Spec text to amend" list names, checked two ways.
 *
 * 1. Every literal (non-`<placeholder>`) workflow id `forge run` names in `03` §3.2.4 or `01` SC2
 *    names a real `WORKFLOW_INDEX` id — the check that was RED on `build` before this piece (`03`
 *    §3.2.4's own worked example, and `01`'s SC2, both said `forge run build --stage mvp`, and no
 *    workflow is registered under the id `build`; the real id is `build-stage`). Lives at the
 *    repository root for the same cross-package reason `test/workflows.test.ts` documents: it needs
 *    `@forge/templates` (`WORKFLOW_INDEX`) together with the bare `specs/` directory, and no single
 *    package may depend on both an arbitrary sibling package and the specification pack.
 * 2. One small, deletable `it` per spec sentence this piece added or changed, pinning the literal
 *    substring so a later piece cannot silently revert or reword it without a failing test naming
 *    which one. Each is independently deletable: it proves one sentence, not a structural invariant,
 *    so removing one when a LATER piece legitimately rewords that sentence again does not risk hiding
 *    a different regression.
 *
 * `specs/05` §5.2 is deliberately NOT touched by this piece and has no pin here: `PLAN-M14.md`'s P1
 * mandate named a roster-row edit (analyst/pm/facilitator) with no `Q232` citation (every sibling
 * clause in the same paragraph cites one), and it directly re-opens `Q224`'s own considered decision
 * to leave those rows as diverging descriptive prose (`SPEC-QUESTIONS.md` Q224, "the rows are
 * descriptive prose ... the new §5.2 paragraph ... says the machine-readable definition follows the
 * workflow step"; `GAUNTLET-LOG.md`'s `## M13 P18` Round 3 lists it under "Disclosed", not under an
 * action-oriented "Left open" list). Left unmade; recorded in `Q233` for the orchestrator.
 *
 * @see specs/01 SC2
 * @see specs/02 §2.5
 * @see specs/03 §3.2.3, §3.2.4, §3.2.5, §3.2.7, §3.5
 * @see specs/06 §6.7
 * @see specs/08 §8.6
 * @see specs/09 §9.8
 * @see specs/10 §10.1
 * @see specs/15 §15.3.2
 * @see specs/20 §20.2
 * @see PLAN-M14.md P1
 * @see SPEC-QUESTIONS.md Q224, Q232, Q233
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { WORKFLOW_INDEX } from '@forge/templates';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readSpec(fileName: string): string {
  return readFileSync(path.join(repoRoot, 'specs', fileName), 'utf8');
}

/** Everything between a `## `/`### ` heading whose text is `heading` and the next heading of the same
 * or a higher level (i.e. the next line starting with one or more `#`). Throws if `heading` is not
 * found, so a renamed section fails loudly instead of silently slicing nothing. */
function section(specText: string, heading: string): string {
  const marker = `${heading}\n`;
  const start = specText.indexOf(marker);
  if (start === -1) throw new Error(`heading ${JSON.stringify(heading)} not found`);
  const bodyStart = start + marker.length;
  const next = specText.slice(bodyStart).search(/\n#{1,6} /);
  return next === -1 ? specText.slice(bodyStart) : specText.slice(bodyStart, bodyStart + next);
}

const SPEC_03 = readSpec('03-cli-and-installer.md');
const SPEC_01 = readSpec('01-product-vision-and-scope.md');

/** Every literal workflow id named directly after `forge run ` — i.e. not the `<workflow>` placeholder,
 * which starts with `<` and so never matches this pattern. */
function literalRunWorkflowIds(text: string): string[] {
  return [...text.matchAll(/forge run ([a-z][a-z0-9-]*)/g)].map((match) => match[1] ?? '');
}

describe('every literal `forge run <id>` in 03 §3.2.4 and 01 SC2 names a real workflow', () => {
  const executionCommands = section(SPEC_03, '### 3.2.4 Execution commands');
  const sc2Line = SPEC_01.split('\n').find((line) => line.includes('**SC2**'));
  if (sc2Line === undefined) throw new Error('01 SC2 line not found');

  it('03 §3.2.4 names at least one literal workflow id, and every one is a real WORKFLOW_INDEX id', () => {
    const ids = literalRunWorkflowIds(executionCommands);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(Object.keys(WORKFLOW_INDEX), `03 §3.2.4 names "${id}"`).toContain(id);
    }
    // The specific regression this test exists to catch: the worked example used to say `build`,
    // which is not a workflow id (the real id is `build-stage`).
    expect(ids).toContain('build-stage');
    expect(ids).not.toContain('build');
  });

  it('01 SC2 names a real WORKFLOW_INDEX id, not the stale "build" alias', () => {
    const ids = literalRunWorkflowIds(sc2Line);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(Object.keys(WORKFLOW_INDEX), `01 SC2 names "${id}"`).toContain(id);
    }
    expect(ids).toContain('build-stage');
  });
});

describe('03 §3.2.4/§3.2.3/§3.2.7: --input, --answers and --commit are documented', () => {
  const executionCommands = section(SPEC_03, '### 3.2.4 Execution commands');
  const planningCommands = section(SPEC_03, '### 3.2.3 Planning commands');
  const metaCommands = section(SPEC_03, '### 3.2.7 Meta commands');

  it('the `forge run` row lists both --input and --answers', () => {
    const row = executionCommands.split('\n').find((line) => line.includes('forge run <workflow>'));
    expect(row, 'forge run row not found').toBeDefined();
    expect(row).toContain('--input');
    expect(row).toContain('--answers');
  });

  it('the `forge resume` row lists --answers', () => {
    const row = executionCommands.split('\n').find((line) => line.includes('forge resume'));
    expect(row, 'forge resume row not found').toBeDefined();
    expect(row).toContain('--answers');
  });

  it('the `forge plan replan` row lists --answers', () => {
    const row = planningCommands.split('\n').find((line) => line.includes('forge plan replan'));
    expect(row, 'forge plan replan row not found').toBeDefined();
    expect(row).toContain('--answers');
  });

  it('the `forge config` row names `set <key> <value> [--commit]`', () => {
    const row = metaCommands.split('\n').find((line) => line.includes('forge config <sub>'));
    expect(row, 'forge config row not found').toBeDefined();
    expect(row).toContain('--commit');
  });
});

describe('pinned amended sentences (Q232/PLAN-M14.md P1) — delete an `it` individually once a later piece legitimately rewords its sentence again', () => {
  it('06 §6.7: an out-of-claim write under `strict` "fails the step"', () => {
    expect(readSpec('06-orchestration-and-parallelism.md')).toContain('fails the step');
  });

  it('20 §20.2: claim enforcement says "the step also fails" under `strict`', () => {
    expect(readSpec('20-security-safety-and-cost.md')).toContain('the step also fails');
  });

  it('02 §2.5: no longer says every KB write is applied "never as raw file writes"; names the declared-output exception', () => {
    const spec02 = readSpec('02-architecture-and-tech-stack.md');
    expect(spec02).not.toContain('never as raw file writes');
    expect(spec02).toContain('mandatory `sources`, deprecate-not-delete');
  });

  it('08 §8.6: gains a third **Declared output** path, and a closing sentence that both paths bind the same invariants', () => {
    const spec08 = readSpec('08-knowledge-body.md');
    expect(spec08).toContain('**Declared output**');
    expect(spec08).toContain('These invariants bind every path');
  });

  it('15 §15.3.2: the derived test-command grant is named (`execution.testCommands`); I7 gains the one-exception clause', () => {
    const spec15 = readSpec('15-customization-and-user-freedom.md');
    expect(spec15).toContain('execution.testCommands');
    expect(spec15).toContain('is not an escalation');
  });

  it('10 §10.1: the `elicit` row carries RUN-101, RUN-102, `choices` and a `show:` entry', () => {
    const spec10 = readSpec('10-workflow-engine-and-lifecycle.md');
    expect(spec10).toContain('RUN-101');
    expect(spec10).toContain('RUN-102');
    expect(spec10).toContain('choices');
    expect(spec10).toContain('show:');
  });

  it('03 §3.2.4: the --input/--answers explanatory paragraph itself is present (not just the table rows)', () => {
    const spec03 = readSpec('03-cli-and-installer.md');
    expect(spec03).toContain('supplies a declared workflow input');
    expect(spec03).toContain('no terminal to ask on fails its step');
  });

  it('09 §9.8: the prose explains verify runs at self-verify (step 6) and done at commit/merge (step 9)', () => {
    const spec09 = readSpec('09-spec-driven-development.md');
    expect(spec09).toContain('two moments, not one list');
    expect(spec09).toContain('self-verify step of the loop');
    expect(spec09).toContain('runs at commit');
  });

  it('03 §3.2.5: `forge story verify` now evaluates the `verify` profile, not `done` (matches the 09 §9.8 split, Q232 decision 13)', () => {
    const spec03 = readSpec('03-cli-and-installer.md');
    expect(spec03).toContain("story's `verify` DoD profile");
    expect(spec03).not.toContain("story's `done` DoD profile");
  });

  it('03 §3.5: a refusal under --json prints the {v:1,ok:false,error} envelope', () => {
    expect(readSpec('03-cli-and-installer.md')).toContain('"ok":false,"error"');
  });
});
