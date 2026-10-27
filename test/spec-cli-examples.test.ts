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
import { execFileSync } from 'node:child_process';
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

/**
 * `M14 P11` (`SPEC-QUESTIONS.md` Q232 decision 2, `PLAN-M14.md` P11): P11 pins the `02` §2.5 / `08`
 * §8.6 sentences it relies on (both already amended by P1, above) and adds exactly one new sentence of
 * its own -- a `06` §6.4 rule 1 cross-reference, nothing else -- so this block only proves that one new
 * sentence plus the two it depends on, the same "delete an `it` individually once reworded" contract
 * the P1 block above establishes.
 *
 * @see specs/02 §2.5
 * @see specs/06 §6.4
 * @see specs/08 §8.6
 * @see PLAN-M14.md P11
 */
describe('pinned amended/added sentences (PLAN-M14.md P11)', () => {
  it("06 §6.4 rule 1: a declared KB output write is cross-referenced to 08 §8.6's KbWriter invariants", () => {
    const spec06 = readSpec('06-orchestration-and-parallelism.md');
    expect(spec06).toContain(
      "A declared KB output's own write is still bound\n  by `08` §8.6's `KbWriter` invariants",
    );
  });

  it("08 §8.6 (P1): still states the mandatory-sources and never-reused/removed KbWriter invariants P11's own output check enforces", () => {
    const spec08 = readSpec('08-knowledge-body.md');
    expect(spec08).toContain('Every write records `sources`. A write with no source is rejected.');
    expect(spec08).toContain(
      'never reused (deleted entries become `deprecated`,\n  files retained)',
    );
  });

  it("02 §2.5 (P1): still names the declared-output exception's own invariants", () => {
    expect(readSpec('02-architecture-and-tech-stack.md')).toContain(
      'mandatory `sources`, deprecate-not-delete',
    );
  });
});

/**
 * `M15 P1` (`SPEC-QUESTIONS.md` Q280, `PLAN-M15.md` P1): behavioural binding, evidence resolution,
 * and the two new `MutationEvidence`/`EvidenceBundle` registry rows — one pinned `it` per sentence
 * this spec-only piece added or changed, the identical "delete an `it` individually once a later
 * piece legitimately rewords its sentence again" contract the M14 P1 block above establishes. Added
 * in response to a round-1 gauntlet critic finding (two independent critics): this piece originally
 * shipped with no test anchoring any of its own new normative text at all, meaning a later piece
 * could silently revert or reword any of it and `pnpm test` would stay green — precisely the
 * "certifies diligence, not correctness" failure `PLAN-M15.md`'s own opening section exists to close,
 * reproduced inside the milestone's own first piece. See `SPEC-QUESTIONS.md` Q280's round-1 record.
 *
 * @see specs/09 §9.5
 * @see specs/10 §10.3
 * @see specs/13 F-TEST-5
 * @see specs/18 §18.7
 * @see PLAN-M15.md P1
 * @see SPEC-QUESTIONS.md Q280
 */
describe('pinned sentences (SPEC-QUESTIONS.md Q280, PLAN-M15.md P1) — delete an `it` individually once a later piece legitimately rewords its sentence again', () => {
  it('09 §9.5: the binding rule is named nominal, distinct from behavioural binding', () => {
    const spec09 = readSpec('09-spec-driven-development.md');
    expect(spec09).toContain(
      'This binding is **nominal**: it maps a result back to the AC id that names it',
    );
    expect(spec09).toContain('names that gap **behavioural binding** and closes it with a');
  });

  it('13 F-TEST-5: AC-binding is named nominal, not behavioural, and the two mutation strategies are named complementary, not duplicative', () => {
    const spec13 = readSpec('13-frameworks-testing-and-debugging.md');
    expect(spec13).toContain('is nominal, not behavioural, and this framework names the gap');
    expect(spec13).toContain(
      'The two are complementary, not duplicative: behavioural binding is coarse,',
    );
  });

  it('10 §10.3: Gate rule 7 refuses evidence absence with no waiver path at all, distinct from rule 1', () => {
    const spec10 = readSpec('10-workflow-engine-and-lifecycle.md');
    expect(spec10).toContain(
      'excuses a check that ran and genuinely failed, not proof that was never produced',
    );
  });

  it('10 §10.3: the Evidence resolution rule states its own bar is existence, not an ongoing freshness guarantee', () => {
    expect(readSpec('10-workflow-engine-and-lifecycle.md')).toContain(
      'not an ongoing freshness guarantee against a later',
    );
  });

  it('10 §10.3: the G-Verify catalogue row names non-behaviourally-bound tests as a failure mode', () => {
    expect(readSpec('10-workflow-engine-and-lifecycle.md')).toContain(
      'non-behaviourally-bound tests',
    );
  });

  it('18 §18.7: MutationEvidence and EvidenceBundle are both registered', () => {
    const spec18 = readSpec('18-persistence-config-and-schemas.md');
    expect(spec18).toContain('id: MutationEvidence, idPrefix: MUT');
    expect(spec18).toContain('id: EvidenceBundle, idPrefix: EVID');
  });

  it('18 §18.7: both new types are genuinely append-only (never edited, only superseded)', () => {
    expect(readSpec('18-persistence-config-and-schemas.md')).toContain(
      'Both are genuinely **append-only — never edited, only superseded**',
    );
  });

  it('18 §18.7: "superseded" is correctly attributed to 08 §8.3/§8.4\'s real status:superseded convention, not 18 §18.8', () => {
    expect(readSpec('18-persistence-config-and-schemas.md')).toContain(
      "§8.3/§8.4's `status: superseded` convention",
    );
  });

  it("18 §18.7: MutationEvidence's fields are decided here (per PLAN-M15.md P2's own complete Mandate), not deferred", () => {
    expect(readSpec('18-persistence-config-and-schemas.md')).toContain(
      "`MutationEvidence`'s own fields are decided here, not deferred, because `PLAN-M15.md`'s P2 Mandate",
    );
  });

  it("13: F-TEST-8 establishes the exemption mechanism (round-3 critic finding: P1's own Mandate items (c)/(d) had been silently skipped)", () => {
    const spec13 = readSpec('13-frameworks-testing-and-debugging.md');
    expect(spec13).toContain('F-TEST-8 · Exempting a test from behavioural binding');
    expect(spec13).toContain('**A stale exemption fails the check.**');
    expect(spec13).toContain('**An expired exemption fails the check**');
    expect(spec13).toContain('**Exempting a test that currently binds is refused.**');
  });

  it('18 §18.7: Disclosure is registered as the user-project analogue of SPEC-QUESTIONS.md (round-3 critic finding)', () => {
    const spec18 = readSpec('18-persistence-config-and-schemas.md');
    expect(spec18).toContain('id: Disclosure, idPrefix: DISC');
    expect(spec18).toContain("is the user-project analogue of this very repository's own");
  });
});

/**
 * `M16 P1` (`SPEC-QUESTIONS.md` Q294, `PLAN-M16.md` P1): the spec-only first piece of the parity-oracle
 * milestone. It corrects the milestone's premise (`refactor`, `migrate` and `adopt` contained no
 * `kind: gate` step), defines a parity oracle (`13` F-TEST-9) and hunk-level binding (`13` F-TEST-10),
 * and says where each lands: the workflow-scoped gate (`10` §10.3 rule 8), the `ParityEvidence` type,
 * the hunk-level `MutationEvidence` shape, the payload-versioning rule and the retention policy
 * (`18` §18.4, §18.7, §18.8), the committed `.forge/parity/` tree (`18` §18.2), and four commands that
 * are not wired yet (`03` §3.2.5).
 *
 * One pinned `it` per requirement (a sentence, or the two or three that state one rule together),
 * under the same "delete an `it` individually once a later piece legitimately rewords its sentence
 * again" contract the M14 P1 and M15 P1 blocks above establish. Five things differ from those
 * blocks, each on purpose:
 *
 * - Every pin is scoped to the one section its sentence lives in (`headingSection`), so a phrase that
 *   also appears elsewhere in the pack cannot keep a deleted sentence green.
 * - Every presence check reads the section's prose (`Section.text`): the section as a reader of the
 *   rendered spec sees it, whitespace-normalised, with HTML comments (on one line or across several)
 *   and fenced code (the fence lines too) removed, so a sentence that survives only in a comment or a
 *   code block is not present. `Section.rawText` keeps everything and is read by `expectAbsent` alone:
 *   a sentence a spec deleted from its prose cannot hide in a comment or a fence and read as gone.
 *   `Section.lines` stay raw; `Section.visibleLines` keep the fences (and lose the comments), which
 *   is what `expectLines` reads for a line that lives in a fence, such as an exit test of `specs/22`.
 * - Every pin must occur exactly once in its scope (`expectPinned`, `expectLines`, `expectClause`):
 *   zero means the sentence was deleted or reworded; two would mean deleting one copy leaves the pin
 *   green. Whitespace is normalised on both sides, so re-wrapping a paragraph cannot break a pin and
 *   rewording it does.
 * - Every pinned sentence begins where a sentence does and runs to its terminating full stop
 *   (`expectPinned` fails a snippet that does not end in one, or that starts inside a sentence), so a
 *   qualifier added in front ("Unless X, ...") or behind ("..., unless X.") or a clause inverted
 *   inside it turns the pin red; a snippet that stopped mid-sentence, or one that is the tail of a
 *   longer sentence, would stay green under all of those. A sentence begins at the start of the
 *   prose, at a paragraph, a list item, a numbered item, a table row or a table cell, just after a
 *   list marker, just after `. `, `! ` or `? ` (an abbreviation's `e.g. `, `i.e. `, `cf. ` and `vs. `
 *   do not end one), or just after a bold lead-in's `** `. What is not a sentence (a table's command
 *   cell and unwired tag, a code-fence line, a yaml row, a bullet lead-in that ends in a colon) is
 *   pinned as a WHOLE line (`expectLines`), never as a prefix of one. A clause two specs must word
 *   identically (`expectClause`) is deliberately not anchored: the sentence around it is pinned in
 *   each spec's own `it`, and the clause `it` guards only that the copies stay the same.
 * - Every `it` name contains `M16`, and the `describe` name carries `(specs/22 M16 P1)`, so
 *   `node scripts/run-tests.mjs run -t "M16"` (the exit test `specs/22` M16 names) selects the
 *   milestone's tests by name. The last `describe` of the block pins the helpers themselves: it
 *   builds small sections in the test and asserts with `expect(() => ...).toThrow()` that each rule
 *   above rejects what it should, because a helper that stops failing is a pin that guards nothing.
 *
 * Some pins are negative (`expectAbsent`), each for a wording a critic found to be false: the premise
 * paragraph of `specs/22` M16 must not regain its present-tense "there is no gate" or the false
 * "wired into the gates those three workflows reach"; its exit tests must not regain the
 * `pnpm test -- --grep` shorthand (the root `test` script is a coverage-gated chain, not a name filter;
 * the form that filters is `node scripts/run-tests.mjs run -t`); rule 8 must not regain "reached only
 * from" or "evaluated only when a workflow step names it" (`forge gate check <id>` names it by hand);
 * and the declaration must not regain "agent-unwritable" (claim enforcement is not run for a session
 * that commits its own work, so the oracle's integrity rests on the trust-anchor comparison instead).
 * Twelve more retire a wording a rewrite removed, because it was false or described a mechanism
 * the specs no longer have (`integrationTipAtStart`, "The oracle cannot move during a run",
 * "honest-session fence", "bare checkout", the anchor that was "the run's own, whatever `--trusted`
 * says", "That is all `granularity: "file"` means", a declaration refused "because it declares no
 * case", a cleaning that "can never delete a project file", the marking advice that `-text` alone
 * keeps a checkout from converting bytes and the "line endings" lead it came with, a `--trusted`
 * that is only "a ref that does not resolve", and a `setup` that builds "or fetches"). Each is
 * checked in the section where it lived and over the whole of specs 03, 10, 13 and 18, in the
 * unstripped text.
 *
 * @see specs/03 §3.2.5
 * @see specs/10 §10.3
 * @see specs/13 F-TEST-2, F-TEST-9, F-TEST-10
 * @see specs/17 §17.2, §17.4
 * @see specs/18 §18.2, §18.4, §18.7, §18.8
 * @see specs/22 M16
 * @see PLAN-M16.md P1
 * @see SPEC-QUESTIONS.md Q294
 */

/** Collapse every run of a space, a tab, a CR or an LF to one space, so a pin on a hard-wrapped sentence
 * survives a re-wrap but not a reword. Folds only those four ASCII characters: an NBSP, a BOM, an
 * ideographic or em/thin space, or any other Unicode space character inside a pinned sentence is left
 * exactly as it is, so a spec that substitutes one in for an ordinary space turns the pin red instead of
 * reading as whitespace. */
function normalise(text: string): string {
  return text.replace(/[ \t\r\n]+/g, ' ');
}

/** Planted in a raw line, before it is normalised, where a block of the document begins. */
const BLOCK_MARK = '\uE000';

interface Section {
  /** The section's raw lines, heading first. */
  readonly lines: readonly string[];
  /** The same lines with HTML comments removed and code fences kept: what `expectLines` reads. */
  readonly visibleLines: readonly string[];
  /** The section as a reader of the rendered spec sees its prose: whitespace-normalised, with HTML
   * comments and fenced code (fence lines included) removed. Every presence check reads this, so a
   * sentence that survives only in a comment or a code block is not present. */
  readonly text: string;
  /** The section whitespace-normalised and with nothing removed: `expectAbsent` reads this, so a
   * sentence a spec deleted from its prose cannot hide in a comment or a fence and read as gone. */
  readonly rawText: string;
  /** The offsets in `text` where a paragraph, a list item, a numbered item, a table row or a table
   * cell begins, planted on the raw lines before they were normalised. */
  readonly blockStarts: ReadonlySet<number>;
  /** The section's top-level blocks, in document order: a paragraph, a heading, one list item (at any
   * nesting depth) or one table row (a separator row is folded into the header row's block, never a
   * block of its own), each holding its own content from just after its marker (a list marker, or
   * nothing for a paragraph, a heading or a row) to just before the next block's marker. `expectBlock`
   * and `expectBlockOrder` read this; `expectPinned` and `beginsASentence` do not. */
  readonly blocks: readonly Block[];
}

interface Block {
  /** Where this block's own content (after its marker, if it has one) begins in `text`. */
  readonly offset: number;
  /** The block's content, normalised, running to just before the next block's marker. */
  readonly text: string;
}

interface Scan {
  /** Each line with its HTML comments removed; `undefined` for a code fence or a line inside one. */
  readonly prose: readonly (string | undefined)[];
  /** Each line with its HTML comments removed; fence lines and fenced lines are kept. */
  readonly visible: readonly string[];
}

/** One pass over the lines that tracks fenced code (a backtick fence or a tilde fence — CommonMark
 * allows either, and a fence only closes against its own character, so a tilde line inside a backtick
 * fence, or vice versa, is code, not a close), bare indented code (four spaces or a tab, opened only
 * right after a blank line or the document start, exactly CommonMark's own "cannot interrupt a
 * paragraph" rule, simplified to not also track list-item indentation), and a hidden `<div>...</div>`
 * wrapper (nestable, tracked by depth, read the same way a comment is: content inside is commentary,
 * not prose). Any one of the four may span lines. Inside a fence or an indented-code line, a `<!--` or
 * a `<div>` is code; inside a comment or a div, a fence or an indented line is commentary; whichever of
 * `<!--`/`<div` opens first on a line wins, the same rule a fence and a comment already used only
 * between the two of them. */
function scanLines(lines: readonly string[]): Scan {
  const prose: (string | undefined)[] = [];
  const visible: string[] = [];
  let inFence = false;
  let fenceChar = '';
  let inComment = false;
  let divDepth = 0;
  let inIndentedCode = false;
  let previousKept = '';
  for (const raw of lines) {
    if (inFence) {
      prose.push(undefined);
      visible.push(raw);
      const closesFence = fenceChar === '`' ? /^\s*`{3,}\s*$/.test(raw) : /^\s*~{3,}\s*$/.test(raw);
      inFence = !closesFence;
      continue;
    }
    const blank = raw.trim() === '';
    const indented = /^(?: {4,}|\t)\S/.test(raw);
    if (blank) {
      inIndentedCode = false;
    } else if (inIndentedCode) {
      if (!indented) inIndentedCode = false;
    } else if (indented && previousKept === '' && !inComment && divDepth === 0) {
      inIndentedCode = true;
    }
    if (inIndentedCode) {
      prose.push(undefined);
      visible.push(raw);
      previousKept = raw;
      continue;
    }
    let line = '';
    let at = 0;
    while (at < raw.length) {
      if (inComment) {
        const close = raw.indexOf('-->', at);
        if (close === -1) break;
        at = close + 3;
        inComment = false;
      } else if (divDepth > 0) {
        const openIdx = raw.indexOf('<div', at);
        const closeIdx = raw.indexOf('</div>', at);
        if (closeIdx !== -1 && (openIdx === -1 || closeIdx <= openIdx)) {
          at = closeIdx + '</div>'.length;
          divDepth -= 1;
        } else if (openIdx !== -1) {
          const tagEnd = raw.indexOf('>', openIdx);
          at = tagEnd === -1 ? raw.length : tagEnd + 1;
          divDepth += 1;
        } else {
          break;
        }
      } else {
        const commentAt = raw.indexOf('<!--', at);
        const divAt = raw.indexOf('<div', at);
        const candidates = [commentAt, divAt].filter((index) => index !== -1);
        if (candidates.length === 0) {
          line += raw.slice(at);
          break;
        }
        const next = Math.min(...candidates);
        line += raw.slice(at, next);
        if (next === commentAt) {
          at = next + 4;
          inComment = true;
        } else {
          const tagEnd = raw.indexOf('>', next);
          at = tagEnd === -1 ? raw.length : tagEnd + 1;
          divDepth = 1;
        }
      }
    }
    visible.push(line);
    const backtickFence = /^\s*`{3,}[^`]*$/.test(line);
    const tildeFence = !backtickFence && /^\s*~{3,}.*$/.test(line);
    if (backtickFence || tildeFence) {
      inFence = true;
      fenceChar = backtickFence ? '`' : '~';
      prose.push(undefined);
    } else {
      prose.push(line);
    }
    previousKept = line;
  }
  return { prose, visible };
}

/** The offsets within `line` where a block begins: the heading, the list or numbered marker and the
 * item's text after it, the table row and each table cell, and a paragraph's first line. */
function blockOffsets(line: string, startsParagraph: boolean): number[] {
  const lead = line.length - line.trimStart().length;
  const trimmed = line.trimStart();
  if (trimmed.startsWith('|')) {
    const offsets = [lead];
    let inCode = false;
    for (let at = lead; at < line.length; at += 1) {
      const char = line[at];
      if (char === '`') inCode = !inCode;
      if (char !== '|' || inCode || line[at - 1] === '\\') continue;
      let cell = at + 1;
      while (line[cell] === ' ') cell += 1;
      if (cell < line.length) offsets.push(cell);
    }
    return offsets;
  }
  const marker = /^\s*(?:[-*+]|\d+[.)])\s+/.exec(line)?.[0];
  if (marker !== undefined) return [lead, marker.length];
  return startsParagraph || /^#{1,6}\s/.test(trimmed) ? [lead] : [];
}

/** The lines the scan kept, each with a `BLOCK_MARK` planted at every offset `offsetsOf` returns for it
 * (a line the scan removed, and a blank line, contribute none and end the paragraph before them). Used
 * both for the fine, sentence-boundary marks (`blockOffsets`) and for the coarse, top-level-block marks
 * (`topBlockOpen`/`topBlockContent` below): a mark sits exactly at a whitespace-run boundary in every
 * caller here, so inserting one never changes how the surrounding whitespace collapses, and independent
 * passes with different `offsetsOf` functions all produce the identical normalised text. */
function markAt(
  prose: readonly (string | undefined)[],
  offsetsOf: (line: string, startsParagraph: boolean) => readonly number[],
): string[] {
  return prose.map((line, index) => {
    if (line === undefined || line.trim() === '') return '';
    const before = prose[index - 1]?.trim() ?? '';
    const startsParagraph = before === '' || /^#{1,6}\s/.test(before);
    return [...offsetsOf(line, startsParagraph)]
      .sort((a, b) => b - a)
      .reduce(
        (marked, offset) => marked.slice(0, offset) + BLOCK_MARK + marked.slice(offset),
        line,
      );
  });
}

/** `markAt`, then normalised and split back apart on `BLOCK_MARK` to the text and the offsets the marks
 * landed at (sorted). */
function splitMarks(
  prose: readonly (string | undefined)[],
  offsetsOf: (line: string, startsParagraph: boolean) => readonly number[],
): { text: string; starts: number[] } {
  const parts = normalise(markAt(prose, offsetsOf).join('\n')).split(BLOCK_MARK);
  const starts: number[] = [];
  let text = '';
  parts.forEach((part, index) => {
    if (index > 0) starts.push(text.length);
    text += part;
  });
  return { text, starts };
}

/** Whether `trimmed` (already left-trimmed) is a table's separator row (only `-`, `:`, `|` and
 * whitespace): folded into the header row's block, never a block of its own. */
function isTableSeparatorRow(trimmed: string): boolean {
  return trimmed.startsWith('|') && /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/.test(trimmed);
}

/** Whether `line` opens a new top-level block: a paragraph's first line, a heading, a list item's
 * marker line (at any nesting depth) or a table row other than a separator row. A wrapped continuation
 * line of a paragraph or of a list item does not, and neither does a blank or a removed line (handled
 * by `markAt` itself, which contributes no offset for those). */
function startsATopBlock(line: string, startsParagraph: boolean): boolean {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('|')) return !isTableSeparatorRow(trimmed);
  if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) return true;
  if (/^#{1,6}\s/.test(trimmed)) return true;
  return startsParagraph;
}

/** The offset in `line` where a top-level block's own content begins, for the one `line` that opens it:
 * right after a list marker, otherwise (a paragraph, a heading or a table row) its lead. */
function topBlockOpen(line: string): number {
  return line.length - line.trimStart().length;
}
function topBlockContent(line: string): number {
  const marker = /^\s*(?:[-*+]|\d+[.)])\s+/.exec(line)?.[0];
  return marker !== undefined ? marker.length : topBlockOpen(line);
}

/** The section's top-level blocks (see `Block`), built from two independent `splitMarks` passes over
 * the same `prose` (one marking each top-level block's own lead, the other its content start): both
 * land on the identical normalised `text`, so pairing their sorted offsets by index (both passes mark
 * exactly the same lines, once each, in document order) gives each block's extracted span without a
 * second, separately-normalised copy of the text drifting out of sync with the first. */
function topBlocks(prose: readonly (string | undefined)[], text: string): Block[] {
  const opens = splitMarks(prose, (line, sp) =>
    startsATopBlock(line, sp) ? [topBlockOpen(line)] : [],
  );
  const contents = splitMarks(prose, (line, sp) =>
    startsATopBlock(line, sp) ? [topBlockContent(line)] : [],
  );
  const openStarts = [...opens.starts].sort((a, b) => a - b);
  const contentStarts = [...contents.starts].sort((a, b) => a - b);
  return contentStarts.map((offset, index) => ({
    offset,
    // The one space the inter-line gap always normalises to lands just before the next block's open
    // (or, for the last block, any trailing whitespace of the section itself): trimmed off here, once,
    // rather than leaving every caller of `blocks` to do it.
    text: text.slice(offset, openStarts[index + 1] ?? text.length).trim(),
  }));
}

/** Builds a `Section` from raw lines: the stripping and the block offsets every presence check uses.
 * `headingSection`, `fileSection` and the helpers' own tests (`sectionOf`) all come through here. */
function sectionFromLines(lines: readonly string[]): Section {
  const { prose, visible } = scanLines(lines);
  const { text, starts } = splitMarks(prose, blockOffsets);
  const blockStarts = new Set(starts);
  const blocks = topBlocks(prose, text);
  return {
    lines,
    visibleLines: visible,
    text,
    rawText: normalise(lines.join('\n')),
    blockStarts,
    blocks,
  };
}

/** A whole spec file as one section, for a check that is not tied to the section a sentence lived in. */
function fileSection(specText: string): Section {
  return sectionFromLines(specText.split('\n'));
}

/** The heading line that starts with `prefix`, plus its body, up to the next heading of the same or a
 * higher level. Unlike `section` above it skips `#` lines inside code fences and HTML comments (the
 * registry yaml in `18` §18.7 carries a `# canonical:` comment line) and requires exactly one heading
 * to match, so a renamed or duplicated section fails loudly instead of slicing the wrong text. */
function headingSection(specText: string, prefix: string): Section {
  const lines = specText.split('\n');
  const { prose } = scanLines(lines);
  const headings: { index: number; level: number; line: string }[] = [];
  prose.forEach((line, index) => {
    const level = /^(#{1,6}) /.exec(line ?? '')?.[1]?.length;
    if (line !== undefined && level !== undefined) headings.push({ index, level, line });
  });
  const starts = headings.filter((heading) => heading.line.startsWith(prefix));
  const start = starts[0];
  if (starts.length !== 1 || start === undefined) {
    throw new Error(
      `expected exactly one heading starting ${JSON.stringify(prefix)}, found ${String(starts.length)}`,
    );
  }
  const end = headings.find(
    (heading) => heading.index > start.index && heading.level <= start.level,
  );
  return sectionFromLines(lines.slice(start.index, end?.index));
}

/** Whether `offset` in the section's prose is where a sentence or a block begins: the very start, the
 * start of a paragraph, list item, numbered item, table row or table cell, just after a list marker,
 * just after a sentence's `. `, `! ` or `? ` (not an abbreviation's) or just after a bold lead-in's
 * `** `. A needle that starts anywhere else is the tail of a longer sentence. */
function beginsASentence(scope: Section, offset: number): boolean {
  if (offset === 0 || scope.blockStarts.has(offset)) return true;
  const before = scope.text.slice(0, offset);
  if (before.endsWith('** ')) return true;
  return /[.!?] $/.test(before) && !/(?:^|[^A-Za-z])(?:e\.g|i\.e|cf|vs)\. $/i.test(before);
}

/** Each sentence occurs exactly once in the section's prose, begins where a sentence or a block does
 * and runs to its terminating full stop. This guarantees a qualifier *inside* the sentence's own full
 * stops turns the pin red (the needle no longer occurs verbatim), and that the needle cannot start
 * mid-sentence; it guarantees nothing about what comes before or after the sentence in its block —
 * a sentence inserted next to it, a relocation into an adjacent block, or a swap with its neighbour,
 * all leave this check green. Closing that gap, where the sentence sits in a block that carries a rule,
 * a number, a path, a default, a refusal, a precedence or a boundary, is `expectBlock`'s job, and
 * closing it for the shape of a whole section is `expectBlockOrder`'s. */
function expectPinned(scope: Section, sentences: readonly string[]): void {
  for (const sentence of sentences) {
    const needle = normalise(sentence);
    expect(
      needle.endsWith('.'),
      `a pinned sentence must run to its full stop: ${JSON.stringify(needle)}`,
    ).toBe(true);
    const occurrences = scope.text.split(needle).length - 1;
    expect(occurrences, `expected exactly one occurrence of ${JSON.stringify(needle)}`).toBe(1);
    const offset = scope.text.indexOf(needle);
    expect(
      beginsASentence(scope, offset),
      `a pinned sentence must begin where a sentence does, not inside one: ${JSON.stringify(needle)} follows ${JSON.stringify(scope.text.slice(Math.max(0, offset - 40), offset))}`,
    ).toBe(true);
  }
}

/** Splits `text` at every offset that is a sentence start by the same rule `beginsASentence` applies
 * within a block (a bold lead-in's `** `, or a `. `, `! ` or `? ` that is not an abbreviation's): used
 * only within one block's own text, which has no further sub-block starts of its own. */
function splitSentences(text: string): string[] {
  const bounds = [0];
  const re = /(\*\* |[.!?] )/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length;
    if (m[0] === '** ') {
      bounds.push(end);
      continue;
    }
    const before = text.slice(0, end);
    if (!/(?:^|[^A-Za-z])(?:e\.g|i\.e|cf|vs)\. $/i.test(before)) bounds.push(end);
  }
  const starts = [...new Set(bounds)].sort((a, b) => a - b);
  return starts
    .map((start, index) => text.slice(start, starts[index + 1] ?? text.length).trim())
    .filter((piece) => piece.length > 0);
}

/** The block that opens with `sentences[0]` holds exactly `sentences`, in order, split by the same rule
 * `beginsASentence` uses, with nothing before, between or after them: a last fragment that ends in `:`,
 * in a closing code span (a trailing backtick) or in a table row's own closing `|` is allowed, for a
 * rule that trails into a list or a fenced example, or a sentence that is the last cell content of a
 * table row (`splitSentences` reports the row's trailing `|` as its own final, markerless fragment,
 * since nothing in its own split delimiters ever consumes it). Every non-final sentence must itself run
 * to a full stop. Closes the block around a pinned sentence, so a sentence inserted next to it, a
 * relocation into the block, or a swap with an adjacent sentence or block, all turn this red — unlike
 * `expectPinned`, which only pins the sentence itself. Reads nothing but `scope` and the literal
 * `sentences` given here: deleting or re-pinning any other `it` never affects this one. */
function expectBlock(scope: Section, sentences: readonly string[]): void {
  expect(sentences.length > 0, 'expectBlock needs at least one sentence').toBe(true);
  const wanted = sentences.map((sentence) => normalise(sentence));
  for (const sentence of wanted.slice(0, -1)) {
    expect(
      /\*\*$|[.!?]$/.test(sentence),
      `a non-final expectBlock sentence must run to its own full stop or bold lead-in: ${JSON.stringify(sentence)}`,
    ).toBe(true);
  }
  const last = wanted[wanted.length - 1]!;
  expect(
    /\*\*$|[.!?]$/.test(last) || last.endsWith(':') || last.endsWith('`') || last === '|',
    `expectBlock's last sentence must end in a full stop, a bold lead-in, a colon, a code span or a table row's closing pipe: ${JSON.stringify(last)}`,
  ).toBe(true);
  const firstNeedle = wanted[0]!;
  const matches = scope.blocks.filter((block) => block.text.startsWith(firstNeedle));
  expect(
    matches.length,
    `expected exactly one block opening with ${JSON.stringify(firstNeedle)}, found ${String(matches.length)}`,
  ).toBe(1);
  const block = matches[0]!;
  expect(
    beginsASentence(scope, block.offset),
    `a block must open at a sentence start: ${JSON.stringify(firstNeedle)}`,
  ).toBe(true);
  const pieces = splitSentences(block.text);
  expect(
    pieces,
    `expected the block opening with ${JSON.stringify(firstNeedle)} to hold exactly these sentences, ` +
      `in order, with nothing before, between or after them`,
  ).toEqual(wanted);
}

/** The section's top-level blocks, in order, are exactly the ones listed, each identified by the first
 * `width` characters of its own (normalised) content: an inserted, removed, swapped or relocated bullet,
 * paragraph or row is red, because it shifts every later opening out of position. Use for a section M16
 * wrote in full; `expectBlock` closes one block at a time, this closes a whole section's shape. */
function expectBlockOrder(scope: Section, openings: readonly string[], width = 60): void {
  const got = scope.blocks.map((block) => normalise(block.text).slice(0, width));
  const want = openings.map((opening) => normalise(opening).slice(0, width));
  expect(got, "expected the section's blocks, in order, to open with the listed text").toEqual(
    want,
  );
}

/** Each item is exactly one whole line of the section (a table row, a code-fence line, a yaml row, a
 * bullet lead-in): its leading whitespace must match exactly (so re-indenting a line turns the pin red),
 * and the rest of the line is compared whitespace-normalised and trimmed. An HTML comment is not part of
 * a line; a code fence is. The items must occur in the listed order, each exactly once, so an inserted,
 * removed, swapped or reordered line among them is red too. */
function expectLines(scope: Section, items: readonly string[]): void {
  let searchFrom = 0;
  for (const item of items) {
    const wantedLead = /^[ \t]*/.exec(item)?.[0] ?? '';
    const wantedRest = normalise(item.slice(wantedLead.length)).trim();
    const matches: number[] = [];
    scope.visibleLines.forEach((line, index) => {
      const lead = /^[ \t]*/.exec(line)?.[0] ?? '';
      const rest = normalise(line.slice(lead.length)).trim();
      if (lead === wantedLead && rest === wantedRest) matches.push(index);
    });
    expect(matches.length, `expected exactly one whole line equal to ${JSON.stringify(item)}`).toBe(
      1,
    );
    const at = matches[0]!;
    expect(
      at >= searchFrom,
      `expected ${JSON.stringify(item)} to occur in the listed order (it comes before an earlier item)`,
    ).toBe(true);
    searchFrom = at + 1;
  }
}

/** A clause two sections must word identically; the sentence around it is pinned in each section's
 * own `it`, so this one only guards that the two copies stay the same. It is not anchored to a
 * sentence start, and it reads the section's prose like every presence check. */
function expectClause(scope: Section, clauses: readonly string[]): void {
  for (const clause of clauses) {
    const needle = normalise(clause);
    const occurrences = scope.text.split(needle).length - 1;
    expect(occurrences, `expected exactly one occurrence of ${JSON.stringify(needle)}`).toBe(1);
  }
}

/** Reads the section as it is, comments and code fences included: a sentence a spec deleted from its
 * prose must not be able to survive in a comment or a fence and read as gone. */
function expectAbsent(scope: Section, snippets: readonly string[]): void {
  for (const snippet of snippets) {
    expect(scope.rawText, `expected no occurrence of ${JSON.stringify(snippet)}`).not.toContain(
      normalise(snippet),
    );
  }
}

/** Lower-cases both sides and replaces every `-` with a space, so a retired wording's re-insertion
 * cased or hyphenated differently ("Honest-Session fence", "honest session fence") is still caught. */
function fold(text: string): string {
  return normalise(text).toLowerCase().replace(/-/g, ' ').replace(/ +/g, ' ');
}

/** `expectAbsent`, case- and hyphen-folded: for a retired wording, where a spec that brings the words
 * back with different casing or a dropped/added hyphen is still the same retired claim returning. */
function expectAbsentFolded(scope: Section, snippets: readonly string[]): void {
  for (const snippet of snippets) {
    expect(
      fold(scope.rawText),
      `expected no folded occurrence of ${JSON.stringify(snippet)}`,
    ).not.toContain(fold(snippet));
  }
}

describe('pinned sentences (specs/22 M16 P1) (SPEC-QUESTIONS.md Q294, PLAN-M16.md P1) — delete an `it` individually once a later piece legitimately rewords its sentence again', () => {
  const spec03 = () => headingSection(readSpec('03-cli-and-installer.md'), '### 3.2.5 ');
  const spec10Gates = () =>
    headingSection(readSpec('10-workflow-engine-and-lifecycle.md'), '## 10.3 ');
  const spec10GateCatalogue = () =>
    headingSection(readSpec('10-workflow-engine-and-lifecycle.md'), '### Gate catalogue');
  const spec13 = (prefix: string) =>
    headingSection(readSpec('13-frameworks-testing-and-debugging.md'), prefix);
  const spec17 = (prefix: string) => headingSection(readSpec('17-brownfield-ingestion.md'), prefix);
  const spec18 = (prefix: string) =>
    headingSection(readSpec('18-persistence-config-and-schemas.md'), prefix);
  const spec20 = (prefix: string) =>
    headingSection(readSpec('20-security-safety-and-cost.md'), prefix);
  const spec22M16 = () => headingSection(readSpec('22-build-plan-and-milestones.md'), '## M16 — ');
  const parity = () => spec13('### F-TEST-9 · ');
  const hunks = () => spec13('### F-TEST-10 · ');
  const wholeFile = (fileName: string) => fileSection(readSpec(fileName));

  it('M16 specs/22: the premise paragraph is corrected — it presumed a gate the three workflows already reached', () => {
    const section = spec22M16();
    expectPinned(section, [
      '**The premise, corrected.** The paragraph above speaks of refusing "the gate" on divergence, and presumes a gate those three workflows already reach.',
      'None did.',
    ]);
    expectAbsent(section, ['wired into the gates those three workflows reach']);
  });

  it('M16 specs/22: as M15 shipped them, refactor, migrate and adopt contained no `kind: gate` step, and that is stated in the past tense', () => {
    const section = spec22M16();
    expectPinned(section, [
      'As M15 shipped them, `refactor`, `migrate` and `adopt` contained no `kind: gate` step, so there was no gate for a parity check to be wired into.',
    ]);
    expectAbsent(section, ['contain no `kind: gate` step, so there is no gate']);
  });

  it('M16 specs/22: refactor as M15 shipped it was state-invariants, refactor-code, verify-invariants (a plain command step), commit', () => {
    const section = spec22M16();
    expectPinned(section, [
      '`refactor` was `state-invariants` → `refactor-code` → `verify-invariants` (a plain `forge test run --json` command step) → `commit`.',
    ]);
    expectAbsent(section, ['`refactor` is `state-invariants`']);
  });

  it('M16 specs/22: migrate as M15 shipped it ended in the same plain command, and its `forge migrate run` step was not wired', () => {
    const section = spec22M16();
    expectPinned(section, [
      '`migrate` ended in the same plain command (its `verify-migration` step), and its `migrate-data` step ran `forge migrate run`, which was not wired (`test/command-steps.test.ts` pins it as a known gap; Q213, Q202).',
    ]);
    expectAbsent(section, ['its `migrate-data` step runs `forge migrate run`']);
  });

  it('M16 specs/22: adopt as M15 shipped it was an inventory command plus two agent steps, and its one gate G-Adopt had no gate file', () => {
    const section = spec22M16();
    expectPinned(section, [
      '`adopt` was an inventory command (`forge adopt inventory --json`, also pinned there as unwired; Q213) plus two agent steps, and its one gate, `G-Adopt`, was evaluated in-process with no gate file.',
    ]);
    expectAbsent(section, ['its one gate, `G-Adopt`, is evaluated in-process']);
  });

  it('M16 specs/22: M16 creates the workflow-scoped gate G-Parity, with one `behavior:parity` check, reached through explicit `kind: gate` steps', () => {
    const section = spec22M16();
    expectPinned(section, [
      'M16 therefore creates the gate it was meant to feed: the **workflow-scoped gate `G-Parity`**, with one `behavior:parity` check, reached through explicit `kind: gate` steps (`10` §10.3 rule 8).',
    ]);
  });

  it('M16 specs/22: the wiring requirement — refactor fails before any agent step and again at verify-parity, migrate gets the same gate, adopt gets none', () => {
    const section = spec22M16();
    expectPinned(section, [
      'The wiring is this: `refactor` must fail before any agent step runs when no declaration compares at least one surface, and again at a `verify-parity` gate between `verify-invariants` and `commit` (whether the first check is a leading `kind: gate` step or an entry preflight is the choice of `specs/22` M16 P9); `migrate` gets the same verification gate, unreachable until `forge migrate run` is wired; `adopt` gets no gate step, only the documented use of `BASELINE` (`17` §17.2).',
    ]);
  });

  it('M16 specs/22: the premise paragraph points at the plan', () => {
    const section = spec22M16();
    expectPinned(section, ['See `process/plans/PLAN-M16.md`.']);
  });

  it('M16 specs/22: the Build paragraph names the harness, the two commands, G-Parity, the registered ParityEvidence type, per-hunk mutation and the retention policy', () => {
    const section = spec22M16();
    expectPinned(section, [
      "**Build:** a behaviour-parity harness over observable surfaces FORGE can capture without owning the app (process stdout/exit codes, HTTP request/response pairs, library call/return, file outputs); `forge parity capture` and `forge parity check --json`; the workflow-scoped gate `G-Parity`, whose one `behavior:parity` deterministic check is reached through explicit `kind: gate` steps in the workflows that have a reference; parity evidence as a registered `ParityEvidence` artifact type plus the additive optional `EvidenceBundle.parityEvidence` id list; per-hunk mutation raising M15's binding evidence from change-level to hunk-level attribution; an evidence retention policy, deferred from M15 P7.",
    ]);
  });

  it('M16 specs/22: the Do-not-build list stands — no visual parity, and no parity claim for greenfield work', () => {
    const section = spec22M16();
    expectPinned(section, [
      "**Do not build:** visual/screenshot parity — FORGE is not UI-framework-specific and a pixel oracle needs a rendering target it does not own; a parity claim for greenfield work, which has no reference by definition and must keep relying on M15's binding oracle.",
    ]);
  });

  it('M16 specs/22: every M16 test\'s describe name carries `(specs/22 M16 P<n>)`, which the `-t "M16"` runner form selects on', () => {
    const section = spec22M16();
    expectPinned(section, [
      'Every M16 test\'s `describe` name carries `(specs/22 M16 P<n>)`, which is what `-t "M16"` selects on.',
    ]);
    expectLines(section, ['node scripts/run-tests.mjs run -t "M16"']);
    expectAbsent(section, ['pnpm test -- --grep']);
  });

  it('M16 specs/22: a green `-t "M16"` run is not evidence by itself — every piece that adds tests has a test carrying its own piece marker', () => {
    const section = spec22M16();
    expectPinned(section, [
      'That filter exits 0 when it selects nothing, so a green `-t "M16"` run is not by itself evidence that anything ran: the exit gate also requires that every piece that adds tests has at least one test carrying its own `(specs/22 M16 P<n>)` marker.',
    ]);
  });

  it('M16 specs/22: the parity exit tests run one fixture refactor twice — a behaviour-preserving change exits 0, a behaviour-changing one exits non-zero', () => {
    const section = spec22M16();
    expectPinned(section, [
      'The `forge parity check --json` exit tests run over one fixture refactor twice, once with a behaviour-preserving change (exit 0) and once with a behaviour-changing one (non-zero), so a check that never refuses and a check that always refuses each fail the gate.',
    ]);
    expectLines(section, [
      'forge parity check --json # fixture refactor, behaviour-preserving change: exits 0',
      'forge parity check --json # same fixture refactor, behaviour-changing change: exits non-zero',
    ]);
    expectAbsent(section, [
      'against a fixture refactor with a deliberate behaviour change: refused',
    ]);
  });

  it('M16 specs/10 §10.3 rule 6: the FORGE session marker is the run, step and — where one exists — agent id every engine-spawned session and run-spawned shell command carries, as the environment variables `FORGE_RUN_ID`, `FORGE_STEP_ID` and `FORGE_AGENT_ID` — an honest-session signal, not a security boundary', () => {
    const section = spec10Gates();
    expectClause(section, [
      'Under the FORGE session marker (the run, step and — where one exists — agent id every engine-spawned session and run-spawned shell command carries, as the environment variables `FORGE_RUN_ID`, `FORGE_STEP_ID` and `FORGE_AGENT_ID`; an honest-session signal, not a security boundary)',
    ]);
  });

  it("M16 specs/10 §10.3 rule 8: a workflow-scoped gate is a gate file with no lifecycle `phase`, scheduled only by a workflow's `kind: gate` step", () => {
    const section = spec10Gates();
    expectPinned(section, [
      "8. (Post-v1.0, `specs/22` M16.) A gate may be **workflow-scoped**: a gate file with no lifecycle `phase`, scheduled only by a workflow's `kind: gate` step (§10.1, Step kinds).",
    ]);
    expectAbsent(section, ['reached only from', 'evaluated only when a workflow step names it']);
  });

  it('M16 specs/10 §10.3 rule 8: `phase` is optional in a gate document, and a phase-less file still fails on an unknown key or no deterministic check', () => {
    const section = spec10Gates();
    expectPinned(section, [
      "`phase` is optional in a gate document, so a phase-less gate file loads under rule 6's own strictness: an unknown key, or no deterministic check, is still a load error.",
    ]);
  });

  it('M16 specs/10 §10.3 rule 8: a workflow-scoped gate belongs to no lifecycle phase — no transition and no enumerate-every-gate path evaluates it', () => {
    const section = spec10Gates();
    expectPinned(section, [
      'A workflow-scoped gate belongs to no lifecycle phase: no phase transition evaluates it, and no path that enumerates every gate evaluates it.',
    ]);
    expectAbsent(section, ['never enumerated as a lifecycle phase gate']);
  });

  it('M16 specs/10 §10.3 rule 8: it is still a gate a person can name — check, approve and waive resolve it by id, and reject records against the id it is given', () => {
    const section = spec10Gates();
    expectPinned(section, [
      'It is still a gate, and a person can still name it: `forge gate check`, `approve` and `waive` resolve it by id like any other, and `forge gate reject` records against the id it is given.',
    ]);
  });

  it('M16 specs/10 §10.3 rule 8: a workflow-scoped gate is not one of the ten lifecycle gates of the catalogue', () => {
    const section = spec10Gates();
    expectPinned(section, [
      'It is not one of the ten lifecycle gates of the catalogue below, which this rule does not extend.',
    ]);
  });

  it('M16 specs/10 §10.3 rule 8: G-Adopt is a different kind of exception, and G-Parity is the first workflow-scoped gate to have a file', () => {
    const section = spec10Gates();
    expectPinned(section, [
      '`G-Adopt` (`17` §17.2) is a different kind of exception, a gate outside the lifecycle that is evaluated in-process with no gate file and that no `kind: gate` step reaches; `G-Parity` (`13` F-TEST-9) is the first workflow-scoped gate to have a file.',
    ]);
  });

  it("M16 specs/10 §10.3 rule 8: the `G-Parity` gate's one check, `behavior:parity`, is `forge parity check --json --no-record --trusted refs/heads/main` — the trust anchor is an explicit argument, trunk, and `--no-record` writes no `ParityEvidence`, because a file a gate check writes in the integration worktree leaves it dirty and the next run refuses to start (`VCS-INTEGRATION-DIRTY`)", () => {
    const section = spec10Gates();
    expectPinned(section, [
      'Its one check, `behavior:parity`, is `forge parity check --json --no-record --trusted refs/heads/main`: the trust anchor is an explicit argument, trunk, and `--no-record` writes no `ParityEvidence`, because a gate check runs in the integration worktree and a file it writes there leaves the worktree dirty, so that the next run refuses to start (`VCS-INTEGRATION-DIRTY`).',
    ]);
  });

  it('M16 specs/10 §10.3 rule 8: run by hand, `forge gate check G-Parity` runs the same command, so it compares with trunk too', () => {
    const section = spec10Gates();
    expectPinned(section, [
      'Run by hand, `forge gate check G-Parity` runs the same command, so it compares with trunk too.',
    ]);
  });

  it("M16 specs/10 §10.3: a check against a reference oracle holds the check contract's line for its own inputs", () => {
    const section = spec10Gates();
    expectPinned(section, [
      '(Post-v1.0, `specs/22` M16.) A check against a reference oracle (`13` F-TEST-9) holds the same line for its own inputs.',
    ]);
  });

  it('M16 specs/10 §10.3: no-declarations, a missing capture, an expired review or unobservable entry, oracle-changed and nothing-compared each fail with a stated reason, never as a pass', () => {
    const section = spec10Gates();
    expectPinned(section, [
      "A check with no declaration at all (`no-declarations`), a declaration with no capture of its reference, an expired review or `unobservable` entry (a declaration's `expires` date, or an entry's expiry, has been reached), an oracle that changed since its trust anchor (`oracle-changed`), and a declaration that compares nothing, because it has no surface that is not exempt as `unobservable` (`nothing-compared`), each fail with a stated `reason`: an absent reference is not parity, and an empty comparison is not a match.",
    ]);
  });

  it('M16 specs/10 §10.3: a check that would print no passing and no failing case is refused (`ok: false`) instead, so `failOn: "failing > 0"` can never read nothing as success', () => {
    const section = spec10Gates();
    expectPinned(section, [
      'A check that would print no passing and no failing case is refused (`ok: false`) instead, so `failOn: "failing > 0"` can never read nothing as success.',
    ]);
  });

  it('M16 specs/13 F-TEST-2: oracles 5 and 6 compare against a reference', () => {
    const section = spec13('### F-TEST-2 · ');
    expectPinned(section, ['Oracles 5 and 6 compare against a reference.']);
  });

  it('M16 specs/13 F-TEST-2: F-TEST-9 is the normative definition of such a comparison where a reference exists', () => {
    const section = spec13('### F-TEST-2 · ');
    expectPinned(section, [
      'F-TEST-9 (post-v1.0, `specs/22` M16) is their normative definition where a reference exists: what a differential or reference-implementation comparison must rest on.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: oracles 5 and 6 compare against a reference, and until M16 said nothing about what the comparison must rest on', () => {
    const section = parity();
    expectPinned(section, [
      "F-TEST-2's oracles 5 and 6 compare against a reference — the implementation before a change, or an implementation the project already trusts and holds at a git ref — and until now said nothing about what such a comparison must rest on.",
    ]);
  });

  it('M16 specs/13 F-TEST-9: a "reference" recorded from the code under test is that code agreeing with itself', () => {
    const section = parity();
    expectPinned(section, [
      'The danger is the one F-TEST-2 already bans: a "reference" recorded from the code under test is that code agreeing with itself.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: a parity oracle is a reviewed declaration plus an immutable capture, never a recording of whatever the candidate does', () => {
    const section = parity();
    expectPinned(section, [
      "A **parity oracle** is therefore a *reviewed declaration* plus an *immutable capture* of the reference's behaviour, never a recording of whatever the candidate does.",
    ]);
  });

  it("M16 specs/13 F-TEST-9: parity applies only where a reference exists — a refactor has one, adopt's is the system as found, greenfield has none", () => {
    const section = parity();
    expectPinned(section, [
      "Parity applies only where a reference exists: a `refactor` always has one (the code before the change), `adopt`'s is the system as found (`17` §17.4 item 3), and greenfield work has none, so it must not claim parity and keeps relying on behavioural binding (F-TEST-5).",
    ]);
  });

  it('M16 specs/13 F-TEST-9: the declaration is `.forge/parity/<name>.parity.yaml`, one file per declaration, its name the file stem', () => {
    const section = parity();
    expectPinned(section, [
      '**The declaration** is `.forge/parity/<name>.parity.yaml`, one file per declaration, its `name` the file stem.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: the declaration names the reference (`reference.ref`) and the surfaces to compare', () => {
    const section = parity();
    expectPinned(section, [
      'It names the reference (`reference.ref`) and the surfaces to compare.',
    ]);
  });

  it("M16 specs/13 F-TEST-9: `reference.ref` is a full commit sha or a tag name resolved to the commit it points at, under the trust anchor's exactness rules, and `HEAD` or an abbreviated sha is `invalid` because each can move or be ambiguous", () => {
    const section = parity();
    expectPinned(section, [
      "`reference.ref` is a full commit sha (40 hexadecimal digits, or 64 in a repository that uses SHA-256) or a tag name, resolved to the commit it points at: a sha as `<sha>^{commit}` and a tag as `refs/tags/<name>^{commit}` (so a tag is peeled), with replace objects disabled, because an unqualified name follows git's own ambiguity rules and a ref planted elsewhere could win, and under the exactness rules that the trust anchor states below (a tag name that `git check-ref-format` does not accept as `refs/tags/<name>`, `v1~1` for one, is `invalid`); `HEAD` and an abbreviated sha are each `invalid`, because each can move or be ambiguous.",
    ]);
    expectAbsent(section, ['which capture resolves to a sha']);
  });

  it('M16 specs/13 F-TEST-9: a name that resolves as a branch (`refs/heads/<name>`) is `invalid` regardless of a same-named tag, because a branch moves exactly as `HEAD` does, which the self-agreeing oracle bans; a name with no matching tag reads `missing`, never `invalid`', () => {
    const section = parity();
    expectPinned(section, [
      'So, checked explicitly against `refs/heads/<name>` and regardless of whether a tag of the identical name also exists, is a name that names a branch, since a branch moves exactly as `HEAD` does, which the self-agreeing oracle (F-TEST-2) bans as a reference; a bare name that names no branch is resolved only as a tag, so one with no matching tag reads `missing`, never `invalid`.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: the declaration is human-authored and committed', () => {
    const section = parity();
    expectPinned(section, ['The declaration is human-authored and committed.']);
  });

  it('M16 specs/13 F-TEST-9: the declaration is not unwritable by an agent -- the never-writable floor is enforced after the fact (self-commit disclosure Q212)', () => {
    const section = parity();
    expectPinned(section, [
      'It is not unwritable by an agent: `.forge/**` is in the never-writable floor for agent steps, but that floor is enforced after the fact, by claim enforcement (`06` §6.7), which runs only when the adapter reports changed files, so a session that commits its own work is not reverted (disclosed in `process/SPEC-QUESTIONS.md` Q212).',
    ]);
    expectAbsent(section, ['agent-unwritable', 'lies inside `.forge/**`']);
  });

  it('M16 specs/13 F-TEST-9: the never-writable floor is not what protects the oracle — the trust anchor is, and the anchor has a boundary of its own', () => {
    const section = parity();
    expectPinned(section, [
      'The floor is therefore not what protects the oracle: the trust anchor below is, and it has a boundary of its own, stated there.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: a declaration satisfies "human or spec review" only with a `review` block', () => {
    const section = parity();
    expectPinned(section, [
      'It satisfies "human or spec review" (F-TEST-2) only with a `review` block — `by` (the reviewer), `basis` (what the review rested on) and `at` (when) — **and** an `expires` date.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: a declaration missing review or expires is invalid, and one that has reached its expires date is expired until a person renews it, the date read as UTC and expiring at its start', () => {
    const section = parity();
    expectPinned(section, [
      "A declaration missing either is `invalid`; one that has reached its `expires` date is `expired` until a person renews it (the date is read as UTC and expires at its start, as an F-TEST-8 exemption's expiry does).",
    ]);
  });

  it("M16 specs/13 F-TEST-9: FORGE enforces the review block's presence, shape and expiry, and cannot judge how careful the review was", () => {
    const section = parity();
    expectPinned(section, [
      "FORGE enforces the block's presence, shape and expiry; it cannot judge how careful the review was.",
    ]);
  });

  it('M16 specs/13 F-TEST-9: a capture is taken at the declared ref in a scratch worktree and stored under `.forge/parity/captures/<sha256>.json`, not under reports/', () => {
    const section = parity();
    expectPinned(section, [
      "**A capture** is the reference's observed, normalised behaviour, taken at the declared ref in a scratch worktree, never in the candidate's tree, and stored at `.forge/parity/captures/<sha256>.json`.",
    ]);
    expectAbsent(section, ['reports/parity/captures']);
  });

  it("M16 specs/13 F-TEST-9: a capture holds the declaration's name and digest, the reference's ref and sha, the platform and each case's normalised observation, as compact canonical JSON with keys sorted at every depth and no trailing newline", () => {
    const section = parity();
    expectPinned(section, [
      "It holds the declaration's name and digest, the reference's ref and sha, the platform and, for each case, the normalised observation (for a file in `bytes` mode, its sha256 alone), as canonical JSON (compact, with keys sorted at every depth and no trailing newline), in UTF-8; it holds no tool or interpreter version, no clock time and no host path of its own, so identical behaviour is the identical file.",
    ]);
  });

  it('M16 specs/13 F-TEST-9: a capture is content-addressed, digest-bound and never overwritten, and the declaration digest covers everything but `review`, `expires` and `unobservable`, joined with the overlaid files and the probe bytes', () => {
    const section = parity();
    expectPinned(section, [
      "It is **content-addressed** (its file name is the sha256 of its canonical bytes), **digest-bound** (it records the declaration's digest: a sha256 over the whole declaration in canonical form, except `review`, `expires` and `unobservable`, joined with the content hashes of the files it overlays and the bytes of the probes it names, so renewing a review does not invalidate a capture and changing anything that determines what is observed, or how, does) and **never overwritten**.",
    ]);
  });

  it("M16 specs/13 F-TEST-9: a capture's file name must equal the sha256 of its canonical bytes, verified whenever it is read, else it is invalid", () => {
    const section = parity();
    expectPinned(section, [
      "A capture's file name must equal the sha256 of its canonical bytes, which is verified whenever a capture is read: a capture that fails the check is `invalid`, and so is the declaration whose name it records.",
    ]);
  });

  it('M16 specs/13 F-TEST-9: capturing identical behaviour again is a no-op, and a capture that would differ for the same key is refused', () => {
    const section = parity();
    expectPinned(section, [
      'Capturing identical behaviour again is a no-op; a capture that would differ from an existing one with the same key is refused, never replacing it and never sitting beside it.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: capture is a human act no workflow runs, and `forge parity capture` refuses whenever the FORGE session marker `FORGE_RUN_ID` is present, whichever run it names', () => {
    const section = parity();
    expectPinned(section, [
      'Capture is a human act that no workflow runs, so a refactor cannot mint its own oracle, and `forge parity capture` refuses whenever the FORGE session marker `FORGE_RUN_ID` is present, whichever run it names (`10` §10.3 rule 6 defines the marker, an honest-session signal and not a security boundary).',
    ]);
  });

  it('M16 specs/13 F-TEST-9: captures are never pruned', () => {
    const section = parity();
    expectPinned(section, ['Captures are never pruned (`18` §18.8).']);
  });

  it('M16 specs/13 F-TEST-9: the way out of a refused capture, or of `ambiguous`, is a reviewed commit that deletes the stale capture file', () => {
    const section = parity();
    expectPinned(section, [
      "The way out of a refused capture (the reference's behaviour legitimately changed under the same key) and of `ambiguous` is a reviewed commit that deletes the stale capture file; FORGE itself never deletes a capture.",
    ]);
  });

  it('M16 specs/13 F-TEST-9: the trust anchor compares everything under `.forge/parity/`, whatever `--name` selects, with the tree at `--trusted <ref>`, which is a full commit sha or a ref name that begins `refs/` and that `git check-ref-format` accepts; `HEAD`, an abbreviated sha and a bare name (which a tag can shadow) are refused', () => {
    const section = parity();
    expectPinned(section, [
      '**The trust anchor.** A declaration, probe or capture that was rewritten is not an oracle, so `forge parity check --trusted <ref>` compares everything under `.forge/parity/`, whatever `--name` selects, with the tree at `<ref>`, which is a full commit sha or a ref name that begins `refs/` and that `git check-ref-format` accepts; `HEAD`, an abbreviated sha and a bare name (which a tag can shadow) are refused.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: the `--trusted` ref form is followed by its refusals — after a `;`, `HEAD`, an abbreviated sha and a bare name (which a tag can shadow) are refused', () => {
    const section = parity();
    expectClause(section, [
      'accepts; `HEAD`, an abbreviated sha and a bare name (which a tag can shadow) are refused',
    ]);
  });

  it('M16 specs/13 F-TEST-9: the `--trusted` ref is resolved once, by `git rev-parse --verify <ref>^{commit}` (the form above cannot begin with `-`, so the argument cannot be read as an option), and the commit id that returns is the one every later step uses', () => {
    const section = parity();
    expectPinned(section, [
      'It is resolved once, by `git rev-parse --verify <ref>^{commit}` (the form above cannot begin with `-`, so the argument cannot be read as an option), and the commit id that returns is the one every later step uses.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: a ref name is resolved only after `git show-ref --verify` confirms that exact ref exists, and a sha is accepted only as lower-case digits of the full object-id length that `rev-parse` itself returns', () => {
    const section = parity();
    expectPinned(section, [
      "A ref name is resolved only after `git show-ref --verify <ref>` confirms that exact ref exists (a name that merely resolves, as `refs/heads/refs/heads/main` does for `refs/heads/main`, is not that ref), and a sha is accepted only as lower-case digits of the repository's full object-id length, the id `rev-parse` returns having to be those same digits (an abbreviation, an upper-case spelling and a tag object's id are refused).",
    ]);
  });

  it('M16 specs/13 F-TEST-9: `reference.ref` is held to the same exactness rules as the trust anchor, a tag checked as refs/tags/<name>, invalid being invalid and a valid ref with no commit being missing', () => {
    const section = parity();
    expectPinned(section, [
      'A `reference.ref` is held to the same rules, a tag being checked as `refs/tags/<name>`: an invalid name or sha is `invalid`, and a valid one that resolves to no commit (a tag that does not exist, for one) is `missing`.',
    ]);
  });

  it("M16 specs/13 F-TEST-9: the harness makes the trust-anchor comparison itself — it lists the entries on disk without following symlinks, ignored and untracked included, and compares each path and the git blob id of each file's raw bytes with the listing of `git ls-tree -r -z <commit> -- .forge/parity`, `<commit>` being the resolved id, run with the project root, the directory that holds `.forge/`, as its working directory", () => {
    const section = parity();
    expectPinned(section, [
      "The harness makes the comparison itself and does not ask git what changed: it lists every entry under `.forge/parity/` as it is on disk, without following symlinks and with ignored and untracked entries included, and compares each path, and the git blob id of each file's raw bytes, with the listing of `git ls-tree -r -z <commit> -- .forge/parity` (`<commit>` being that id), run with the project root, the directory that holds `.forge/`, as its working directory.",
    ]);
  });

  it("M16 specs/13 F-TEST-9: the blob id is computed in-process, in the repository's object format (a 64-digit commit id means SHA-256), with no filter or line-ending conversion, which `git hash-object <path>` would apply", () => {
    const section = parity();
    expectPinned(section, [
      "The blob id is computed in-process, in the repository's object format (a 64-digit commit id means SHA-256), with no filter or line-ending conversion, which `git hash-object <path>` would apply.",
    ]);
  });

  it('M16 specs/13 F-TEST-9: the trust-anchor comparison never consults the index or `git status`, which a `skip-worktree` or `assume-unchanged` flag, or an ignore rule, can blind', () => {
    const section = parity();
    expectPinned(section, [
      'It never consults the index or `git status`, which a `skip-worktree` or `assume-unchanged` flag, or an ignore rule, can blind.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: every git command the harness runs has replace objects disabled (`GIT_NO_REPLACE_OBJECTS=1`), because `git replace` can make a ref read as a different tree', () => {
    const section = parity();
    expectPinned(section, [
      'Every git command the harness runs has replace objects disabled (`GIT_NO_REPLACE_OBJECTS=1`), because `git replace` can make a ref read as a different tree.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: the trust-anchor comparison is made first, before any case runs, and, when a case ran, again after the last, against the same commit id, so a ref that moves while the check runs does not move the anchor', () => {
    const section = parity();
    expectPinned(section, [
      'The comparison is made first, before any case runs, and, when a case ran, again after the last, against the same commit id, so a ref that moves while the check runs does not move the anchor.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: a path added, modified or deleted relative to the tree at `--trusted <ref>` is `oracle-changed` — committed, staged, untracked or ignored — and so is a symlink or any other entry that is neither a regular file nor a directory, whatever the tree holds (`.forge` and `.forge/parity` themselves included: where present, each must be a directory), and so is an entry that cannot be read', () => {
    const section = parity();
    expectPinned(section, [
      'A path added, modified or deleted relative to that tree is `oracle-changed`, whether the difference is committed, staged, untracked or ignored, and so is a symlink or any other entry that is neither a regular file nor a directory, whatever the tree holds (`.forge` and `.forge/parity` themselves included: where present, each must be a directory), and so is an entry that cannot be read.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: modified means a different blob id', () => {
    const section = parity();
    expectPinned(section, ['Modified means a different blob id.']);
  });

  it("M16 specs/13 F-TEST-9: a file's mode (its executable bit) is not compared and an empty directory is not an entry, because the harness executes nothing under `.forge/parity/` in place and loads nothing from a mode or an empty directory, so neither can change what it loads or runs", () => {
    const section = parity();
    expectPinned(section, [
      "A file's mode (its executable bit) is not compared, and an empty directory, which git records no entry for, is not an entry: the harness executes nothing under `.forge/parity/` in place (an overlaid file is written as a plain file, below) and loads nothing from a mode or an empty directory, so neither can change what it loads or runs.",
    ]);
  });

  it('M16 specs/13 F-TEST-9: paths are compared as raw bytes, so a case-only or Unicode-normalisation respelling reads as one path deleted and another added', () => {
    const section = parity();
    expectPinned(section, [
      'Paths are compared as raw bytes, so a case-only or Unicode-normalisation respelling reads as one path deleted and another added.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: a checkout that converts bytes (line endings, an `ident` expansion, a smudge filter, a `working-tree-encoding`) reads as a modification, so a project marks `.forge/parity/**` `-text -filter -ident -working-tree-encoding` in its `.gitattributes`, and `-text` alone cures only the line endings', () => {
    const section = parity();
    expectPinned(section, [
      'A checkout that converts bytes (line endings, an `ident` expansion, a smudge filter, a `working-tree-encoding`) reads as a modification, so a project marks `.forge/parity/**` `-text -filter -ident -working-tree-encoding` in its `.gitattributes`: `-text` alone cures only the line endings.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: `oracle-changed` makes every declaration and the overall verdict `invalid`, and the envelope carries it as its own `reason` naming each differing path, even when every declaration was deleted', () => {
    const section = parity();
    expectPinned(section, [
      '`oracle-changed` makes every declaration `invalid` and the overall verdict `invalid`, and the envelope carries it as its own `reason`, naming each differing path, even when the change was the deletion of every declaration, which reads `oracle-changed` and not `no-declarations`.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: at the first comparison each oracle file is read once, so the bytes compared are the bytes loaded, and a probe or an overlaid file is written into the tree under observation from those same bytes, never read from `.forge/parity/` again', () => {
    const section = parity();
    expectPinned(section, [
      'At the first comparison each file is read once: the bytes compared are the bytes loaded, and a probe or an overlaid file is written into the tree under observation from those same bytes, never read from `.forge/parity/` again.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: the second comparison reads the tree afresh, only to compare it again, and loads nothing', () => {
    const section = parity();
    expectPinned(section, [
      'The second comparison reads the tree afresh, only to compare it again, and loads nothing.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: a `--trusted` that is not in the accepted form, or that does not resolve, is a refusal (`ok: false`), never a skipped comparison, and without `--trusted` the check makes no comparison and the evidence records `trusted: null`', () => {
    const section = parity();
    expectPinned(section, [
      'A `--trusted` that is not in the form above, or that does not resolve, is a refusal (`ok: false`), never a skipped comparison; without `--trusted` the check makes no comparison and the evidence records `trusted: null`.',
    ]);
  });

  it("M16 specs/13 F-TEST-9: the `G-Parity` gate's one check passes `--trusted refs/heads/main`, so inside a workflow run the anchor is trunk, an explicit argument of the command and nothing sniffed from the environment", () => {
    const section = parity();
    expectPinned(section, [
      "The `G-Parity` gate's one check is `forge parity check --json --no-record --trusted refs/heads/main` (`10` §10.3 rule 8), so inside a workflow run the anchor is trunk, an explicit argument of the command and nothing sniffed from the environment.",
    ]);
  });

  it("M16 specs/13 F-TEST-9: the anchor's boundary — the comparison makes a rewritten oracle fail the evaluation that sees it, in that run and in every later one until the anchor and the tree agree again", () => {
    const section = parity();
    expectPinned(section, [
      "**The anchor's boundary.** The comparison makes a rewritten oracle fail the evaluation that sees it, in that run and in every later one until the anchor and the tree agree again.",
    ]);
  });

  it('M16 specs/13 F-TEST-9: the comparison does not prevent the rewrite or its landing — lanes integrate between ticks whatever a gate says, an agent with a shell can move a ref, and an integration branch that is the trunk itself gets no protection (reworded M17 P1: the self-reverting-tamper clause moved to its own, now-closed sentence)', () => {
    const section = parity();
    expectPinned(section, [
      'It does not prevent the rewrite or its landing: a lane is integrated onto the integration branch between ticks whatever a gate says, so the gate that sees a rewrite sees it after it has landed there; an agent with a shell can move a ref; and a project that configures its integration branch to be the trunk itself gets no protection, because lanes then land on the anchor.',
    ]);
    expectAbsent(section, [
      "code a case runs can change a file and restore it between the two comparisons, which neither sees (the harness uses only the bytes it loaded, so such a change alters nothing the harness itself writes into a tree or compares, but a case's own command can read the file while it is changed, and code a case runs can do anything the user can in any case); and a",
    ]);
  });

  it("M16 specs/13 F-TEST-9: the comparison cannot tell a person's deliberate change from an agent's — a reviewed change to `.forge/parity/` is trusted once it is on the anchor, and until then reads `oracle-changed`", () => {
    const section = parity();
    expectPinned(section, [
      "It cannot tell a person's deliberate change from an agent's: a reviewed change to `.forge/parity/` is trusted once it is on the anchor, and until then reads `oracle-changed`.",
    ]);
  });

  it("M16 specs/13 F-TEST-9: the gates a run evaluates are read from the main project when the run starts, so a lane's edit of a gate or check file does not change that run", () => {
    const section = parity();
    expectPinned(section, [
      "The gates a run evaluates are read from the main project when the run starts, so a lane's edit of a gate or check file does not change that run.",
    ]);
  });

  it('M16 specs/13 F-TEST-9: by hand, `forge gate check G-Parity` runs the same command, so it compares with trunk too', () => {
    const section = parity();
    expectPinned(section, [
      'By hand, `forge gate check G-Parity` runs the same command, so it compares with trunk too.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: a reference that disagrees with itself is not an oracle', () => {
    const section = parity();
    expectPinned(section, [
      '**Stability.** A reference that disagrees with itself is not an oracle.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: `stability.runs` is an integer from 2 to 10 (default 3), and an unstable reference makes capture refuse and write nothing', () => {
    const section = parity();
    expectPinned(section, [
      'At capture each case runs `stability.runs` times against the reference (default 3; an integer from 2 to 10, else the declaration is `invalid`) and every run must be equal after normalisation, else the case is `unstable` and capture refuses and writes nothing.',
    ]);
    expectAbsent(section, ['(default 3, bounded)']);
  });

  it('M16 specs/13 F-TEST-9: at check each case runs stability.runs times on the candidate and every run must be equal after normalisation, else the case is unstable, and the value the runs share is what is compared with the capture', () => {
    const section = parity();
    expectPinned(section, [
      'At check each case runs `stability.runs` times on the candidate, and every run must be equal after normalisation, else the case is `unstable`; the value the runs share is what is compared with the capture.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: stability is a sample, so a case that varies too rarely for stability.runs runs to show it can still read match', () => {
    const section = parity();
    expectPinned(section, [
      'Stability is a sample: a case that varies too rarely for `stability.runs` runs to show it can still read `match`.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: capture refuses a reference run with an unexpected exit code, including one a signal ended, or an empty observation unless the case declares expect: empty', () => {
    const section = parity();
    expectPinned(section, [
      "**A reference that did not do what was expected is not an oracle either.** Capture refuses a case whose reference run exits with a code other than the case's declared `expect` exit (default 0), a run that a signal ended included, and a case whose entire observation is empty unless it declares `expect: empty`.",
    ]);
  });

  it('M16 specs/13 F-TEST-9: normalisation is declarative and bounded — no code from a declaration runs', () => {
    const section = parity();
    expectPinned(section, [
      '**Normalisation** is declarative and bounded: no code from a declaration runs.',
    ]);
  });

  it("M16 specs/13 F-TEST-9: the harness rewrites each observed tree's root, as given and as its real path, to a fixed token before any declared rule runs", () => {
    const section = parity();
    expectPinned(section, [
      "Before any declared rule runs, the harness rewrites each observed tree's root path, both as given and as its real path, to a fixed token, so where a tree happens to live is not a behaviour difference.",
    ]);
  });

  it('M16 specs/13 F-TEST-9: the rule list is closed, and `replace` runs under a wall-clock budget whose breach makes the case `error` (reworded M17 P1: the budget now bounds the whole case, not only `replace`; reworded M17 P14, Q317 Decision 8: `redact-json-pointers` joins the closed rule list)', () => {
    const section = parity();
    expectPinned(section, [
      "The rules are `strip-ansi`, `line-endings`, `trim-trailing-whitespace`, `sort-lines`, `json-canonical` (parse, sort keys, re-serialise; a non-JSON observation is an error, not a pass), `ignore-json-pointers`, `replace` (a regular-expression source with a literal replacement, scoped to a stream or an output file, linted at load for catastrophic-backtracking shapes — conservative, not a proof of linear time — and run, together with every other rule a declaration lists for one case, under a single stated wall-clock budget (post-v1.0, `specs/22` M17; default 5000 ms, bounding the whole ordered application for that case, not merely one `replace` rule's own match), exceeding which makes the case `error`, a typed refusal, never a hang — the lint at load is advisory defence in depth against a known catastrophic shape, never a substitute for this runtime bound, which also catches a pathological shape the lint's own heuristic misses or a merely large observation) and `redact-json-pointers` (post-v1.0, `specs/22` M17, `process/SPEC-QUESTIONS.md` Q317 Decision 8: at each of its own named pointers, replaces every match of a regular-expression `pattern` found within the STRING there with a literal `replacement`, never deleting the member the way `ignore-json- pointers` does — the one mechanism that can redact a real filesystem path, or any other substring, embedded inside a `library` surface's own structured result, which carries no raw text for `replace` to run against at all.",
    ]);
  });

  it('M16 specs/13 F-TEST-9: the normalisation rules run in the order a declaration lists them -- line-endings, strip-ansi, trim-trailing-whitespace, sort-lines and replace, each defined precisely (reworded M17 P14, Q317 Decision 8: the lead-in is now the one-ordering-exception sentence, after the new `redact-json-pointers`/`ignore-json-pointers` precedence rule)', () => {
    const section = parity();
    expectPinned(section, [
      'This is the only ordering exception among the rules; `line-endings` rewrites CRLF and a lone CR as LF; `strip-ansi` removes CSI escape sequences (`ESC [`, parameter and intermediate bytes, then a final byte); `trim-trailing-whitespace` removes the spaces and tabs at the end of each line; `sort-lines` orders lines by UTF-16 code unit; and `replace` replaces every match.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: a rule that would erase a non-empty observation is refused, and so is a `replace` over a whole stream', () => {
    const section = parity();
    expectPinned(section, [
      "A rule that would erase a non-empty observation entirely is refused, and so is a `replace` (or a `redact-json-pointers` pointer's own match) whose match is the entire content of a non-empty stream or field: a surface that does not want a stream says so with `streams` (below) rather than erasing it.",
    ]);
  });

  it('M16 specs/13 F-TEST-9: equality is decided on the full normalised content, never on a truncated display, and a mismatch report is printed only without --json', () => {
    const section = parity();
    expectPinned(section, [
      '**Equality is decided on the full normalised content**, never on a truncated display: a mismatch report shows the first differing line with context under a byte cap, labelled as display only, and printed only without `--json`: an envelope and a `ParityEvidence` record carry no observed text, and a `reason` says where a difference is (the surface, the case and the stream), never what the text was.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: the secret check runs on exactly what would be stored, the observation after normalisation', () => {
    const section = parity();
    expectPinned(section, [
      'The secret check runs on exactly what would be stored, which is the observation after normalisation.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: an observation containing a secret, or a text observation that is not UTF-8, is refused at capture', () => {
    const section = parity();
    expectPinned(section, [
      'An observation that contains a secret, or a text observation that does not decode as UTF-8, is refused at capture, before anything is stored.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: the surfaces are four, and only declared surfaces are observed', () => {
    const section = parity();
    expectPinned(section, [
      '**The surfaces** are four, and only declared surfaces are observed; everything else is unobserved.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: the case/surface model — a declaration lists its surfaces, each surface lists at least one case of its own (none makes the declaration `invalid`), and a case belongs to exactly one surface and is run against that surface alone', () => {
    const section = parity();
    expectPinned(section, [
      'A declaration lists its surfaces, each surface lists its own cases (at least one: a surface that lists none observes nothing, and its declaration is `invalid`), and a case belongs to exactly one surface and is run against that surface alone.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: `process` observes the stdout, stderr and exit code of a vetted command, or, where a signal ended the process and so there is no exit code, that signal', () => {
    const section = parity();
    expectPinned(section, [
      '`process` observes the stdout, stderr and exit code of a vetted command, or, where a signal ended the process and so there is no exit code, that signal.',
    ]);
  });

  it("M16 specs/13 F-TEST-9: vetting's closed lists refuse a network program, a URL and a package-manager verb, and every path a command names that exists must stay inside the project", () => {
    const section = parity();
    expectPinned(section, [
      "Vetting is the engine's check of a command that a project stores and FORGE runs (the confinement model of `20` §20.1, as the engine applies it to a stored command): one plain invocation, with no chaining, redirection or substitution, no variable, tilde or brace expansion and no shell `-c` string, nothing on the hard denylist, and `network: none`, which no declaration can relax for a command, so a program on the engine's list of network programs (`curl`, `wget` and `ssh`, for three), a URL and, for the package managers the engine knows, a verb that fetches or changes dependencies (an install, for one) are refused, and every path it names that exists, a glob's matches included, must stay inside the project, a symlink being followed to where it ends (a path that does not exist yet is judged by its text alone).",
    ]);
  });

  it("M16 specs/13 F-TEST-9: vetting applies `network: none` against the engine's closed list of network programs and package-manager verbs, which no declaration can relax", () => {
    const section = parity();
    expectClause(section, [
      "`network: none`, which no declaration can relax for a command, so a program on the engine's list of network programs (`curl`, `wget` and `ssh`, for three), a URL and, for the package managers the engine knows, a verb that fetches or changes dependencies (an install, for one) are refused",
    ]);
  });

  it("M16 specs/13 F-TEST-9: vetting also refuses what the engine's other closed lists name -- wrapper, mutating and package-runner programs, dangerous find options, a non-read-only git subcommand and a secret-file-shaped path", () => {
    const section = parity();
    expectPinned(section, [
      "It also refuses what the engine's other lists name: some programs that run another program (`env`, `xargs`, `timeout`), some that change files or the environment (`rm`, `mv`, `chmod`), some package runners that fetch what they run (`npx`), `find` with `-exec`, `-execdir`, `-ok`, `-okdir` or `-delete`, a git subcommand outside the engine's read-only set, and a path whose name, as written, matches the engine's patterns for a secret file, `.git` or `.forge/state`.",
    ]);
  });

  it('M16 specs/13 F-TEST-9: those closed lists, the network list included, are closed, not classes, so a program or path on none of them passes -- cp, touch and python3 -m pip install do -- and vetting is a filter on what a declaration can say, not a sandbox', () => {
    const section = parity();
    expectPinned(section, [
      'Those lists, the one of network programs included, are closed, not classes, so a program or path on none of them passes (`cp`, `touch` and `python3 -m pip install` do), and vetting is a filter on what a reviewed declaration can say, not a sandbox.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: a glob is allowed in a vetted command, unlike in the test command that `20` §20.1 grants, which may not name a `*`', () => {
    const section = parity();
    expectPinned(section, [
      'A glob is allowed, unlike in the test command that `20` §20.1 grants, which may not name a `*`.',
    ]);
  });

  it("M16 specs/13 F-TEST-9: vetting is applied when the declaration loads, against the project's tree, whichever tree a command later runs in", () => {
    const section = parity();
    expectPinned(section, [
      "Vetting is applied when the declaration loads, against the project's tree, whichever tree a command later runs in.",
    ]);
  });

  it("M16 specs/13 F-TEST-9: a run or setup that vetting refuses, a run composed with a case's arguments included, makes the declaration invalid, so a declaration that can never run fails at load", () => {
    const section = parity();
    expectPinned(section, [
      "A `run` or `setup` that vetting refuses, a `run` composed with a case's arguments (below) included, makes the declaration `invalid`, so a declaration that can never run fails at load.",
    ]);
  });

  it('M16 specs/13 F-TEST-9: a surface that wants only some of the two streams lists them with `streams`, an unlisted stream is unobserved, and that shows in review and is reported in the evidence', () => {
    const section = parity();
    expectPinned(section, [
      'A surface that wants only some of the two streams lists them with `streams` (for example `streams: [stdout]`), and an unlisted stream is unobserved, which shows in review and is reported in the evidence.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: `file` observes declared output files at declared paths, cleaned before and after each case', () => {
    const section = parity();
    expectPinned(section, [
      '`file` observes declared output files at declared paths, cleaned before and after each case.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: a `file` output path must be relative, with no `..` component, outside `.git` and `.forge` and untracked in the observed tree, and a case whose output path passes through a symlink is `error`', () => {
    const section = parity();
    expectPinned(section, [
      'An output path must be relative, with no `..` component, and lie outside `.git` and `.forge`, and one that is tracked in git in the tree being observed is `invalid`; before cleaning, the harness examines each component of the path without following links, and a case whose output path passes through a symlink is `error`.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: cleaning deletes only a file the reviewed declaration names, and never a tracked one', () => {
    const section = parity();
    expectPinned(section, [
      'Cleaning therefore deletes only a file the reviewed declaration names, and never a tracked one.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: a non-text file is declared in `bytes` mode — only its sha256 is observed and stored', () => {
    const section = parity();
    expectPinned(section, [
      'A declared file that is not text is declared in `bytes` mode: only its sha256 is observed and stored, never its content.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: `library` is the probe protocol', () => {
    const section = parity();
    expectPinned(section, ['`library` is the probe protocol below.']);
  });

  it("M16 specs/13 F-TEST-9: `http` uses the declaration's vetted start command for its loopback server, and a held port makes the case `error`, never a comparison against whatever is listening", () => {
    const section = parity();
    expectPinned(section, [
      "`http` observes a request/response pair through an in-process client against a loopback server the harness starts with the declaration's vetted start command: an explicit opt-in in the declaration (`network: loopback`, visible in review), with a literal loopback port verified free before the server starts — a held port makes the case `error`, never a comparison against whatever is listening — and a client that refuses any other host.",
    ]);
  });

  it('M16 specs/13 F-TEST-9: a case has no placeholders -- its inputs are overlaid files copied from under .forge/parity/ to a declared destination, written as a plain file with mode 0644, and removed after the case', () => {
    const section = parity();
    expectPinned(section, [
      "A case has no placeholders: its inputs are overlaid files, copied from under `.forge/parity/` (where the trust anchor covers them) to a declared destination in the tree being observed, under the output-path rule above, written from the bytes the harness loaded as a plain file with mode 0644 whatever the source's (so a script is run through its interpreter), and removed after the case.",
    ]);
  });

  it("M16 specs/13 F-TEST-9: a case's arguments are literal words, each appended to the surface's run as one single-quoted word, so an argument holding a quote, newline or shell operator cannot be declared", () => {
    const section = parity();
    expectPinned(section, [
      "Its arguments are literal words: each is appended to the surface's `run` as one single-quoted word, and the composed line is what vetting judges at load and what runs, so an argument that holds a single quote, a newline or a shell operator such as `;` or `|` cannot be declared (the declaration is `invalid`), and a value that cannot be a word is an overlaid input instead.",
    ]);
  });

  it('M16 specs/13 F-TEST-9: an overlay destination that already exists in the observed tree makes the case `error` and is never overwritten', () => {
    const section = parity();
    expectPinned(section, [
      'A destination that already exists in that tree makes the case `error`; it is never overwritten.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: the `library` surface is a `process` surface whose command is a reviewed probe script', () => {
    const section = parity();
    expectPinned(section, [
      '**The library probe protocol.** The `library` surface is a `process` surface whose command is a reviewed probe script under `.forge/parity/probes/`.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: the probe prints exactly one JSON object — ok true with a value, or ok false with an error', () => {
    const section = parity();
    expectPinned(section, [
      'The probe calls the library and prints exactly one JSON object on stdout: `{"ok": true, "value": ...}` for a return, or `{"ok": false, "error": {"name": ..., "message": ...}}` for a thrown error.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: a throw is an observation compared like a return, and a stack trace is not part of the protocol', () => {
    const section = parity();
    expectPinned(section, [
      'A throw is an observation, compared like a return; a stack trace is not part of the protocol, because it carries host paths.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: stdout that is not exactly one such object is `error`, never `match`', () => {
    const section = parity();
    expectPinned(section, [
      'Stdout that is not exactly one such object is `error`, never `match`.',
    ]);
  });

  it("M16 specs/13 F-TEST-9: the probe's bytes are in the declaration digest, the probe is overlaid into whichever tree is observed from the bytes the harness loaded, and being under `.forge/parity/` it is covered by the trust anchor", () => {
    const section = parity();
    expectPinned(section, [
      "The probe's bytes are in the declaration digest and it is overlaid into whichever tree is observed, from the bytes the harness loaded, so the same reviewed bytes run against the reference and the candidate; being under `.forge/parity/`, it is covered by the trust anchor.",
    ]);
  });

  it('M16 specs/13 F-TEST-9: the environment is pinned — TZ=UTC, LC_ALL=C.UTF-8, LANG=C.UTF-8', () => {
    const section = parity();
    expectPinned(section, [
      '**The environment is pinned.** Every case runs in a scrubbed environment with `TZ=UTC`, `LC_ALL=C.UTF-8` and `LANG=C.UTF-8`, so a locale or timezone difference between machines is not a behaviour difference.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: the reference is observed in a scratch worktree outside the project tree (reworded M17 P8) and always removed, the candidate in place with its head sha, a dirty flag and a delta digest recorded', () => {
    const section = parity();
    expectPinned(section, [
      "**Where each side is observed.** The reference in a scratch worktree at the declared ref, placed outside the project's own working tree, under the user's cache directory (`18`'s Worktree location paragraph, post-v1.0 `specs/22` M17) and always removed; the candidate in place, with its head sha, a dirty flag and a digest of its working-tree delta recorded.",
    ]);
  });

  it("M16 specs/13 F-TEST-9: the reference's scratch worktree is placed outside the project's own working tree (reworded M17 P8)", () => {
    const section = parity();
    expectClause(section, ["placed outside the project's own working tree"]);
  });

  it("M16 specs/13 F-TEST-9: the scratch tree holds the ref's tracked files and nothing installed or built", () => {
    const section = parity();
    expectPinned(section, [
      "The scratch tree holds the ref's tracked files and nothing installed or built.",
    ]);
  });

  it("M17 P8/Q352: once P8 moved the reference tree outside the project, the harness now bridges the candidate's top-level node_modules into it explicitly, closing the disclosed Q314 regression", () => {
    const section = parity();
    expectPinned(section, [
      "Once P8 moved it outside the project's own working tree, that walk-up stopped reaching the candidate's installed packages at all — a disclosed regression (`SPEC-QUESTIONS.md` Q314) the harness now closes explicitly: before any surface's `setup` or `run` reaches the scratch tree, the project's own top-level `node_modules` is symlinked into the scratch tree's root, restoring the identical \"both sides run against one installed copy\" reach the old nesting gave by accident, now as a reviewable mechanism rather than one.",
    ]);
  });

  it('M17 P8/Q352: NODE_PATH and a declaration-authored setup command were both considered and rejected as the fix mechanism', () => {
    const section = parity();
    expectPinned(section, [
      "`NODE_PATH` was considered and rejected (Node's own ESM resolver never consults it, so an `import`-based command would still fail), as was a declaration-authored `setup` command (`network: none` already refuses a package-manager install verb, below, so a declaration has no vetted way to populate `node_modules` itself).",
    ]);
  });

  it("M17 P8/Q352: the bridge still reaches only the project's top-level node_modules, matching the old accidental mechanism's own real reach", () => {
    const section = parity();
    expectPinned(section, [
      "This still reaches only the project's top-level `node_modules`, matching the old mechanism's own real reach — a workspace package's own nested `node_modules` was never found by the pre-P8 walk-up either.",
    ]);
  });

  it('M16 specs/13 F-TEST-9: for any runtime other than Node, anything built from the tracked files takes vetted `setup` commands whose install-refusal and registry-allowlist absence vetting narrows but does not enforce', () => {
    const section = parity();
    expectPinned(section, [
      'For any runtime other than Node, and for anything that must be built from the tracked files, a declaration carries `setup` commands, vetted exactly as `run` is (so `network: none` applies to a `setup` too: an install by a package manager the engine knows is refused, and a declaration is not given the registry allowlist that `20` §20.1 allows an agent that needs one, so `setup` is meant to build from what is tracked, which vetting narrows and does not enforce: see the honest boundary), whose bytes are in the declaration digest and which run only in the scratch tree, before the reference is observed (so only at capture: a check observes the candidate alone and runs no `setup`).',
    ]);
  });

  it('M16 specs/13 F-TEST-9: `setup` runs only at capture — a check observes the candidate alone and runs no `setup`', () => {
    const section = parity();
    expectClause(section, [
      'before the reference is observed (so only at capture: a check observes the candidate alone and runs no `setup`)',
    ]);
  });

  it('M16 specs/13 F-TEST-9: with no `setup`, a surface that needs more than the tracked files cannot be observed on the reference side, and the declaration must say how to get it', () => {
    const section = parity();
    expectPinned(section, [
      'With none, a surface that needs more than the tracked files cannot be observed on the reference side, and the declaration must say how to get it.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: FORGE builds nothing for the candidate', () => {
    const section = parity();
    expectPinned(section, ['FORGE builds nothing for the candidate.']);
  });

  it("M16 specs/13 F-TEST-9: a case's command is the same on both sides, so one that reads build output must build it itself -- ignored build output is outside the digest, the anchor and the snapshot, so a stale build can read as match", () => {
    const section = parity();
    expectPinned(section, [
      "A case's command is the same on both sides, so one that reads build output must build it itself: ignored build output is outside the declaration digest, the anchor and the snapshot below, so a stale build of the candidate is not detected and can read as `match`.",
    ]);
  });

  it("M16 specs/13 F-TEST-9: observing must leave the candidate's tree unchanged, checked by a snapshot of HEAD and of every path `git status --porcelain=v1 -z --no-renames --untracked-files=all` lists, resolved relative to the repository's top level", () => {
    const section = parity();
    expectPinned(section, [
      "Observing must leave the candidate's tree unchanged.",
      "Before and after each case the harness takes a snapshot: `HEAD`, plus, for every path that `git status --porcelain=v1 -z --no-renames --untracked-files=all` lists (its paths are relative to the repository's top level, which can lie above the project root, and are resolved from there), its status code and a digest of its bytes (or `absent`, `dir` or `link:<target>` where it is not a regular file).",
    ]);
  });

  it('M16 specs/13 F-TEST-9: the delta digest recorded for the candidate is the digest of the snapshot taken before the first case, and a case whose two snapshots differ is `unclean`', () => {
    const section = parity();
    expectPinned(section, [
      'The delta digest recorded for the candidate is the digest of the snapshot taken before the first case, and a case whose two snapshots differ is `unclean`.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: an ignored file is not part of a snapshot, and neither is a tracked file marked skip-worktree or assume-unchanged, so a change to either is not observed', () => {
    const section = parity();
    expectPinned(section, [
      'An ignored file is not part of a snapshot, and neither is a tracked file marked `skip-worktree` or `assume-unchanged`, so a change to either is not observed.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: there are nine verdicts at two levels, listed in precedence order', () => {
    const section = parity();
    expectPinned(section, [
      '**Verdicts.** There are nine, at two levels, listed here in precedence order.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: four verdicts are decided about a declaration: `invalid`, `expired`, `missing` and `ambiguous`', () => {
    const section = parity();
    expectPinned(section, [
      'Four are decided about a **declaration**: `invalid`, `expired`, `missing` and `ambiguous`.',
    ]);
  });

  it("M16 specs/13 F-TEST-9: each declaration-level verdict is decided before any case is observed and stops that declaration's cases from running", () => {
    const section = parity();
    expectPinned(section, [
      "Each is decided before any case is observed and stops that declaration's cases from running.",
    ]);
  });

  it("M16 specs/13 F-TEST-9: there is one exception to that — the trust anchor's second comparison, made after the last case, can still find `oracle-changed`, which makes every declaration `invalid` and means that no case's result counts", () => {
    const section = parity();
    expectPinned(section, [
      "There is one exception: the trust anchor's second comparison, made after the last case, can still find `oracle-changed`, which makes every declaration `invalid` and means that no case's result counts.",
    ]);
  });

  it('M16 specs/13 F-TEST-9: five verdicts are decided about a case, which runs only when its declaration was not stopped, and each case that is run ends in exactly one of the five', () => {
    const section = parity();
    expectPinned(section, [
      'Five are decided about a **case**, which runs only when its declaration was not stopped: `error`, `unclean`, `unstable`, `mismatch` and `match`.',
      'Each case that is run ends in exactly one of the five.',
    ]);
    expectAbsent(section, ['Every case ends in exactly one of nine']);
  });

  it("M16 specs/13 F-TEST-9: `invalid` -- the declaration does not load or cannot be trusted, with each listed cause now including a run composed with a case's arguments that vetting refuses", () => {
    const section = parity();
    expectPinned(section, [
      "`invalid` — the declaration does not load or cannot be trusted: an unknown key, a missing `review` or `expires`, a `name` that is not its file stem, a `reference.ref` that is not a full commit sha or a tag name, a `stability.runs` outside 2 to 10, a `run` or `setup` command, or a `run` composed with a case's arguments, that vetting refuses, a surface that lists no case, an output path or overlay destination that is absolute, has a `..` component or lies under `.git` or `.forge`, a declared `file` output tracked in git, a capture whose file name is not the sha256 of its bytes, an `unobservable` entry that names no surface of the declaration, an oracle that changed since its trust anchor (`oracle-changed`), or a declaration that compares nothing (`nothing-compared`: it has no surface that is not exempt).",
    ]);
  });

  it("M16 specs/13 F-TEST-9: `expired` -- the declaration's expires date, or an unobservable entry's expiry, has been reached, a date read as UTC and expiring at its start", () => {
    const section = parity();
    expectPinned(section, [
      "`expired` — the declaration's `expires` date, or an `unobservable` entry's expiry, has been reached (a date is read as UTC and expires at its start).",
    ]);
  });

  it('M16 specs/13 F-TEST-9: `missing` — no capture is selected for the declaration, or the one selected holds no entry for a case that is compared', () => {
    const section = parity();
    expectPinned(section, [
      '`missing` — no capture is selected for the declaration, or the one selected holds no entry for a case that is compared (see capture selection).',
    ]);
  });

  it('M16 specs/13 F-TEST-9: `ambiguous` — two or more differing captures share one selection key', () => {
    const section = parity();
    expectPinned(section, [
      '`ambiguous` — two or more differing captures share one selection key.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: `error` -- the harness could not complete the case, now including a snapshot that cannot be taken or a loopback port that is not free', () => {
    const section = parity();
    expectPinned(section, [
      '`error` — the harness could not complete the case: a timeout, an output over its cap, a probe that printed no well-formed object, a rule that cannot be applied (a `replace` over its time limit included), an output path that passes through a symlink, an overlay destination that already exists, a snapshot that cannot be taken, a loopback port that is not free.',
    ]);
  });

  it("M16 specs/13 F-TEST-9: `unclean` — observing changed the candidate's tree, or a case wrote outside its declared outputs", () => {
    const section = parity();
    expectPinned(section, [
      "`unclean` — observing changed the candidate's tree, or a case wrote outside its declared outputs.",
    ]);
  });

  it('M16 specs/13 F-TEST-9: `unstable` — the candidate or the reference disagrees with itself across repeated runs', () => {
    const section = parity();
    expectPinned(section, [
      '`unstable` — the candidate (at check) or the reference (at capture) disagrees with itself across repeated runs.',
    ]);
  });

  it("M16 specs/13 F-TEST-9: `mismatch` — the candidate's normalised observation differs from the capture's", () => {
    const section = parity();
    expectPinned(section, [
      "`mismatch` — the candidate's normalised observation differs from the capture's.",
    ]);
  });

  it("M16 specs/13 F-TEST-9: `match` — the candidate's normalised observation equals the capture's, in full", () => {
    const section = parity();
    expectPinned(section, [
      "`match` — the candidate's normalised observation equals the capture's, in full.",
    ]);
  });

  it('M16 specs/13 F-TEST-9: precedence is total — the nine verdict names in order, and the first that applies is the one reported', () => {
    const section = parity();
    expectPinned(section, [
      '**Precedence is total**: `invalid`, `expired`, `missing`, `ambiguous`, `error`, `unclean`, `unstable`, `mismatch`, `match`, and the first that applies is the one reported.',
    ]);
  });

  it("M16 specs/13 F-TEST-9: the same order picks a declaration's verdict from its cases' and a record's overall verdict from its declarations'", () => {
    const section = parity();
    expectPinned(section, [
      "The same order picks a declaration's verdict from its cases' verdicts and a record's overall verdict from its declarations'.",
    ]);
  });

  it('M16 specs/13 F-TEST-9: counting — the unit is the case, and `passing` counts the cases that are `match` in declarations that were not stopped at declaration level', () => {
    const section = parity();
    expectPinned(section, [
      '**Counting.** The unit is the case.',
      '`passing` counts the cases that are `match`, in declarations that were not stopped at declaration level.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: counting — `failing` counts the cases that are not `match`, plus one for each declaration stopped at declaration level, however many cases it declares', () => {
    const section = parity();
    expectPinned(section, [
      '`failing` counts the cases that are not `match`, plus one for each declaration that was stopped at declaration level, however many cases it declares.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: counting — a case on an exempt surface is not run and has no verdict, and the exempt count is separate, counts surfaces, is never failing and is never counted as compared', () => {
    const section = parity();
    expectPinned(section, [
      'A case on an exempt surface is not run and has no verdict: the exempt count is separate (below), counts surfaces, is never failing and is never counted as compared.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: a check with no declaration at all counts one failing and no passing, and its overall verdict is `invalid` with the `reason` `no-declarations`', () => {
    const section = parity();
    expectPinned(section, [
      'A check with no declaration at all counts one failing and no passing, and its overall verdict is `invalid` with the `reason` `no-declarations`.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: a declaration that was not stopped runs at least one case, so `failing` is 0 only when `passing` is at least 1 and a check that compared nothing cannot pass', () => {
    const section = parity();
    expectPinned(section, [
      'A declaration that was not stopped has a surface that is not exempt, and every surface lists a case, so it runs at least one case: `failing` is 0 only when `passing` is at least 1, and a check that compared nothing cannot pass.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: a check that would still print 0 passing and 0 failing is a refusal, as is a `--name` that matches no declaration, which names the declarations that exist', () => {
    const section = parity();
    expectPinned(section, [
      'A check that would still print 0 passing and 0 failing is a refusal instead, as is a `--name` that matches no declaration, which names the declarations that exist.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: `unobservable` declares, by a human, that a surface genuinely cannot be observed, and names that surface', () => {
    const section = parity();
    expectPinned(section, [
      '**`unobservable`** declares, by a human, that a surface genuinely cannot be observed, and names that surface.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: an `unobservable` entry carries a reason, an owner and an expiry — the shape of an F-TEST-8 exemption', () => {
    const section = parity();
    expectPinned(section, [
      'Each entry carries a reason, an owner and an expiry — the shape of an F-TEST-8 exemption.',
    ]);
  });

  it("M16 specs/13 F-TEST-9: an excused surface's cases are not run and have no verdict — it counts in its own exempt bucket, once per surface, and never as a match", () => {
    const section = parity();
    expectPinned(section, [
      "The surface's cases are not run and have no verdict: it counts in its own exempt bucket, once per surface, and never as a match.",
    ]);
  });

  it('M16 specs/13 F-TEST-9: an `unobservable` entry excuses one surface, never a whole declaration — one whose every surface is excused compares nothing, `nothing-compared` — and an expired entry fails `expired`', () => {
    const section = parity();
    expectPinned(section, [
      'An entry excuses one surface, never a whole declaration (one whose every surface is excused compares nothing: `nothing-compared`), and an expired entry fails (`expired`).',
    ]);
  });

  it('M16 specs/13 F-TEST-9: a capture is selected by `(name, declaration digest, reference sha, platform)`, the reference sha being resolved at check time, and none selected is `missing`', () => {
    const section = parity();
    expectPinned(section, [
      '**Capture selection.** A capture is selected by the key `(name, declaration digest, reference sha, platform)`, the reference sha being the one `reference.ref` resolves to when the check runs.',
      'None selected is `missing` — which is what a capture taken under an older digest, at another reference sha (a tag that has since moved or been deleted, for one) or on another platform reads as: it is never silently compared.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: two or more differing captures under one key is `ambiguous`', () => {
    const section = parity();
    expectPinned(section, ['Two or more differing captures under one key is `ambiguous`.']);
  });

  it("M16 specs/13 F-TEST-9: a selected capture that holds no entry for one of the declaration's cases on a surface that is not exempt reads `missing`, never a partial comparison", () => {
    const section = parity();
    expectPinned(section, [
      "A selected capture that holds no entry for one of the declaration's cases on a surface that is not exempt (an `unobservable` entry removed since the capture was taken) also reads `missing`, never a partial comparison.",
    ]);
  });

  it("M16 specs/13 F-TEST-9: `platform` is the operating system and CPU architecture as the harness's runtime reports them", () => {
    const section = parity();
    expectPinned(section, [
      "**`platform`** is the operating system and CPU architecture as the harness's own runtime reports them, `<os>-<arch>` (for example `darwin-arm64` or `linux-x64`); it is not the agent platform of `07`.",
    ]);
  });

  it('M16 specs/13 F-TEST-9: tool and interpreter versions are recorded in the evidence but are not in the key, and a capture does not pin interpreter versions', () => {
    const section = parity();
    expectPinned(section, [
      'Tool and interpreter versions are recorded in the evidence but are not in the key, and **a capture does not pin interpreter versions**: a reference captured under one runtime and a candidate checked under another are compared as they are, and a difference the interpreter causes reads as a `mismatch` for a person to resolve.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: a capture on a second platform is a second human act', () => {
    const section = parity();
    expectPinned(section, ['A capture on a second platform is a second human act.']);
  });

  it("M16 specs/13 F-TEST-9: `forge parity check --json` prints a `declarations` list in order of `name`, whose entries each give a declaration's name, verdict, reason, passing and failing", () => {
    const section = parity();
    expectPinned(section, [
      '**What the check prints.** `forge parity check --json` prints one `{"v":1,...}` envelope (`03` §3.5) with numeric `failing` and `passing` counts, which is what the `G-Parity` check\'s `failOn: "failing > 0"` reads under `parser: forge-json` (`10` §10.3\'s check contract); the overall verdict; the check\'s own `reason` where the check itself stopped (`no-declarations`, or `oracle-changed` naming each differing path); the evidence id (null when nothing was recorded, below); and a `declarations` list, in order of `name`, whose entries each give a declaration\'s `name`, `verdict`, `reason` (a short stated reason wherever the verdict is not `match`), `passing` and `failing`.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: a check with no declaration has no entry to carry its reason, which is why the envelope carries its own', () => {
    const section = parity();
    expectPinned(section, [
      'A check with no declaration has no entry to carry its reason, which is why the envelope does.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: `failing` is 0 only when `passing` is at least 1, so a check that compared nothing cannot pass', () => {
    const section = parity();
    expectPinned(section, [
      '`failing` is 0 only when `passing` is at least 1 (Counting, above), so a check that compared nothing cannot pass.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: a refusal envelope (`ok: false`) fails the gate, and a `--name` that matches no declaration and a `--trusted` that is not in the accepted form or does not resolve each get one', () => {
    const section = parity();
    expectPinned(section, [
      'A refusal envelope (`ok: false`) fails the gate; a `--name` that matches no declaration and a `--trusted` that is not in the accepted form or does not resolve each get one.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: one `forge parity check` invocation writes one `ParityEvidence` record, however many declarations it checks, unless it is given `--no-record`', () => {
    const section = parity();
    expectPinned(section, [
      '**Evidence.** One `forge parity check` invocation writes one `ParityEvidence` record (`18` §18.7), however many declarations it checks, unless it is given `--no-record`.',
    ]);
  });

  it("M16 specs/13 F-TEST-9: the evidence record carries a `declarations` list with each declaration's reason where the verdict is not `match`, the check's own `reason` where the check itself stopped, and `trusted`, the trust anchor's sha or null", () => {
    const section = parity();
    expectPinned(section, [
      "The record's body carries a `declarations` list (for each: the name, the declaration digest, the reference's ref and sha, the platform, the digest of the capture it selected, its verdict and, where that is not `match`, its `reason`, the verdict and content hashes of each case, and the exempt count), the check's own `reason` where the check itself stopped, and `trusted`, the trust anchor's sha or null.",
    ]);
  });

  it('M16 specs/13 F-TEST-9: the evidence record holds verdicts and content hashes, never the observed content', () => {
    const section = parity();
    expectPinned(section, ['It holds verdicts and content hashes, never the observed content.']);
  });

  it("M16 specs/13 F-TEST-9: `--story <id>` names the story the check ran for, is the record's `story` and its retention subject, and without it the subject is the single shared subject `project`", () => {
    const section = parity();
    expectPinned(section, [
      "`--story <id>` names the story the check ran for: it is the record's `story` and its retention subject, which without it is the single shared subject `project` (`18` §18.7, Retention).",
    ]);
  });

  it('M16 specs/13 F-TEST-9: `EvidenceBundle.parityEvidence` is where a bundle lists the ids of the ParityEvidence records, and M16 changes no bundle assembler, so nothing populates it yet', () => {
    const section = parity();
    expectPinned(section, [
      '`EvidenceBundle.parityEvidence` is where a bundle lists the ids of these records; M16 changes no bundle assembler, so nothing populates it yet (`18` §18.7).',
    ]);
  });

  it('M16 specs/13 F-TEST-9: the `G-Parity` gate runs `forge parity check` as its one deterministic check, `behavior:parity`, and passes `--no-record`, because a file a check writes in the integration worktree leaves it dirty and the next run refuses to start with `VCS-INTEGRATION-DIRTY`', () => {
    const section = parity();
    expectPinned(section, [
      'The `G-Parity` gate (`10` §10.3 rule 8) runs `forge parity check` as its one deterministic check, `behavior:parity`, and passes `--no-record`, because it evaluates in the integration worktree, where a file written by a check leaves the worktree dirty and the next run refuses to start (`VCS-INTEGRATION-DIRTY`).',
    ]);
  });

  it("M16 specs/13 F-TEST-9: an evaluation inside a run leaves its trail in the run's event log, and where the run's id reaches the command in FORGE_RUN_ID and the command can name the run's own project root, the check adds a CheckRun event of kind 'parity'", () => {
    const section = parity();
    expectPinned(section, [
      "An evaluation inside a run therefore leaves its trail in the run's event log (`18` §18.4), not in a `ParityEvidence` record: the `GateEvaluated` event carries each check's verdict and output digests, and where the run's id reaches the command in `FORGE_RUN_ID` and the command can name the run's own project root (a gate check runs in the integration worktree, which is not that root), the check adds a `CheckRun` event of kind `'parity'`.",
    ]);
  });

  it('M16 specs/13 F-TEST-9: the honest boundary — a green parity check says the declared surfaces matched on the declared cases after the declared normalisation', () => {
    const section = parity();
    expectPinned(section, [
      '**The honest boundary.** A green parity check says the **declared surfaces** matched the reference on the **declared cases** after the **declared normalisation** — never that behaviour is preserved.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: everything undeclared is unobserved, and the evidence says so', () => {
    const section = parity();
    expectPinned(section, ['Everything undeclared is unobserved, and the evidence says so.']);
  });

  it('M16 specs/13 F-TEST-9: over-normalising can hide a real difference, which is why the rules sit in a digest-bound, reviewed declaration', () => {
    const section = parity();
    expectPinned(section, [
      'Over-normalising can hide a real difference, which is why the rules sit in a digest-bound, human-reviewed declaration and none may erase everything.',
    ]);
  });

  it("M16 specs/13 F-TEST-9: the candidate's own case command can no longer write or restore anything under `.forge/parity/`; a read-only mechanism still permits the review-caught read-cheat (reworded M17 P1: closes the self-reverting-tamper gap)", () => {
    const section = parity();
    expectPinned(section, [
      "The candidate is observed in place, and its own case command can no longer write or restore anything under `.forge/parity/` (above): where the chosen isolation mechanism makes the directory absent from the tree the command sees, it cannot read it either; where the mechanism is read-only instead, the command can still read it, including a capture's stored observation, and a change that reads its own expected output is a code change this check cannot tell from a faithful one — review is what catches that, exactly as it always has.",
    ]);
  });

  it("M16 specs/13 F-TEST-9: vetting judges a command's text against the engine's closed lists and, for a glob or a symlink, the project's tree as it is when the declaration loads", () => {
    const section = parity();
    expectPinned(section, [
      "Vetting judges a command's text against the engine's closed lists and, for a glob or a symlink, the project's tree as it is when the declaration loads.",
    ]);
  });

  it("M16 specs/13 F-TEST-9: that judgement covers neither the reference's scratch tree nor what a named program does when it runs nor a program on none of the lists, so review of the declaration is what covers both a script's own behaviour and a setup that can install dependencies", () => {
    const section = parity();
    expectPinned(section, [
      "That judgement covers neither the reference's scratch tree, which a ref fills, nor what the program the command names does when it runs, nor a program that is on none of the lists, so a `run` or `setup` that names a script does whatever that script does, a fetch included, and a `setup` that runs a program the lists do not know can install dependencies: review of the declaration is what covers both.",
    ]);
  });

  it("M16 specs/13 F-TEST-9: vetting's judgement covers neither the reference's scratch tree nor what the program the command names does when it runs", () => {
    const section = parity();
    expectClause(section, ['nor what the program the command names does when it runs']);
  });

  it("M16 specs/13 F-TEST-9: timing, memory and concurrency ordering are not compared, a change of installed dependency is not seen where both sides run against one installed copy, the candidate's own build is not checked, and a reference outside the project's history is out of scope", () => {
    const section = parity();
    expectPinned(section, [
      "Timing, memory and concurrency ordering are not compared, a change of installed dependency is not seen where both sides run against one installed copy, the candidate's own build is not checked (FORGE builds nothing for it, so a stale build can read as `match`), and a reference that is not held at a ref in the project's own history is outside this definition.",
    ]);
  });

  it('M16 specs/13 F-TEST-10: change-level binding shows the tests bind to some of the implementation, not to which part', () => {
    const section = hunks();
    expectPinned(section, [
      "F-TEST-5's behavioural binding reverts a story's whole implementation change at once: it shows that the story's tests bind to *something* in the change, not that every part of the change is exercised.",
    ]);
  });

  it('M16 specs/13 F-TEST-10: hunk-level binding is the same mutation at a finer grain — reverse one hunk at a time', () => {
    const section = hunks();
    expectPinned(section, [
      'Hunk-level binding is the same mutation at a finer grain — reverse one hunk at a time and ask whether a test that passed at baseline now fails.',
    ]);
  });

  it('M16 specs/13 F-TEST-10: hunk-level binding is opt-in, bounded and report-only', () => {
    const section = hunks();
    expectPinned(section, ['It is opt-in, bounded, and report-only.']);
  });

  it('M16 specs/13 F-TEST-10: a hunk is a unit of text change between an explicit base and the head, over implementation paths only', () => {
    const section = hunks();
    expectPinned(section, [
      "**A hunk** is a unit of *text* change between an explicit base and the head, over the change's implementation paths only; test files are never mutated.",
    ]);
  });

  it('M16 specs/13 F-TEST-10: a hunk is not a semantic unit — a comment-only or formatting-only hunk is still a hunk', () => {
    const section = hunks();
    expectPinned(section, [
      'It is not a semantic unit: a comment-only or formatting-only hunk is still a hunk.',
    ]);
  });

  it('M16 specs/13 F-TEST-10: the diff algorithm is pinned and recorded in the evidence', () => {
    const section = hunks();
    expectPinned(section, [
      'Hunk boundaries are an artefact of the diff algorithm, so the algorithm is pinned and recorded in the evidence.',
    ]);
  });

  it('M16 specs/13 F-TEST-10: a non-text change is not split into hunks — it is ONE file mutant, a revert of that file as a whole, whose verdict comes from the change-level revert-and-run procedure and which takes the change-level load-failure credit', () => {
    const section = hunks();
    expectPinned(section, [
      'An added or deleted file, a binary file, a mode-only change and any other non-text change is not split into hunks: it is ONE file mutant, a revert of that file as a whole, whose verdict comes from the same revert-and-run procedure as the change-level mutant for that file and which takes the change-level load-failure credit (File-load failures, below).',
    ]);
  });

  it('M16 specs/13 F-TEST-10: a hunk that cannot be reversed against the head is recorded `invalid`, never dropped', () => {
    const section = hunks();
    expectPinned(section, [
      'A hunk that cannot be reversed against the head is recorded `invalid`, never dropped.',
    ]);
  });

  it('M16 specs/13 F-TEST-10: a hunk id is stable for one base/head pair and distinct for textually identical hunks in one file', () => {
    const section = hunks();
    expectPinned(section, [
      '**Requirements on a hunk id.** An id is stable for one base/head pair: two parses of the same pair give the same ids.',
      'Ids are distinct for textually identical hunks in one file.',
    ]);
  });

  it('M16 specs/13 F-TEST-10: the hunk id format is not fixed here — the parser piece fixes it under those two requirements', () => {
    const section = hunks();
    expectPinned(section, [
      'The format is not fixed here; the piece that builds the parser (`specs/22` M16 P11) fixes it under these two requirements.',
    ]);
  });

  it('M16 specs/13 F-TEST-10: each hunk ends in exactly one of five verdicts', () => {
    const section = hunks();
    expectLines(section, ['- **Verdicts.** Each hunk ends in exactly one of five:']);
  });

  it('M16 specs/13 F-TEST-10: `killed` — reversing the hunk made a test that passed at baseline fail', () => {
    const section = hunks();
    expectPinned(section, [
      '`killed` — reversing it made a test that passed at baseline fail with an assertion failure or a crash; the test is named in `killedBy`.',
    ]);
  });

  it('M16 specs/13 F-TEST-10: `uncovered` — every baseline-passing test still passes with the hunk reversed', () => {
    const section = hunks();
    expectPinned(section, [
      '`uncovered` — every baseline-passing test still passes with it reversed.',
    ]);
  });

  it('M16 specs/13 F-TEST-10: `invalid` — an unloadable mutant proves nothing about an assertion', () => {
    const section = hunks();
    expectPinned(section, [
      '`invalid` — the reversal did not apply cleanly, or every failure it caused is a failure to load: a stillborn mutant proves nothing about an assertion.',
    ]);
  });

  it('M16 specs/13 F-TEST-10: `timeout` — the run exceeded its time limit with no killing failure', () => {
    const section = hunks();
    expectPinned(section, ['`timeout` — the run exceeded its time limit with no killing failure.']);
  });

  it('M16 specs/13 F-TEST-10: `skipped` — the run could not proceed, and the reason is recorded', () => {
    const section = hunks();
    expectPinned(section, [
      '`skipped` — the run could not proceed (a failing baseline, for one); the reason is recorded.',
    ]);
  });

  it('M16 specs/13 F-TEST-10: `granularity` says how the text changes were mutated — one mutant per hunk (`hunk`), one per file (`file`) or one for the whole change (`change`)', () => {
    const section = hunks();
    expectPinned(section, [
      '**`granularity`.** The `granularity` a run reports says how it mutated the text changes: one mutant per hunk (`hunk`), one per file (`file`) or one for the whole change (`change`).',
    ]);
  });

  it('M16 specs/13 F-TEST-10: a file that is not split into hunks is a file mutant at `hunk` and at `file`, and at `change` everything is the one mutant', () => {
    const section = hunks();
    expectPinned(section, [
      'A file that is not split into hunks is a file mutant at `hunk` and at `file`; at `change` everything is the one mutant.',
    ]);
  });

  it('M16 specs/13 F-TEST-10: above `--max-hunks` the mode degrades hunk, file, change, and reports the granularity it actually used', () => {
    const section = hunks();
    expectPinned(section, [
      'Above `--max-hunks` the mode degrades hunk → file → change and reports the `granularity` it actually used.',
    ]);
  });

  it('M16 specs/13 F-TEST-10: the mode never samples — a sampled result would read as a verdict on hunks never run', () => {
    const section = hunks();
    expectPinned(section, [
      'It never samples: a sampled result would read as a verdict on hunks that were never run.',
    ]);
  });

  it('M16 specs/13 F-TEST-10: the `--max-hunks` default is not fixed here — P12 chooses it', () => {
    const section = hunks();
    expectPinned(section, [
      'The default for `--max-hunks` is not fixed here: `specs/22` M16 P12 chooses it and states it.',
    ]);
  });

  it('M16 specs/13 F-TEST-10: hunk verdicts are report-only — the exit code follows the change-level result over the same `--base` range', () => {
    const section = hunks();
    expectPinned(section, [
      '**Report-only.** Hunk verdicts never change the exit code, which follows the change-level result over the same `--base` range, by the rule it follows without `--hunks`; the `--json` additions are optional fields and every M15 field is unchanged.',
    ]);
  });

  it('M16 specs/13 F-TEST-10: no default gate threshold ships', () => {
    const section = hunks();
    expectPinned(section, ['No default gate threshold ships.']);
  });

  it('M16 specs/13 F-TEST-10: a project that wants a threshold authors a check over the envelope and takes on three costs', () => {
    const section = hunks();
    expectPinned(section, [
      "A project that wants one authors a check over the `--json` envelope, under `10` §10.3's check contract, and takes on three costs: a comment-only or formatting-only hunk reads `uncovered`, there is no hunk exemption, and attribution is bounded by the story's own tests.",
    ]);
  });

  it('M16 specs/13 F-TEST-10: `--hunks` without `--base` is a usage error, and so is `--base` without `--hunks`', () => {
    const section = hunks();
    expectPinned(section, [
      '**`--base <ref>`** is the explicit base for hunk mode: `--hunks` without it is a usage error, and so is `--base` without `--hunks`.',
    ]);
  });

  it('M16 specs/13 F-TEST-10: `--base` governs the whole run, so the two halves of one `--json` envelope describe one range', () => {
    const section = hunks();
    expectPinned(section, [
      'It governs the whole run, the change-level portion included, so the two halves of one `--json` envelope describe one range.',
    ]);
  });

  it('M16 specs/13 F-TEST-10: without `--hunks` the range is as M15 shipped it', () => {
    const section = hunks();
    expectPinned(section, ['Without `--hunks` the range is as M15 shipped it.']);
  });

  it('M16 specs/13 F-TEST-10: the file-load-failure position is for P10 to confirm by real runs under both test runners, or amend', () => {
    const section = hunks();
    expectPinned(section, [
      '**File-load failures** (the position `specs/22` M16 P10 is to confirm by real runs under both test runners, or amend).',
    ]);
  });

  it("M16 specs/13 F-TEST-10: at change level a revert that makes a test file unloadable credits the file's baseline-passing tests", () => {
    const section = hunks();
    expectPinned(section, [
      "At change level a revert that makes a test file unloadable credits the baseline-passing tests of that file under both runners — a new module's tests cannot load without the module, and M15's shipped vitest behaviour already credits it.",
    ]);
  });

  it('M16 specs/13 F-TEST-10: at hunk level a text hunk whose reversal makes a file unloadable is `invalid`, not `killed`', () => {
    const section = hunks();
    expectPinned(section, [
      'At hunk level a text hunk whose reversal makes a file unloadable is `invalid`, not `killed`.',
    ]);
  });

  it('M16 specs/13 F-TEST-10: the file-load-failure rule follows the kind of mutant, whatever `granularity` the run reports — a hunk mutant is `invalid` for it, a file mutant and the whole-change mutant take the change-level credit', () => {
    const section = hunks();
    expectPinned(section, [
      'The rule follows the kind of mutant, whatever `granularity` the run reports: a hunk mutant is `invalid` for it, and a file mutant and the whole-change mutant take the change-level credit.',
    ]);
  });

  it("M16 specs/13 F-TEST-10: N hunks cost N + 3 runs of the story's test command", () => {
    const section = hunks();
    expectPinned(section, [
      "**Cost.** N hunks cost N + 3 runs of the story's test command (baseline, revert, restore, and one per hunk), which is why the mode is opt-in and bounded.",
    ]);
  });

  it('M16 specs/03 §3.2.5: the `forge parity capture` row — observe the reference at its declared ref in a scratch worktree and write the content-addressed capture', () => {
    const section = spec03();
    expectPinned(section, [
      '| `forge parity capture [--name <name>]` | (Post-v1.0, `specs/22` M16; not wired yet.) Observe the reference a parity declaration names, at its declared ref and in a scratch worktree, and write the content-addressed capture under `.forge/parity/captures/` (`13` F-TEST-9).',
    ]);
  });

  it('M16 specs/03 §3.2.5: `forge parity capture` is a human act — no workflow runs it, and it refuses whenever the FORGE session marker `FORGE_RUN_ID` is present, whichever run it names (the marker `10` §10.3 rule 6 defines is an honest-session signal, not a security boundary)', () => {
    const section = spec03();
    expectPinned(section, [
      'A human act: no workflow runs it, and it refuses whenever the FORGE session marker `FORGE_RUN_ID` is present, whichever run it names (`10` §10.3 rule 6 defines the marker, an honest-session signal and not a security boundary).',
    ]);
  });

  it('M16 specs/03 §3.2.5: `forge parity capture` without `--name` captures every declaration, and a `--name` that matches no declaration is refused', () => {
    const section = spec03();
    expectPinned(section, [
      'Without `--name`, every declaration; a `--name` that matches no declaration is refused.',
    ]);
  });

  it('M16 specs/03 §3.2.5: capturing identical behaviour again changes nothing, and a differing capture for the same key is refused, never overwritten', () => {
    const section = spec03();
    expectPinned(section, [
      'Capturing identical behaviour again changes nothing; a capture that would differ from an existing one for the same key is refused, never overwritten.',
    ]);
  });

  it("M16 specs/03 §3.2.5: the `forge parity check` row takes `--story <id>` and `--no-record` — compare the candidate with each declaration's selected capture and write one record for the invocation unless given `--no-record`, which writes none", () => {
    const section = spec03();
    expectPinned(section, [
      "| `forge parity check [--name <name>] [--trusted <ref>] [--story <id>] [--no-record]` | (Post-v1.0, `specs/22` M16; not wired yet.) Compare the candidate, observed in place, with each declaration's selected capture, and write one `ParityEvidence` record for the invocation (`18` §18.7) unless given `--no-record`, which writes none.",
    ]);
  });

  it('M16 specs/03 §3.2.5: `--trusted <ref>` names the trust anchor, a full commit sha or a ref name that begins `refs/` and that `git check-ref-format` accepts — everything under `.forge/parity/` is compared, as it is on disk, with the tree at that ref, a difference is `oracle-changed`, and without it nothing is compared and the record says `trusted: null`', () => {
    const section = spec03();
    expectPinned(section, [
      '`--trusted <ref>` names the trust anchor, a full commit sha or a ref name that begins `refs/` and that `git check-ref-format` accepts: everything under `.forge/parity/` is compared, as it is on disk, with the tree at that ref, and a difference is `oracle-changed` (`13` F-TEST-9); without it nothing is compared and the record says `trusted: null`.',
    ]);
  });

  it('M16 specs/03 §3.2.5: `--story <id>` names the story the parity record is for', () => {
    const section = spec03();
    expectPinned(section, ['`--story <id>` names the story the record is for.']);
  });

  it('M16 specs/03 §3.2.5: `forge parity check` exits 0 only when no verdict is failing', () => {
    const section = spec03();
    expectPinned(section, ['Exit 0 only when no verdict is failing.']);
  });

  it('M16 specs/03 §3.2.5: no-declarations and nothing-compared each fail with a reason rather than passing, and a `--name` that matches no declaration, or a `--trusted` that is not in that form or does not resolve, is refused', () => {
    const section = spec03();
    expectPinned(section, [
      'No declaration (`no-declarations`) and nothing compared (`nothing-compared`) each fail with a `reason` rather than passing; a `--name` that matches no declaration, and a `--trusted` that is not in that form or does not resolve, are refused.',
    ]);
  });

  it('M16 specs/03 §3.2.5: `forge parity check` is the one deterministic check, `behavior:parity`, of the gate `G-Parity`, which runs it as `forge parity check --json --no-record --trusted refs/heads/main`', () => {
    const section = spec03();
    expectPinned(section, [
      'It is the one deterministic check, `behavior:parity`, of the workflow-scoped gate `G-Parity` (`10` §10.3 rule 8), which runs it as `forge parity check --json --no-record --trusted refs/heads/main`.',
    ]);
  });

  it('M16 specs/03 §3.2.5: the `forge evidence prune` row — retention for the three evidence types', () => {
    const section = spec03();
    expectPinned(section, [
      '| `forge evidence prune [--apply] [--keep <n>]` | (Post-v1.0, `specs/22` M16; not wired yet.) Retention for `MutationEvidence`, `EvidenceBundle` and `ParityEvidence` records (`18` §18.7, Retention).',
    ]);
  });

  it('M16 specs/03 §3.2.5: `forge evidence prune` is a dry run unless `--apply`, which refuses whenever the FORGE session marker `FORGE_RUN_ID` is present, as `forge parity capture` does', () => {
    const section = spec03();
    expectPinned(section, [
      'A dry run unless `--apply`, which refuses whenever the FORGE session marker `FORGE_RUN_ID` is present, as `forge parity capture` does.',
    ]);
  });

  it('M16 specs/03 §3.2.5: `--keep <n>` keeps the n highest-id records per type and subject, n an integer of at least 1, default 5', () => {
    const section = spec03();
    expectPinned(section, [
      '`--keep <n>` keeps the `n` newest (highest-id) records per type and subject, `n` an integer of at least 1, default 5.',
    ]);
  });

  it('M16 specs/03 §3.2.5: the highest id of each type, and any record something still references, is never pruned — what is referenced is computed to a fixed point, and a prune that cannot enumerate every store that can hold an evidence id refuses and removes nothing', () => {
    const section = spec03();
    expectPinned(section, [
      'The highest id of each type, and any record something still references, is never pruned; what is referenced is computed to a fixed point, and a prune that cannot enumerate every store that can hold an evidence id refuses and removes nothing.',
    ]);
  });

  it('M16 specs/03 §3.2.5: the `forge test binding --hunks` row — behavioural binding at hunk granularity', () => {
    const section = spec03();
    expectPinned(section, [
      '| `forge test binding --story <id> --hunks --base <ref> [--max-hunks <n>]` | (Post-v1.0, `specs/22` M16; not wired yet.) The `--hunks` form of `forge test binding`: behavioural binding at hunk granularity rather than for the change as a whole (`13` F-TEST-10).',
    ]);
  });

  it('M16 specs/03 §3.2.5: `--hunks` requires `--base`, and `--base` without `--hunks` is a usage error', () => {
    const section = spec03();
    expectPinned(section, [
      '`--hunks` requires `--base`, and `--base` without `--hunks` is a usage error.',
    ]);
  });

  it('M16 specs/03 §3.2.5: above `--max-hunks` the form degrades to file or change granularity and says so', () => {
    const section = spec03();
    expectPinned(section, [
      'Above `--max-hunks` it degrades to file or change granularity and says so.',
    ]);
  });

  it('M16 specs/03 §3.2.5: the `--hunks` form is report-only — the exit code follows the change-level result over the same `--base` range', () => {
    const section = spec03();
    expectPinned(section, [
      'Report-only: the exit code follows the change-level result over the same `--base` range, by the rule it follows without `--hunks`.',
    ]);
  });

  it('M16 specs/03 §3.2.5: the `forge test <sub>` row lists `binding` and `exempt`, which M15 wired and the row omitted before M16', () => {
    const section = spec03();
    expectPinned(section, [
      'Before M16 the `forge test <sub>` row omitted `binding` and `exempt`, both wired since `specs/22` M15 (`forge test binding [--story <id>]` reports behavioural binding, `13` F-TEST-5; `forge test exempt <storyId> <testId> --reason <text> --owner <identifier> --expires <iso-date>` records an exemption, `13` F-TEST-8).',
      'That omission predates M16; the row now lists them.',
    ]);
    expectLines(section, [
      '| `forge test <sub>` | `plan`, `generate`, `run`, `report`, `flaky`, `coverage`, `binding`, `exempt`, `adopt` (post-v1.0, `specs/22` M17) |',
    ]);
  });

  it('M16 specs/03 §3.2.5: each of the four M16 commands takes the global `--json` flag and prints one `{"v":1,...}` object', () => {
    const section = spec03();
    expectPinned(section, [
      'Each of the four M16 commands above takes the global `--json` flag (§3.2) and prints one `{"v":1,...}` object (§3.5).',
    ]);
  });

  it('M16 specs/03 §3.2.5: the retention default of 5 follows §3.4\'s "retain last 5" backups', () => {
    const section = spec03();
    expectPinned(section, ['The retention default of 5 follows §3.4\'s "retain last 5" backups.']);
  });

  it('M16 specs/17 §17.2: the `BASELINE` tag is a legitimate `reference.ref` for a parity declaration', () => {
    const section = spec17('## 17.2 ');
    expectPinned(section, [
      '(Post-v1.0, `specs/22` M16.) The `BASELINE` tag is a legitimate `reference.ref` for a parity declaration (`13` F-TEST-9): it marks the system as found, which is a valid reference for the refactoring that follows adoption (§17.4, item 3).',
    ]);
  });

  it('M16 specs/17 §17.2: `adopt` creates the tag at HEAD only when the pipeline reaches this phase and the repository has a commit, and never moves an existing tag', () => {
    const section = spec17('## 17.2 ');
    expectPinned(section, [
      '`adopt` creates the tag at HEAD as of that adoption, and only when the pipeline reaches this phase and the repository has a commit: not under `--depth quick`, not when a size-gated survey answers a run given no `--scope` with a scoped proposal, and never again once a `BASELINE` tag exists, since an existing tag is neither recreated nor moved.',
    ]);
  });

  it('M16 specs/17 §17.2: a declaration naming `BASELINE` names the commit of the adoption that created it, and a repository with no such tag has none to name', () => {
    const section = spec17('## 17.2 ');
    expectPinned(section, [
      'A declaration that names it therefore names the commit of the adoption that created it, and a repository with no such tag has none to name.',
    ]);
  });

  it('M16 specs/17 §17.2: this builds no `adopt` wiring — G-Adopt stays in-process and the adopt workflow gains no gate step', () => {
    const section = spec17('## 17.2 ');
    expectPinned(section, [
      'This builds no `adopt` wiring: `G-Adopt` is evaluated in-process and has no gate file, and the `adopt` workflow gains no gate step.',
    ]);
  });

  it('M16 specs/17 §17.4 item 3: the system as found is a valid reference only as a reviewed, immutable one', () => {
    const section = spec17('## 17.4 ');
    expectPinned(section, [
      '(Post-v1.0, `specs/22` M16.) The system as found is a valid reference for that comparison, but only as a *reviewed, immutable* one (`13` F-TEST-9): a parity declaration whose `reference.ref` names the commit that holds the system as found, captured by a human act, never a recording the refactoring agent makes of the code it is about to change.',
    ]);
  });

  it('M16 specs/17 §17.4 item 3: the `BASELINE` tag adoption creates is a legitimate `reference.ref`, where one exists', () => {
    const section = spec17('## 17.4 ');
    expectPinned(section, [
      "The `BASELINE` tag that adoption's phase 8 creates (§17.2) is a legitimate `reference.ref`, where one exists.",
    ]);
  });

  it('M16 specs/18 §18.2: the on-disk layout lists `.forge/parity/` as committed — declarations, probes, captures', () => {
    const section = spec18('## 18.2 ');
    expectLines(section, [
      '│  ├─ parity/                        committed: parity declarations, probes, captures (13 F-TEST-9)',
    ]);
  });

  it('M16 specs/18 §18.4: `v` versions the envelope and nothing else, and a log carrying any other `v` is refused', () => {
    const section = spec18('## 18.4 ');
    expectPinned(section, [
      '**Payload versioning (post-v1.0, `specs/22` M16).** `v` versions the envelope and nothing else: it is the field of `ForgeEvent` above, and a log whose events carry any other `v` is refused by the reader, not guessed at.',
    ]);
  });

  it('M16 specs/18 §18.4: no payload carries a version of its own', () => {
    const section = spec18('## 18.4 ');
    expectPinned(section, ['No payload carries a version of its own.']);
  });

  it("M16 specs/18 §18.4: a payload's shape is selected by its event `type` and, for `CheckRun`, its `kind`, checked first and explicitly", () => {
    const section = spec18('## 18.4 ');
    expectPinned(section, [
      "A payload's shape is selected by its event `type` and, for `CheckRun`, by its `kind` (`'binding'` and `'exemption-declared'` from M15, `'parity'` from M16), checked first and explicitly, never inferred from which other fields happen to be present.",
    ]);
  });

  it('M16 specs/18 §18.4: adding a `kind`, or an optional field to an existing `kind`, is additive and leaves `v` at 1', () => {
    const section = spec18('## 18.4 ');
    expectPinned(section, [
      'Adding a `kind`, or adding an optional field to an existing `kind`, is additive and leaves `v` at 1: a reader skips a `kind` it does not recognise, reads an optional field only when it is present and well-typed, and ignores a field it does not know.',
    ]);
  });

  it('M16 specs/18 §18.4: a change that is not additive takes a new `kind` and never reinterprets an existing one', () => {
    const section = spec18('## 18.4 ');
    expectPinned(section, [
      'A change that is not additive (a field changing its meaning or its type, a required field appearing) takes a new `kind` and never reinterprets an existing one.',
    ]);
  });

  it("M16 specs/18 §18.4: a `'parity'` payload is written only where the run's id reaches the command in FORGE_RUN_ID and the command can name the run's own project root", () => {
    const section = spec18('## 18.4 ');
    expectPinned(section, [
      "A `'parity'` payload carries the count per verdict, the total, the evidence id (null for a check run with `--no-record`) and the declaration names, never an observation, and, like the other kinds, it is written only where the run's id reaches the command in `FORGE_RUN_ID` and the command can name the run's own project root; a hunk run's counts and `granularity` are optional fields on the existing `'binding'` payload.",
    ]);
  });

  it('M16 specs/18 §18.7: the registry row for ParityEvidence -- id, idPrefix PAR, and its path', () => {
    const section = spec18('## 18.7 ');
    expectLines(section, [
      '  - { id: ParityEvidence, idPrefix: PAR, path: "reports/parity/{id}-{slug}.md" }',
    ]);
  });

  it('M16 specs/18 §18.7: "superseded" means what it means for an ADR — an older instance stays on disk until `forge evidence prune` removes it', () => {
    const section = spec18('## 18.7 ');
    expectPinned(section, [
      '"Superseded" means exactly what it means for an ADR (`08` §8.3/§8.4\'s `status: superseded` convention): an older instance stays on disk, readable, until `forge evidence prune` removes it (§18.7, Retention), and a newer one exists; nothing here claims a bundle is a single revised document the way a Story is (an earlier draft of this entry wrongly claimed that — see `SPEC-QUESTIONS.md` Q280\'s round-2 record — and separately miscited `18` §18.8 as defining "superseded," which it does not; the real definition is `08`\'s).',
    ]);
  });

  it('M16 specs/18 §18.7: ParityEvidence was added post-v1.0 by the same checklist as the other evidence types', () => {
    const section = spec18('## 18.7 ');
    expectPinned(section, [
      "`ParityEvidence` was added post-v1.0 (`specs/22` M16), the same way and by the same checklist: a real capability (`13` F-TEST-9's parity oracles) that needed a committed, typed artifact.",
    ]);
  });

  it('M16 specs/18 §18.7: ParityEvidence has a registry entry, a JSON Schema, a template and no graph edge beyond an optional `story` id', () => {
    const section = spec18('## 18.7 ');
    expectPinned(section, [
      'It has the registry entry above, a JSON Schema, a template, and no graph edge declaration beyond an optional `story` id: like `MutationEvidence` and `EvidenceBundle` it is outside the traceability chain of `09` §9.4, and unlike them it has no `parent`.',
    ]);
  });

  it("M16 specs/18 §18.7: ParityEvidence is append-only — one `forge parity check` invocation writes one `PAR-<n>` record, however many declarations it checks, and none when it is given `--no-record`, as the `G-Parity` gate's check is", () => {
    const section = spec18('## 18.7 ');
    expectPinned(section, [
      "(What `{slug}` names is settled when the type is built, `specs/22` M16 P5.) It is **append-only** exactly as they are: one `forge parity check` invocation writes one `PAR-<n>` record, however many declarations it checks (none, when it is given `--no-record`, as the `G-Parity` gate's check is: `13` F-TEST-9), and a write to an existing path is refused, never an edit.",
    ]);
  });

  it("M16 specs/18 §18.7: the record body carries a `declarations` list, in order of `name`, each entry holding the declaration's verdict and, where that is not match, its reason", () => {
    const section = spec18('## 18.7 ');
    expectPinned(section, [
      "The record's body carries a `declarations` list, in order of `name`, each entry holding the declaration's name and digest, the reference's ref and sha, the platform, the digest of the capture it selected, its verdict and, where that is not `match`, its `reason`, the verdict and content hashes of each case, and its exempt count.",
    ]);
  });

  it("M16 specs/18 §18.7: beside that list the record holds `headSha`, `dirty`, the delta digest, `trusted`, the overall verdict, the check's own `reason` where the check itself stopped, and tool versions", () => {
    const section = spec18('## 18.7 ');
    expectPinned(section, [
      "Beside that list the record holds the candidate's `headSha`, `dirty` flag and delta digest, `trusted` (the trust anchor's sha, or null: `13` F-TEST-9), the overall verdict, the check's own `reason` where the check itself stopped (`no-declarations`, `oracle-changed`), and tool versions.",
    ]);
  });

  it("M16 specs/18 §18.7: a parity record's `story`, when `forge parity check` is given `--story <id>`, is its retention subject", () => {
    const section = spec18('## 18.7 ');
    expectPinned(section, [
      'Its `story`, when `forge parity check` is given `--story <id>`, is its retention subject (Retention, below).',
    ]);
  });

  it('M16 specs/18 §18.7: the record holds names, digests, verdicts and hashes, never an observed value', () => {
    const section = spec18('## 18.7 ');
    expectPinned(section, [
      'It holds names, digests, verdicts and hashes, never an observed value (`13` F-TEST-9).',
    ]);
  });

  it('M16 specs/18 §18.7: the `platform` of a `declarations` entry is `<os>-<arch>` of its capture, not the agent platform', () => {
    const section = spec18('## 18.7 ');
    expectPinned(section, [
      "The `platform` of a `declarations` entry is the operating system and architecture its capture was taken on, `<os>-<arch>`; it is not the agent platform of §18.3's `platform` block or the ledger's `platform` column.",
    ]);
  });

  it('M16 specs/18 §18.7: a parity capture is not a registry artifact, and the id scan never lists it', () => {
    const section = spec18('## 18.7 ');
    expectPinned(section, [
      'A parity capture is not a registry artifact: it is a content-addressed JSON file with no front matter under `.forge/parity/captures/` (§18.2), which the id scan never lists, because it reads `.md` files only and skips `.forge` (`packages/core/src/ids/scan.ts`).',
    ]);
  });

  it("M16 specs/18 §18.7: M16 P5 must show that no validation or health check flags a PAR record or a capture, unless its text holds a secret reference that `forge doctor`'s secret-references check scans for", () => {
    const section = spec18('## 18.7 ');
    expectPinned(section, [
      "`specs/22` M16 P5 must show, by a test over a project holding both, that no validation or health check flags a `PAR` record or a capture, unless its text holds a `${secret:NAME}` reference: `forge doctor`'s `secret-references` check scans every `.yaml`, `.yml`, `.md` and `.json` file under `.forge/` (outside `.forge/state`) and `docs/forge/` for those, so a declaration, a capture or a record that holds one draws its warning.",
    ]);
  });

  it('M16 specs/18 §18.7: `EvidenceBundle` gains an optional `parityEvidence` list, a bundle without it stays valid, and M16 changes no bundle assembler, so nothing populates it yet', () => {
    const section = spec18('## 18.7 ');
    expectPinned(section, [
      '`EvidenceBundle` gains an optional `parityEvidence` list, the ids of the `ParityEvidence` records a bundle rests on, beside its `bindingEvidence`; a bundle without it stays valid, and M16 changes no bundle assembler, so nothing populates it yet.',
    ]);
  });

  it('M16 specs/18 §18.7: `MutationEvidence` gains a second shape for hunk-level mutation, `mutationKind: revert-hunks`', () => {
    const section = spec18('## 18.7 ');
    expectPinned(section, [
      '`MutationEvidence` gains a second shape for hunk-level mutation (`13` F-TEST-10), which its field list above already anticipated ("the exact commit range or hunk set reverted"): its `mutationKind` has a second member, `revert-hunks`, beside `revert-implementation`, and a record of that kind carries, beyond what schema version 1 records, the base sha the hunks were taken against, the diff algorithm, the `granularity` used (`hunk`, `file` or `change`) and the hunk list: each hunk\'s id, path, ranges, content hash, verdict and `killedBy`.',
    ]);
  });

  it('M16 specs/18 §18.7: a hunk run is its own new record, and an existing change-level record is never rewritten', () => {
    const section = spec18('## 18.7 ');
    expectPinned(section, [
      'A hunk run is its own new record; an existing change-level record is never rewritten to add one.',
    ]);
  });

  it('M16 specs/18 §18.7: a record using a version-2 field carries `schemaVersion: 2`, and two migrations, both 1→2, are added', () => {
    const section = spec18('## 18.7 ');
    expectPinned(section, [
      'A record that uses a field schema version 1 lacks carries `schemaVersion: 2` (§18.6), and two migrations (§18.9) are added with those fields, both `1→2`: `MutationEvidence` and `EvidenceBundle`.',
    ]);
  });

  it('M16 specs/18 §18.7: each migration sets schemaVersion: 2 going up and changes nothing else, is pure, and is covered by a golden-file test whose after differs from its before by schemaVersion at least', () => {
    const section = spec18('## 18.7 ');
    expectPinned(section, [
      'Each sets `schemaVersion: 2` going up and changes nothing else (a version-1 record is otherwise already a valid version-2 record), is pure, and is covered by a golden-file test with a real "before" fixture, as §18.9 requires: the fixture\'s "after" differs from its "before" by `schemaVersion` at least.',
    ]);
  });

  it('M16 specs/18 §18.7: whether either migration declares reversible: true is settled when it is written; one that does removes the version-2 fields going down, and a hunk-level MutationEvidence record has no version-1 form so a reversible migration refuses it going down', () => {
    const section = spec18('## 18.7 ');
    expectPinned(section, [
      'Whether either declares `reversible: true` is settled when it is written (`specs/22` M16 P5); one that does removes the version-2 fields and sets `schemaVersion: 1` going down, and a hunk-level `MutationEvidence` record has no version-1 form (`revert-hunks` is not a version-1 `mutationKind`), so that migration, if reversible, refuses such a record going down rather than stripping it.',
    ]);
  });

  it('M16 specs/18 §18.7: as built, `forge upgrade` lists only documents under the specs root, so version-1 evidence stays version 1 on disk', () => {
    const section = spec18('## 18.7 ');
    expectPinned(section, [
      'As built, the artifact-migration step of `forge upgrade` (`03` §3.4, step 4) lists only the documents under the specs root (`packages/cli/src/commands/upgrade/migrate-artifacts.ts`), so a record under `reports/` is not reached by it: version-1 evidence stays version 1 on disk.',
    ]);
  });

  it('M16 specs/18 §18.7: until a migration has run, every reader of these two types must accept `schemaVersion` 1 and 2', () => {
    const section = spec18('## 18.7 ');
    expectPinned(section, [
      'Until a migration has run, every reader of these two types must accept `schemaVersion` 1 and 2 (`specs/22` M16 P5).',
    ]);
  });

  it('M16 specs/18 §18.7 Retention: evidence files accumulate — every run writes a new one and none is edited', () => {
    const section = spec18('## 18.7 ');
    expectPinned(section, [
      '**Retention (post-v1.0, `specs/22` M16).** Evidence files accumulate: every run writes a new one and none is edited.',
    ]);
  });

  it('M16 specs/18 §18.7 Retention: `forge evidence prune` is the retention policy M15 P7 deferred', () => {
    const section = spec18('## 18.7 ');
    expectPinned(section, [
      '`forge evidence prune` (`03` §3.2.5) is the retention policy `specs/22` M15 P7 deferred.',
    ]);
  });

  it('M16 specs/18 §18.7 Retention: it manages three types — MutationEvidence, EvidenceBundle and ParityEvidence — and nothing else', () => {
    const section = spec18('## 18.7 ');
    expectPinned(section, [
      'It manages three types, `MutationEvidence`, `EvidenceBundle` and `ParityEvidence`, and nothing else.',
    ]);
  });

  it('M16 specs/18 §18.7 Retention: it never prunes a parity capture, a collection-shaped artifact, the event log or the tombstones', () => {
    const section = spec18('## 18.7 ');
    expectPinned(section, [
      "It never prunes a parity capture (the oracle's baseline, not its evidence), a collection-shaped artifact, the event log, or the tombstones below.",
    ]);
  });

  it('M16 specs/18 §18.7 Retention: it is a dry run by default — a dry run writes nothing, and only `--apply` removes anything', () => {
    const section = spec18('## 18.7 ');
    expectPinned(section, [
      'It is a dry run by default: a dry run writes nothing and names what it would remove, and only `--apply` removes anything.',
    ]);
  });

  it('M16 specs/18 §18.7 Retention: `--apply` refuses whenever the FORGE session marker `FORGE_RUN_ID` is present, whichever run it names, because a prune is a human act as `forge parity capture` is', () => {
    const section = spec18('## 18.7 ');
    expectPinned(section, [
      '`--apply` refuses whenever the FORGE session marker `FORGE_RUN_ID` is present, whichever run it names (`10` §10.3 rule 6 defines the marker, an honest-session signal and not a security boundary), because a prune is a human act, as `forge parity capture` is: a run must not be able to discard the evidence about its own work.',
    ]);
  });

  it('M16 specs/18 §18.7 Retention: a dry run is always allowed, even inside a run', () => {
    const section = spec18('## 18.7 ');
    expectPinned(section, ['A dry run is always allowed.']);
  });

  it('M16 specs/18 §18.7 Retention: `--keep <n>` keeps the newest n records per type and subject, the subject being the story id, else the single shared subject `project`', () => {
    const section = spec18('## 18.7 ');
    expectPinned(section, [
      '`--keep <n>` keeps the newest `n` records per type and subject: the story id when the record was written for a story, else the single shared subject `project`.',
    ]);
  });

  it("M16 specs/18 §18.7 Retention: newest means highest id, compared as a number, never a file's modification time", () => {
    const section = spec18('## 18.7 ');
    expectPinned(section, [
      "Newest means highest id, compared as a number (§18.8), never a file's modification time.",
    ]);
  });

  it("M16 specs/18 §18.7 Retention: n is an integer of at least 1 and defaults to 5, the precedent being §3.4's last 5 backups", () => {
    const section = spec18('## 18.7 ');
    expectPinned(section, [
      "`n` is an integer of at least 1 (0, a negative number and a non-integer are refused) and defaults to 5, the precedent being `03` §3.4's retention of the last 5 backups.",
    ]);
  });

  it("M16 specs/18 §18.7 Retention: the highest id of each type is never pruned, and that is stated on its own because the allocator's no-reuse guarantee rests on it", () => {
    const section = spec18('## 18.7 ');
    expectPinned(section, [
      'The highest id of each type is never pruned.',
      "`n` of at least 1 already implies it; it is stated on its own because the allocator's no-reuse guarantee rests on it (§18.8: allocation is a scan of what exists).",
    ]);
  });

  it('M16 specs/18 §18.7 Retention: a record that anything still references is protected and reported with the reason', () => {
    const section = spec18('## 18.7 ');
    expectPinned(section, [
      'A record that anything still references is protected and reported with the reason.',
    ]);
  });

  it('M16 specs/18 §18.7 Retention: what survives is computed to a fixed point, so a record referenced only by a record this prune removes is not protected and the outcome does not depend on visiting order', () => {
    const section = spec18('## 18.7 ');
    expectPinned(section, [
      'What survives is computed to a fixed point: it starts from the records `--keep` and the highest-id rule keep, and adds every record that a surviving record, or a store outside the evidence records, references, until nothing more is added.',
      'A record referenced only by a record this prune removes is therefore not protected, and the outcome does not depend on the order in which records are visited.',
    ]);
  });

  it('M16 specs/18 §18.7 Retention: the stores that can hold an evidence id are enumerated and tested when the command is built', () => {
    const section = spec18('## 18.7 ');
    expectPinned(section, [
      "The stores that can hold an evidence id (a surviving `EvidenceBundle`, a gate approval or waiver under `10` §10.3's evidence resolution, and whatever else the command's own enumeration finds) are enumerated and tested when it is built (`specs/22` M16 P14).",
    ]);
  });

  it('M16 specs/18 §18.7 Retention: a prune that cannot enumerate every store that can hold an evidence id refuses and removes nothing', () => {
    const section = spec18('## 18.7 ');
    expectPinned(section, [
      'A prune that cannot enumerate every store that can hold an evidence id, because one is unreadable or does not parse, refuses and removes nothing: a reference it could not see is one it could break.',
    ]);
  });

  it('M16 specs/18 §18.7 Retention: pruning a record is two steps in a fixed order — the tombstone is created first, atomically (written whole to a temporary file and renamed into place), the removal second', () => {
    const section = spec18('## 18.7 ');
    expectPinned(section, [
      'Pruning a record is two steps in a fixed order.',
      "A tombstone for its id (`docs/forge/reports/pruned/<id>.json`: the id, the type, the subject, the record's sha256 and the time) is created first, atomically (written whole to a temporary file beside it and renamed into place, so one that exists is never partial); the record is removed second.",
    ]);
  });

  it('M16 specs/18 §18.7 Retention: a crash between the two steps leaves a pending removal, a tombstone with its record still present', () => {
    const section = spec18('## 18.7 ');
    expectPinned(section, [
      'A crash between the two leaves a pending removal, a tombstone with its record still present.',
    ]);
  });

  it('M16 specs/18 §18.7 Retention: while both exist the record wins — a reference resolves to the record, never to "pruned"', () => {
    const section = spec18('## 18.7 ');
    expectPinned(section, [
      'While both exist the record wins: a reference to the id resolves to the record, never to "pruned".',
    ]);
  });

  it('M16 specs/18 §18.7 Retention: a later prune completes a pending removal only if that record is still selected for removal by that prune', () => {
    const section = spec18('## 18.7 ');
    expectPinned(section, [
      'A later prune completes a pending removal only if that record is still selected for removal by that prune; otherwise the record stays.',
    ]);
  });

  it('M16 specs/18 §18.7: the stores are enumerated a second time after the tombstones are written and before any record is removed, so a reference written after that second enumeration is not seen and --apply is not safe to run while a run or approval that could cite a removed record is in progress', () => {
    const section = spec18('## 18.7 ');
    expectPinned(section, [
      'The stores are enumerated once more after the tombstones are written and before any record is removed, and a record that has been referenced since the first enumeration is not removed (its tombstone stays, a pending removal as above); a reference written after that second enumeration is not seen, so `--apply` is not safe to run while a run or an approval that could cite a record it removes is in progress.',
    ]);
  });

  it('M16 specs/18 §18.7 Retention: a repeated or concurrent prune is idempotent', () => {
    const section = spec18('## 18.7 ');
    expectPinned(section, ['A repeated or concurrent prune is idempotent.']);
  });

  it('M16 specs/18 §18.7 Retention: a reference to a pruned id resolves to a distinct "pruned" answer that names the tombstone', () => {
    const section = spec18('## 18.7 ');
    expectPinned(section, [
      'A reference to an id that has been pruned (its record removed) resolves to a distinct "pruned" answer that names the tombstone, never to "dangling".',
    ]);
  });

  it('M16 specs/18 §18.7 Retention: whether the id allocator also reads the tombstones is decided when the command is built, and an id is never issued twice either way', () => {
    const section = spec18('## 18.7 ');
    expectPinned(section, [
      'Whether the id allocator also reads the tombstones is decided when the command is built (`specs/22` M16 P14); either way an id is never issued twice.',
    ]);
  });

  it('M16 specs/18 §18.8: deleted artifacts become `status: deprecated` and their files are retained', () => {
    const section = spec18('## 18.8 ');
    expectPinned(section, [
      '**Never reused.** Deleted artifacts become `status: deprecated` and their files are retained.',
    ]);
  });

  it('M16 specs/18 §18.8: for the three evidence types, "files are retained" holds until `forge evidence prune` removes a file after writing a tombstone, and the id stays spent', () => {
    const section = spec18('## 18.8 ');
    expectPinned(section, [
      '(Post-v1.0, `specs/22` M16.) For the three retention-managed evidence types (§18.7, Retention), "files are retained" holds until `forge evidence prune` removes a file, which it does only after writing a tombstone for the id: the file may go, but the id stays spent, and the highest id of each type is never pruned.',
    ]);
  });

  it('M16 specs/18 §18.8: a parity capture is not an artifact with an id, and `forge evidence prune` never touches it and FORGE never deletes it', () => {
    const section = spec18('## 18.8 ');
    expectPinned(section, [
      'A parity capture (`13` F-TEST-9) is not an artifact with an id; it is a content-addressed file that `forge evidence prune` never touches and FORGE never deletes.',
    ]);
  });

  it('M16 specs/13 F-TEST-9: the section is titled as the differential and reference-implementation oracles made normative, post-v1.0', () => {
    const section = parity();
    expectLines(section, [
      '### F-TEST-9 · Parity oracles: the differential and reference-implementation oracles made normative (post-v1.0, `specs/22` M16)',
    ]);
  });

  it('M16 specs/13 F-TEST-10: the section is titled hunk-level behavioural binding, post-v1.0', () => {
    const section = hunks();
    expectLines(section, [
      '### F-TEST-10 · Hunk-level behavioural binding (post-v1.0, `specs/22` M16)',
    ]);
  });

  it('M16 specs/22: the entry has an Exit tests block, which the runner line and the two parity runs sit under', () => {
    const section = spec22M16();
    expectLines(section, ['**Exit tests**']);
  });

  it("M16 specs/03, specs/10 and specs/13 cross-spec clause: the `G-Parity` gate's one check is `forge parity check --json --no-record --trusted refs/heads/main`, spelled the same in all three", () => {
    expectClause(spec03(), ['`forge parity check --json --no-record --trusted refs/heads/main`']);
    expectClause(spec10Gates(), [
      '`forge parity check --json --no-record --trusted refs/heads/main`',
    ]);
    expectClause(parity(), ['`forge parity check --json --no-record --trusted refs/heads/main`']);
  });

  it('M16 specs/03 and specs/13 cross-spec clause: the `--trusted` ref is a full commit sha or a ref name that begins `refs/` and that `git check-ref-format` accepts, worded the same in both', () => {
    expectClause(spec03(), [
      'a full commit sha or a ref name that begins `refs/` and that `git check-ref-format` accepts',
    ]);
    expectClause(parity(), [
      'a full commit sha or a ref name that begins `refs/` and that `git check-ref-format` accepts',
    ]);
  });

  it('M16 specs/10 and specs/13 cross-spec clause: a declaration that compares nothing is one with no surface that is not exempt, and spec 03 names the reason `nothing-compared` the same way', () => {
    expectClause(spec10Gates(), [
      'it has no surface that is not exempt as `unobservable` (`nothing-compared`)',
    ]);
    expectClause(parity(), ['(`nothing-compared`: it has no surface that is not exempt)']);
    expectClause(spec03(), ['nothing compared (`nothing-compared`)']);
  });

  it('M16 specs/10 and specs/13 cross-spec clause: a check that would print no passing and no failing case is refused, and each spec says so in its own words', () => {
    expectClause(spec10Gates(), [
      'A check that would print no passing and no failing case is refused (`ok: false`) instead',
    ]);
    expectClause(parity(), [
      'A check that would still print 0 passing and 0 failing is a refusal instead',
    ]);
  });

  it('M16 specs/10 and specs/13 cross-spec clause: by hand, `forge gate check G-Parity` runs the same command, so it compares with trunk too', () => {
    expectClause(spec10Gates(), [
      '`forge gate check G-Parity` runs the same command, so it compares with trunk too',
    ]);
    expectClause(parity(), [
      '`forge gate check G-Parity` runs the same command, so it compares with trunk too',
    ]);
  });

  it('M16 specs/03, specs/13 and specs/18 cross-spec clause: the commands that refuse under the FORGE session marker `FORGE_RUN_ID` say so in the same words and cite rule 6 as defining it', () => {
    expectClause(spec03(), [
      'it refuses whenever the FORGE session marker `FORGE_RUN_ID` is present, whichever run it names',
      '`--apply`, which refuses whenever the FORGE session marker `FORGE_RUN_ID` is present, as `forge parity capture` does',
      '(`10` §10.3 rule 6 defines the marker, an honest-session signal and not a security boundary)',
    ]);
    expectClause(parity(), [
      '`forge parity capture` refuses whenever the FORGE session marker `FORGE_RUN_ID` is present, whichever run it names',
      '(`10` §10.3 rule 6 defines the marker, an honest-session signal and not a security boundary)',
    ]);
    expectClause(spec18('## 18.7 '), [
      '`--apply` refuses whenever the FORGE session marker `FORGE_RUN_ID` is present, whichever run it names',
      '(`10` §10.3 rule 6 defines the marker, an honest-session signal and not a security boundary)',
    ]);
  });

  it("M16 specs/13 and specs/18 cross-spec clause: a run's own trail is written only where the run's id reaches the command in FORGE_RUN_ID and the command can name the run's own project root", () => {
    expectClause(parity(), [
      "where the run's id reaches the command in `FORGE_RUN_ID` and the command can name the run's own project root",
    ]);
    expectClause(spec18('## 18.4 '), [
      "where the run's id reaches the command in `FORGE_RUN_ID` and the command can name the run's own project root",
    ]);
  });

  it('M16 retired wording: `integrationTipAtStart` is gone from F-TEST-9 and from specs 03, 10, 13 and 18 — the trust anchor is `--trusted`, not a run-manifest field (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, ['integrationTipAtStart']);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), ['integrationTipAtStart']);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), ['integrationTipAtStart']);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'integrationTipAtStart',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      'integrationTipAtStart',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), ['integrationTipAtStart']);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), ['integrationTipAtStart']);
  });

  it('M16 retired wording: "The oracle cannot move during a run" is gone — the comparison makes a rewritten oracle fail, it does not stop the rewrite (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, ['The oracle cannot move during a run']);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      'The oracle cannot move during a run',
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      'The oracle cannot move during a run',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'The oracle cannot move during a run',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      'The oracle cannot move during a run',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      'The oracle cannot move during a run',
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      'The oracle cannot move during a run',
    ]);
  });

  it('M16 retired wording: "honest-session fence" is gone from F-TEST-9 and from specs 03, 10, 13 and 18 (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, ['honest-session fence']);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), ['honest-session fence']);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), ['honest-session fence']);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'honest-session fence',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), ['honest-session fence']);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), ['honest-session fence']);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), ['honest-session fence']);
  });

  it('M16 retired wording: "bare checkout" is gone from F-TEST-9 and from specs 03, 10, 13 and 18 (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, ['bare checkout']);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), ['bare checkout']);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), ['bare checkout']);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), ['bare checkout']);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), ['bare checkout']);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), ['bare checkout']);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), ['bare checkout']);
  });

  it('M16 retired wording: "inside a workflow run the anchor is the run\'s own, whatever `--trusted` says" is gone — the gate passes `--trusted refs/heads/main` as an explicit argument (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = spec03();
    expectAbsentFolded(section, [
      "inside a workflow run the anchor is the run's own, whatever `--trusted` says",
    ]);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      "inside a workflow run the anchor is the run's own, whatever `--trusted` says",
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      "inside a workflow run the anchor is the run's own, whatever `--trusted` says",
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      "inside a workflow run the anchor is the run's own, whatever `--trusted` says",
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      "inside a workflow run the anchor is the run's own, whatever `--trusted` says",
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      "inside a workflow run the anchor is the run's own, whatever `--trusted` says",
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      "inside a workflow run the anchor is the run's own, whatever `--trusted` says",
    ]);
  });

  it('M16 retired wording: "That is all `granularity: "file"` means" is gone from F-TEST-10 — `granularity` now has its own definition (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = hunks();
    expectAbsentFolded(section, ['That is all `granularity: "file"` means']);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      'That is all `granularity: "file"` means',
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      'That is all `granularity: "file"` means',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'That is all `granularity: "file"` means',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      'That is all `granularity: "file"` means',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      'That is all `granularity: "file"` means',
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      'That is all `granularity: "file"` means',
    ]);
  });

  it('M16 retired wording: "or because it declares no case" is gone from the check contract and from F-TEST-9 — a declaration that compares nothing is one with no surface that is not exempt (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = spec10Gates();
    expectAbsentFolded(section, ['or because it declares no case']);
    expectAbsentFolded(parity(), ['or because it declares no case']);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), ['or because it declares no case']);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      'or because it declares no case',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'or because it declares no case',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      'or because it declares no case',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), ['or because it declares no case']);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      'or because it declares no case',
    ]);
  });

  it('M16 retired wording: "so cleaning can never delete a project file" is gone from F-TEST-9 — cleaning deletes only a file the reviewed declaration names (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, ['so cleaning can never delete a project file']);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      'so cleaning can never delete a project file',
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      'so cleaning can never delete a project file',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'so cleaning can never delete a project file',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      'so cleaning can never delete a project file',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      'so cleaning can never delete a project file',
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      'so cleaning can never delete a project file',
    ]);
  });

  it('M16 retired wording: the `-text`-only marking advice is gone from F-TEST-9 and from specs 03, 10, 13 and 18 — `-text` alone cures only the line endings, so the marking is `-text -filter -ident -working-tree-encoding` (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, ['`.forge/parity/**` `-text` in its `.gitattributes`']);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      '`.forge/parity/**` `-text` in its `.gitattributes`',
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      '`.forge/parity/**` `-text` in its `.gitattributes`',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      '`.forge/parity/**` `-text` in its `.gitattributes`',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      '`.forge/parity/**` `-text` in its `.gitattributes`',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      '`.forge/parity/**` `-text` in its `.gitattributes`',
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      '`.forge/parity/**` `-text` in its `.gitattributes`',
    ]);
  });

  it('M16 retired wording: "A checkout that converts line endings reads as a modification" is gone from F-TEST-9 and from specs 03, 10, 13 and 18 — a checkout that converts bytes (line endings, an `ident` expansion, a smudge filter, a `working-tree-encoding`) does (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, ['A checkout that converts line endings reads as a modification']);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      'A checkout that converts line endings reads as a modification',
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      'A checkout that converts line endings reads as a modification',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'A checkout that converts line endings reads as a modification',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      'A checkout that converts line endings reads as a modification',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      'A checkout that converts line endings reads as a modification',
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      'A checkout that converts line endings reads as a modification',
    ]);
  });

  it('M16 retired wording: "a `--trusted` ref that does not resolve" is gone from specs 03 and 13 — a `--trusted` that is not in the accepted form is refused too, resolvable or not (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, ['`--trusted` ref that does not resolve']);
    expectAbsentFolded(spec03(), ['`--trusted` ref that does not resolve']);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      '`--trusted` ref that does not resolve',
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      '`--trusted` ref that does not resolve',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      '`--trusted` ref that does not resolve',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      '`--trusted` ref that does not resolve',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      '`--trusted` ref that does not resolve',
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      '`--trusted` ref that does not resolve',
    ]);
  });

  it('M16 retired wording: "built or fetched" is gone from F-TEST-9 and from specs 03, 10, 13 and 18 — `setup` builds from what is tracked, and `network: none` applies to it too (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, ['built or fetched']);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), ['built or fetched']);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), ['built or fetched']);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), ['built or fetched']);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), ['built or fetched']);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), ['built or fetched']);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), ['built or fetched']);
  });

  it('M16 retired wording: "the engine\'s command vetting" is gone from F-TEST-9 and from specs 03, 10, 13 and 18 — vetting is defined in its own sentence, by what it checks (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, ["the engine's command vetting"]);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), ["the engine's command vetting"]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      "the engine's command vetting",
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      "the engine's command vetting",
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      "the engine's command vetting",
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), ["the engine's command vetting"]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      "the engine's command vetting",
    ]);
  });

  it('M16 retired wording: "command vetting refuses" is gone from F-TEST-9 and from specs 03, 10, 13 and 18 — the `invalid` list names a `run` or `setup` command that vetting refuses (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, ['command vetting refuses']);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), ['command vetting refuses']);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      'command vetting refuses',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'command vetting refuses',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      'command vetting refuses',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), ['command vetting refuses']);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), ['command vetting refuses']);
  });

  it('M16 retired wording: "any other entry that is not a regular file" is gone from F-TEST-9 and from specs 03, 10, 13 and 18 — a directory is not a regular file but is no difference, the entry that is `oracle-changed` is one that is neither a regular file nor a directory (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, ['any other entry that is not a regular file']);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      'any other entry that is not a regular file',
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      'any other entry that is not a regular file',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'any other entry that is not a regular file',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      'any other entry that is not a regular file',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      'any other entry that is not a regular file',
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      'any other entry that is not a regular file',
    ]);
  });

  it('M16 retired wording: "so neither can change what is observed" is gone from F-TEST-9 and from specs 03, 10, 13 and 18 — the code under test can read `.forge/parity/`, so the claim is only about what the harness loads or runs (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, ['so neither can change what is observed']);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      'so neither can change what is observed',
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      'so neither can change what is observed',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'so neither can change what is observed',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      'so neither can change what is observed',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      'so neither can change what is observed',
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      'so neither can change what is observed',
    ]);
  });

  it('M16 retired wording: "because nothing under `.forge/parity/` is executed in place" is gone from F-TEST-9 and from specs 03, 10, 13 and 18 — the passive claim names no one, and what is true is that the harness executes nothing there in place (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, ['because nothing under `.forge/parity/` is executed in place']);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      'because nothing under `.forge/parity/` is executed in place',
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      'because nothing under `.forge/parity/` is executed in place',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'because nothing under `.forge/parity/` is executed in place',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      'because nothing under `.forge/parity/` is executed in place',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      'because nothing under `.forge/parity/` is executed in place',
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      'because nothing under `.forge/parity/` is executed in place',
    ]);
  });

  it('M16 retired wording: "Each file is read once:" is gone from F-TEST-9 and from specs 03, 10, 13 and 18 — each file is read once at the first comparison, and the second comparison reads the tree afresh and loads nothing (r3g item 5: left exact, not folded -- the live text legitimately uses the same lowercase words for a different claim; scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsent(section, ['Each file is read once:']);
    expectAbsent(wholeFile('03-cli-and-installer.md'), ['Each file is read once:']);
    expectAbsent(wholeFile('10-workflow-engine-and-lifecycle.md'), ['Each file is read once:']);
    expectAbsent(wholeFile('13-frameworks-testing-and-debugging.md'), ['Each file is read once:']);
    expectAbsent(wholeFile('18-persistence-config-and-schemas.md'), ['Each file is read once:']);
    expectAbsent(wholeFile('17-brownfield-ingestion.md'), ['Each file is read once:']);
    expectAbsent(wholeFile('22-build-plan-and-milestones.md'), ['Each file is read once:']);
  });

  it('M16 retired wording: "again after the last, against the same sha" is gone from F-TEST-9 and from specs 03, 10, 13 and 18 — the second comparison is made when a case ran, against the same commit id (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, ['again after the last, against the same sha']);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      'again after the last, against the same sha',
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      'again after the last, against the same sha',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'again after the last, against the same sha',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      'again after the last, against the same sha',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      'again after the last, against the same sha',
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      'again after the last, against the same sha',
    ]);
  });

  it('M16 retired wording: "reaches the code under test and nothing else" is gone from F-TEST-9 and from specs 03, 10, 13 and 18 — a file changed and restored between the two comparisons alters nothing the harness itself writes into a tree or compares, though a case\'s own command can read it while it is changed (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, ['reaches the code under test and nothing else']);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      'reaches the code under test and nothing else',
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      'reaches the code under test and nothing else',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'reaches the code under test and nothing else',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      'reaches the code under test and nothing else',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      'reaches the code under test and nothing else',
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      'reaches the code under test and nothing else',
    ]);
  });

  it('M16 retired wording: "as `<ref>^{commit}` after `--end-of-options`" is gone from F-TEST-9 and from specs 03, 10, 13 and 18 — the ref is resolved by `git rev-parse --verify <ref>^{commit}`, and the commit id that returns is the one every later step uses (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, ['as `<ref>^{commit}` after `--end-of-options`']);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      'as `<ref>^{commit}` after `--end-of-options`',
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      'as `<ref>^{commit}` after `--end-of-options`',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'as `<ref>^{commit}` after `--end-of-options`',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      'as `<ref>^{commit}` after `--end-of-options`',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      'as `<ref>^{commit}` after `--end-of-options`',
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      'as `<ref>^{commit}` after `--end-of-options`',
    ]);
  });

  it('M16 retired wording: "`git ls-tree -r -z <ref> -- .forge/parity`" is gone from F-TEST-9 and from specs 03, 10, 13 and 18 — the listing is of the resolved commit id, `<commit>`, never of the ref again (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, ['`git ls-tree -r -z <ref> -- .forge/parity`']);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      '`git ls-tree -r -z <ref> -- .forge/parity`',
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      '`git ls-tree -r -z <ref> -- .forge/parity`',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      '`git ls-tree -r -z <ref> -- .forge/parity`',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      '`git ls-tree -r -z <ref> -- .forge/parity`',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      '`git ls-tree -r -z <ref> -- .forge/parity`',
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      '`git ls-tree -r -z <ref> -- .forge/parity`',
    ]);
  });

  it('M16 retired wording: a ref form with no `git check-ref-format` clause ("a full commit sha or a ref name that begins `refs/`" followed directly by `:`, `.`, `,` or `;`) is gone from specs 03 and 13 — the name must also be one that `git check-ref-format` accepts (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = spec03();
    expectAbsentFolded(section, [
      'a full commit sha or a ref name that begins `refs/`:',
      'a full commit sha or a ref name that begins `refs/`.',
      'a full commit sha or a ref name that begins `refs/`,',
      'a full commit sha or a ref name that begins `refs/`;',
    ]);
    expectAbsentFolded(parity(), [
      'a full commit sha or a ref name that begins `refs/`:',
      'a full commit sha or a ref name that begins `refs/`.',
      'a full commit sha or a ref name that begins `refs/`,',
      'a full commit sha or a ref name that begins `refs/`;',
    ]);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      'a full commit sha or a ref name that begins `refs/`:',
      'a full commit sha or a ref name that begins `refs/`.',
      'a full commit sha or a ref name that begins `refs/`,',
      'a full commit sha or a ref name that begins `refs/`;',
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      'a full commit sha or a ref name that begins `refs/`:',
      'a full commit sha or a ref name that begins `refs/`.',
      'a full commit sha or a ref name that begins `refs/`,',
      'a full commit sha or a ref name that begins `refs/`;',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'a full commit sha or a ref name that begins `refs/`:',
      'a full commit sha or a ref name that begins `refs/`.',
      'a full commit sha or a ref name that begins `refs/`,',
      'a full commit sha or a ref name that begins `refs/`;',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      'a full commit sha or a ref name that begins `refs/`:',
      'a full commit sha or a ref name that begins `refs/`.',
      'a full commit sha or a ref name that begins `refs/`,',
      'a full commit sha or a ref name that begins `refs/`;',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      'a full commit sha or a ref name that begins `refs/`:',
      'a full commit sha or a ref name that begins `refs/`.',
      'a full commit sha or a ref name that begins `refs/`,',
      'a full commit sha or a ref name that begins `refs/`;',
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      'a full commit sha or a ref name that begins `refs/`:',
      'a full commit sha or a ref name that begins `refs/`.',
      'a full commit sha or a ref name that begins `refs/`,',
      'a full commit sha or a ref name that begins `refs/`;',
    ]);
  });

  it('M16 retired wording: the old `setup` parenthetical ("such as a package-manager install, is a load error, so `setup` builds from what is tracked and does not fetch") is gone from F-TEST-9 and from specs 03, 10, 13 and 18 — `network: none` applies to a `setup` too: a package-manager install is refused, and a declaration is not given the registry allowlist (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, [
      'such as a package-manager install, is a load error, so `setup` builds from what is tracked and does not fetch',
    ]);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      'such as a package-manager install, is a load error, so `setup` builds from what is tracked and does not fetch',
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      'such as a package-manager install, is a load error, so `setup` builds from what is tracked and does not fetch',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'such as a package-manager install, is a load error, so `setup` builds from what is tracked and does not fetch',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      'such as a package-manager install, is a load error, so `setup` builds from what is tracked and does not fetch',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      'such as a package-manager install, is a load error, so `setup` builds from what is tracked and does not fetch',
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      'such as a package-manager install, is a load error, so `setup` builds from what is tracked and does not fetch',
    ]);
  });

  it('M16 retired wording: "has no network and cannot fetch" is gone from F-TEST-9 and from specs 03, 10, 13 and 18 — `network: none` applies to a `setup` too, and the program a `setup` names does whatever it does, which review of the declaration covers (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, ['has no network and cannot fetch']);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), ['has no network and cannot fetch']);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      'has no network and cannot fetch',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'has no network and cannot fetch',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      'has no network and cannot fetch',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      'has no network and cannot fetch',
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      'has no network and cannot fetch',
    ]);
  });

  it('M16 retired wording: "so a `setup` has no network" is gone from F-TEST-9 and from specs 03, 10, 13 and 18 — the parenthetical says that `network: none` applies to a `setup` too (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, ['so a `setup` has no network']);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), ['so a `setup` has no network']);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      'so a `setup` has no network',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'so a `setup` has no network',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      'so a `setup` has no network',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), ['so a `setup` has no network']);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      'so a `setup` has no network',
    ]);
  });

  it('M16 retired wording: "no chaining or expansion" is gone from F-TEST-9 and from specs 03, 10, 13 and 18 — the vetting definition lists what a stored command may not have: chaining, redirection, substitution, variable, tilde or brace expansion, and a shell `-c` string (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, ['no chaining or expansion']);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), ['no chaining or expansion']);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      'no chaining or expansion',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'no chaining or expansion',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      'no chaining or expansion',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), ['no chaining or expansion']);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), ['no chaining or expansion']);
  });

  it('M16 retired wording: "the tree it runs in" is gone from F-TEST-9 and from specs 03, 10, 13 and 18 — every path a stored command names, a glob\'s matches included, must stay inside the project (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, ['the tree it runs in']);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), ['the tree it runs in']);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), ['the tree it runs in']);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'the tree it runs in',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), ['the tree it runs in']);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), ['the tree it runs in']);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), ['the tree it runs in']);
  });

  it('M16 retired wording: "a valid ref name that begins" is gone from F-TEST-9 and from specs 03, 10, 13 and 18 — "valid" had no referent: the name must begin `refs/` and be one that `git check-ref-format` accepts (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, ['a valid ref name that begins']);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), ['a valid ref name that begins']);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      'a valid ref name that begins',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'a valid ref name that begins',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      'a valid ref name that begins',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), ['a valid ref name that begins']);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      'a valid ref name that begins',
    ]);
  });

  it('M16 retired wording: "--end-of-options" is gone from F-TEST-9 and from specs 03, 10, 13 and 18 — the `--trusted` form cannot begin with `-`, so `git rev-parse --verify <ref>^{commit}` cannot read the argument as an option (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, ['--end-of-options']);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), ['--end-of-options']);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), ['--end-of-options']);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), ['--end-of-options']);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), ['--end-of-options']);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), ['--end-of-options']);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), ['--end-of-options']);
  });

  it('M16 retired wording: "made before the first case and, when a case ran" is gone from F-TEST-9 and from specs 03, 10, 13 and 18 — the comparison is made first, before any case runs, and, when a case ran, again after the last (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, ['made before the first case and, when a case ran']);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      'made before the first case and, when a case ran',
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      'made before the first case and, when a case ran',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'made before the first case and, when a case ran',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      'made before the first case and, when a case ran',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      'made before the first case and, when a case ran',
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      'made before the first case and, when a case ran',
    ]);
  });

  it('M16 retired wording: "and each stops that declaration\'s cases from running" is gone from F-TEST-9 and from specs 03, 10, 13 and 18 — the four declaration-level verdicts are listed in one sentence, and the next one says each is decided before any case is observed, with the one exception (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, ["and each stops that declaration's cases from running"]);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      "and each stops that declaration's cases from running",
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      "and each stops that declaration's cases from running",
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      "and each stops that declaration's cases from running",
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      "and each stops that declaration's cases from running",
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      "and each stops that declaration's cases from running",
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      "and each stops that declaration's cases from running",
    ]);
  });

  it('M16 retired wording: "such a change reaches nothing the harness runs or compares" is gone from F-TEST-9 and from specs 03, 10, 13 and 18 — such a change alters nothing the harness itself writes into a tree or compares, though a case\'s own command can read the file while it is changed (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, ['such a change reaches nothing the harness runs or compares']);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      'such a change reaches nothing the harness runs or compares',
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      'such a change reaches nothing the harness runs or compares',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'such a change reaches nothing the harness runs or compares',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      'such a change reaches nothing the harness runs or compares',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      'such a change reaches nothing the harness runs or compares',
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      'such a change reaches nothing the harness runs or compares',
    ]);
  });

  it('M16 retired wording: "the default `network: none`" is gone from F-TEST-9 and from spec 13 — vetting applies `network: none`, which no declaration can relax for a command (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, ['the default `network: none`']);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'the default `network: none`',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), ['the default `network: none`']);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      'the default `network: none`',
    ]);
  });

  it('M16 retired wording: "that vetting refuses is a load error" is gone from F-TEST-9 and from spec 13 — a `run` or `setup` that vetting refuses makes the declaration `invalid` (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, ['that vetting refuses is a load error']);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'that vetting refuses is a load error',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      'that vetting refuses is a load error',
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      'that vetting refuses is a load error',
    ]);
  });

  it('M16 retired wording: "the tree the check runs in" is gone from F-TEST-9 and from spec 13 — the reference is placed under the `.forge/state/` of the tree a capture runs in, because only a capture observes it (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, ['the tree the check runs in']);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'the tree the check runs in',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), ['the tree the check runs in']);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      'the tree the check runs in',
    ]);
  });

  it('M16 retired wording: "what the program a command names then does" is gone from F-TEST-9 and from spec 13 — the judgement covers neither the reference\'s scratch tree nor what the program the command names does when it runs (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, ['what the program a command names then does']);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'what the program a command names then does',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      'what the program a command names then does',
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      'what the program a command names then does',
    ]);
  });

  it('M16 retired wording: "once the cases have run" is gone from F-TEST-9 and from spec 13 — the declaration-level verdicts are decided before any case is observed, and the one exception is a sentence of its own (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, ['once the cases have run']);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'once the cases have run',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), ['once the cases have run']);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), ['once the cases have run']);
  });

  it('M16 retired wording: "except that the trust anchor\'s second comparison" is gone from F-TEST-9 and from spec 13 — the exception is a sentence of its own: there is one exception, the second comparison, which can still find `oracle-changed` (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, ["except that the trust anchor's second comparison"]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      "except that the trust anchor's second comparison",
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      "except that the trust anchor's second comparison",
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      "except that the trust anchor's second comparison",
    ]);
  });

  it('M16 retired wording: "and a bare name, which a tag can shadow, are refused" is gone from F-TEST-9 and from spec 13 — the refusals follow a `;`, and the tag that can shadow a bare name is in a parenthesis (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, ['and a bare name, which a tag can shadow, are refused']);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'and a bare name, which a tag can shadow, are refused',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      'and a bare name, which a tag can shadow, are refused',
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      'and a bare name, which a tag can shadow, are refused',
    ]);
  });

  it('M16 retired wording (r3g): "an expired review (the declaration\'s `expires` has passed)" is gone from spec 10 -- an expired review or `unobservable` entry now reaches its expiry the same way (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = spec10Gates();
    expectAbsentFolded(section, ["an expired review (the declaration's `expires` has passed)"]);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      "an expired review (the declaration's `expires` has passed)",
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      "an expired review (the declaration's `expires` has passed)",
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      "an expired review (the declaration's `expires` has passed)",
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      "an expired review (the declaration's `expires` has passed)",
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      "an expired review (the declaration's `expires` has passed)",
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      "an expired review (the declaration's `expires` has passed)",
    ]);
  });

  it('M16 retired wording (r3g): the self-commit disclosure cites Q209 nowhere any more -- it is Q212 (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, ['SPEC-QUESTIONS.md` Q209']);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), ['SPEC-QUESTIONS.md` Q209']);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      'SPEC-QUESTIONS.md` Q209',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'SPEC-QUESTIONS.md` Q209',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      'SPEC-QUESTIONS.md` Q209',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), ['SPEC-QUESTIONS.md` Q209']);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), ['SPEC-QUESTIONS.md` Q209']);
  });

  it('M16 retired wording (r3g): "renews it. FORGE enforces" (an `expires` date with no UTC/start-of-day rule) is gone from F-TEST-9 (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, ['renews it. FORGE enforces']);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), ['renews it. FORGE enforces']);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      'renews it. FORGE enforces',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'renews it. FORGE enforces',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      'renews it. FORGE enforces',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), ['renews it. FORGE enforces']);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), ['renews it. FORGE enforces']);
  });

  it('M16 retired wording (r3g): "as canonical JSON with sorted keys, in UTF-8" (no mention of compactness or depth) is gone from F-TEST-9 (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, ['as canonical JSON with sorted keys, in UTF-8']);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      'as canonical JSON with sorted keys, in UTF-8',
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      'as canonical JSON with sorted keys, in UTF-8',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'as canonical JSON with sorted keys, in UTF-8',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      'as canonical JSON with sorted keys, in UTF-8',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      'as canonical JSON with sorted keys, in UTF-8',
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      'as canonical JSON with sorted keys, in UTF-8',
    ]);
  });

  it('M16 retired wording (r3g): "returns is the one every later step uses. The harness makes the comparison itself" is gone -- the ref-resolution and reference.ref exactness sentences now sit between them (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, [
      'returns is the one every later step uses. The harness makes the comparison itself',
    ]);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      'returns is the one every later step uses. The harness makes the comparison itself',
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      'returns is the one every later step uses. The harness makes the comparison itself',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'returns is the one every later step uses. The harness makes the comparison itself',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      'returns is the one every later step uses. The harness makes the comparison itself',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      'returns is the one every later step uses. The harness makes the comparison itself',
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      'returns is the one every later step uses. The harness makes the comparison itself',
    ]);
  });

  it('M16 retired wording (r3g): "At check, the candidate\'s own repeated runs must agree, else `unstable`." (the old compressed form) is gone from F-TEST-9 (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, [
      "At check, the candidate's own repeated runs must agree, else `unstable`.",
    ]);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      "At check, the candidate's own repeated runs must agree, else `unstable`.",
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      "At check, the candidate's own repeated runs must agree, else `unstable`.",
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      "At check, the candidate's own repeated runs must agree, else `unstable`.",
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      "At check, the candidate's own repeated runs must agree, else `unstable`.",
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      "At check, the candidate's own repeated runs must agree, else `unstable`.",
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      "At check, the candidate's own repeated runs must agree, else `unstable`.",
    ]);
  });

  it('M16 retired wording (r3g): "(default 0), and a case whose entire observation is empty" (no mention of a signal-ended run) is gone from F-TEST-9 (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, ['(default 0), and a case whose entire observation is empty']);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      '(default 0), and a case whose entire observation is empty',
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      '(default 0), and a case whose entire observation is empty',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      '(default 0), and a case whose entire observation is empty',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      '(default 0), and a case whose entire observation is empty',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      '(default 0), and a case whose entire observation is empty',
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      '(default 0), and a case whose entire observation is empty',
    ]);
  });

  it('M16 retired wording (r3g): "labelled as display only. The secret check runs" is gone -- the printed-only-without-`--json` and evidence-carries-no-text sentences now sit between them (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, ['labelled as display only. The secret check runs']);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      'labelled as display only. The secret check runs',
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      'labelled as display only. The secret check runs',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'labelled as display only. The secret check runs',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      'labelled as display only. The secret check runs',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      'labelled as display only. The secret check runs',
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      'labelled as display only. The secret check runs',
    ]);
  });

  it('M16 retired wording (r3g): "vetted command. Vetting is the engine\'s check" is gone -- `process` now also names the signal-ended case between them (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, ["vetted command. Vetting is the engine's check"]);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      "vetted command. Vetting is the engine's check",
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      "vetted command. Vetting is the engine's check",
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      "vetted command. Vetting is the engine's check",
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      "vetted command. Vetting is the engine's check",
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      "vetted command. Vetting is the engine's check",
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      "vetted command. Vetting is the engine's check",
    ]);
  });

  it('M16 retired wording (r3g): "so a network program, a URL and a package-manager verb" (the old, un-closed-listed vetting wording) is gone from F-TEST-9 (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, [
      'can relax for a command, so a network program, a URL and a package-manager verb',
    ]);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      'can relax for a command, so a network program, a URL and a package-manager verb',
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      'can relax for a command, so a network program, a URL and a package-manager verb',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'can relax for a command, so a network program, a URL and a package-manager verb',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      'can relax for a command, so a network program, a URL and a package-manager verb',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      'can relax for a command, so a network program, a URL and a package-manager verb',
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      'can relax for a command, so a network program, a URL and a package-manager verb',
    ]);
  });

  it('M16 retired wording (r3g): "must stay inside the project. It also refuses a program that runs another program" is gone -- the symlink and closed-lists sentences now sit between them (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, [
      "glob's matches included, must stay inside the project. It also refuses a program that runs another program",
    ]);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      "glob's matches included, must stay inside the project. It also refuses a program that runs another program",
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      "glob's matches included, must stay inside the project. It also refuses a program that runs another program",
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      "glob's matches included, must stay inside the project. It also refuses a program that runs another program",
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      "glob's matches included, must stay inside the project. It also refuses a program that runs another program",
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      "glob's matches included, must stay inside the project. It also refuses a program that runs another program",
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      "glob's matches included, must stay inside the project. It also refuses a program that runs another program",
    ]);
  });

  it('M16 retired wording (r3g): "`.forge/state`. A glob is allowed" is gone -- the closed-lists-are-not-classes sentence now sits between them (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, ['`.forge/state`. A glob is allowed']);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), ['`.forge/state`. A glob is allowed']);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      '`.forge/state`. A glob is allowed',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      '`.forge/state`. A glob is allowed',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      '`.forge/state`. A glob is allowed',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      '`.forge/state`. A glob is allowed',
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      '`.forge/state`. A glob is allowed',
    ]);
  });

  it('M16 retired wording (r3g): "runs in. A `run` or `setup` that vetting refuses makes the declaration `invalid`" (no mention of a composed-with-arguments `run`) is gone from F-TEST-9 (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, [
      'runs in. A `run` or `setup` that vetting refuses makes the declaration `invalid`',
    ]);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      'runs in. A `run` or `setup` that vetting refuses makes the declaration `invalid`',
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      'runs in. A `run` or `setup` that vetting refuses makes the declaration `invalid`',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'runs in. A `run` or `setup` that vetting refuses makes the declaration `invalid`',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      'runs in. A `run` or `setup` that vetting refuses makes the declaration `invalid`',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      'runs in. A `run` or `setup` that vetting refuses makes the declaration `invalid`',
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      'runs in. A `run` or `setup` that vetting refuses makes the declaration `invalid`',
    ]);
  });

  it('M16 retired wording (r3g): "a held port is a refusal, never a comparison against whatever is listening" is gone -- a held port now makes the case `error` (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, [
      'a held port is a refusal, never a comparison against whatever is listening',
    ]);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      'a held port is a refusal, never a comparison against whatever is listening',
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      'a held port is a refusal, never a comparison against whatever is listening',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'a held port is a refusal, never a comparison against whatever is listening',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      'a held port is a refusal, never a comparison against whatever is listening',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      'a held port is a refusal, never a comparison against whatever is listening',
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      'a held port is a refusal, never a comparison against whatever is listening',
    ]);
  });

  it('M16 retired wording (r3g): "removed after the case, and its arguments are literal words" (arguments as a trailing clause, not their own sentence) is gone from F-TEST-9 (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, ['removed after the case, and its arguments are literal words']);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      'removed after the case, and its arguments are literal words',
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      'removed after the case, and its arguments are literal words',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'removed after the case, and its arguments are literal words',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      'removed after the case, and its arguments are literal words',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      'removed after the case, and its arguments are literal words',
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      'removed after the case, and its arguments are literal words',
    ]);
  });

  it('M16 retired wording (r3g): "a package-manager install is refused" (the old compound-adjective phrasing) is gone from F-TEST-9 -- it is now "an install by a package manager the engine knows" (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, ['a package-manager install is refused']);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      'a package-manager install is refused',
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      'a package-manager install is refused',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'a package-manager install is refused',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      'a package-manager install is refused',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      'a package-manager install is refused',
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      'a package-manager install is refused',
    ]);
  });

  it('M16 retired wording (r3g): "so `setup` builds from what is tracked), whose bytes are in the declaration digest" is gone -- `setup` now only narrows, and the honest-boundary cross-reference sits between them (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, [
      'so `setup` builds from what is tracked), whose bytes are in the declaration digest',
    ]);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      'so `setup` builds from what is tracked), whose bytes are in the declaration digest',
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      'so `setup` builds from what is tracked), whose bytes are in the declaration digest',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'so `setup` builds from what is tracked), whose bytes are in the declaration digest',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      'so `setup` builds from what is tracked), whose bytes are in the declaration digest',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      'so `setup` builds from what is tracked), whose bytes are in the declaration digest',
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      'so `setup` builds from what is tracked), whose bytes are in the declaration digest',
    ]);
  });

  it('M16 retired wording (r3g): "FORGE builds nothing for the candidate. A case\'s `run` is the same command on both sides" is gone -- it is now "A case\'s command", not "A case\'s `run`" (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, [
      "FORGE builds nothing for the candidate. A case's `run` is the same command on both sides",
    ]);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      "FORGE builds nothing for the candidate. A case's `run` is the same command on both sides",
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      "FORGE builds nothing for the candidate. A case's `run` is the same command on both sides",
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      "FORGE builds nothing for the candidate. A case's `run` is the same command on both sides",
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      "FORGE builds nothing for the candidate. A case's `run` is the same command on both sides",
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      "FORGE builds nothing for the candidate. A case's `run` is the same command on both sides",
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      "FORGE builds nothing for the candidate. A case's `run` is the same command on both sides",
    ]);
  });

  it('M16 retired wording (r3g): the candidate snapshot command `git status --porcelain=v1 -z --untracked-files=all` with no `--no-renames` is gone from F-TEST-9 (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, ['git status --porcelain=v1 -z --untracked-files=all']);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      'git status --porcelain=v1 -z --untracked-files=all',
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      'git status --porcelain=v1 -z --untracked-files=all',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'git status --porcelain=v1 -z --untracked-files=all',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      'git status --porcelain=v1 -z --untracked-files=all',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      'git status --porcelain=v1 -z --untracked-files=all',
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      'git status --porcelain=v1 -z --untracked-files=all',
    ]);
  });

  it('M16 retired wording (r3g): "An ignored file is not part of a snapshot, so it is not observed." (no mention of `skip-worktree`/`assume-unchanged`) is gone from F-TEST-9 (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, [
      'An ignored file is not part of a snapshot, so it is not observed.',
    ]);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      'An ignored file is not part of a snapshot, so it is not observed.',
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      'An ignored file is not part of a snapshot, so it is not observed.',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'An ignored file is not part of a snapshot, so it is not observed.',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      'An ignored file is not part of a snapshot, so it is not observed.',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      'An ignored file is not part of a snapshot, so it is not observed.',
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      'An ignored file is not part of a snapshot, so it is not observed.',
    ]);
  });

  it('M16 retired wording (r3g): "a `run` or `setup` command that vetting refuses, a surface that lists no case" (the `invalid` bullet before composed-arguments were added) is gone from F-TEST-9 (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, [
      'a `run` or `setup` command that vetting refuses, a surface that lists no case',
    ]);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      'a `run` or `setup` command that vetting refuses, a surface that lists no case',
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      'a `run` or `setup` command that vetting refuses, a surface that lists no case',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'a `run` or `setup` command that vetting refuses, a surface that lists no case',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      'a `run` or `setup` command that vetting refuses, a surface that lists no case',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      'a `run` or `setup` command that vetting refuses, a surface that lists no case',
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      'a `run` or `setup` command that vetting refuses, a surface that lists no case',
    ]);
  });

  it('M16 retired wording (r3g): "`expired` — the declaration\'s `expires`, or an `unobservable` entry\'s expiry, has passed." (no UTC/start-of-day rule) is gone from F-TEST-9 (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, [
      "`expired` — the declaration's `expires`, or an `unobservable` entry's expiry, has passed.",
    ]);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      "`expired` — the declaration's `expires`, or an `unobservable` entry's expiry, has passed.",
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      "`expired` — the declaration's `expires`, or an `unobservable` entry's expiry, has passed.",
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      "`expired` — the declaration's `expires`, or an `unobservable` entry's expiry, has passed.",
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      "`expired` — the declaration's `expires`, or an `unobservable` entry's expiry, has passed.",
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      "`expired` — the declaration's `expires`, or an `unobservable` entry's expiry, has passed.",
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      "`expired` — the declaration's `expires`, or an `unobservable` entry's expiry, has passed.",
    ]);
  });

  it('M16 retired wording (r3g): the `error` bullet ending at "overlay destination that already exists." (no snapshot/loopback-port causes) is gone from F-TEST-9 (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, ['already exists.\n  - `unclean`']);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), ['already exists.\n  - `unclean`']);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      'already exists.\n  - `unclean`',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'already exists.\n  - `unclean`',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      'already exists.\n  - `unclean`',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), ['already exists.\n  - `unclean`']);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      'already exists.\n  - `unclean`',
    ]);
  });

  it('M16 retired wording (r3g): "a `declarations` list whose entries each give a declaration\'s `name`" (not in order of `name`) is gone from the F-TEST-9 envelope sentence (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, [
      "a `declarations` list whose entries each give a declaration's `name`",
    ]);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      "a `declarations` list whose entries each give a declaration's `name`",
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      "a `declarations` list whose entries each give a declaration's `name`",
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      "a `declarations` list whose entries each give a declaration's `name`",
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      "a `declarations` list whose entries each give a declaration's `name`",
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      "a `declarations` list whose entries each give a declaration's `name`",
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      "a `declarations` list whose entries each give a declaration's `name`",
    ]);
  });

  it('M16 retired wording (r3g): "lists the ids of these records. The `G-Parity` gate" is gone -- the "M16 changes no bundle assembler" sentence now sits between them (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, ['lists the ids of these records. The `G-Parity` gate']);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      'lists the ids of these records. The `G-Parity` gate',
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      'lists the ids of these records. The `G-Parity` gate',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'lists the ids of these records. The `G-Parity` gate',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      'lists the ids of these records. The `G-Parity` gate',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      'lists the ids of these records. The `G-Parity` gate',
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      'lists the ids of these records. The `G-Parity` gate',
    ]);
  });

  it('M16 retired wording (r3g): "in `FORGE_RUN_ID` the check adds a `CheckRun` event" (no project-root caveat) is gone from F-TEST-9 (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, ['in `FORGE_RUN_ID` the check adds a `CheckRun` event']);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      'in `FORGE_RUN_ID` the check adds a `CheckRun` event',
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      'in `FORGE_RUN_ID` the check adds a `CheckRun` event',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'in `FORGE_RUN_ID` the check adds a `CheckRun` event',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      'in `FORGE_RUN_ID` the check adds a `CheckRun` event',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      'in `FORGE_RUN_ID` the check adds a `CheckRun` event',
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      'in `FORGE_RUN_ID` the check adds a `CheckRun` event',
    ]);
  });

  it('M16 retired wording (r3g): the old honest-boundary lead ("...the project\'s tree as it is when the declaration loads. That judgement covers neither the reference\'s scratch tree, which a ref fills, nor what the program the command names does when it runs, so a `run` or `setup` that names a script") with no closed-lists or no-program-on-the-lists clause is gone from F-TEST-9 (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, [
      "project's tree as it is when the declaration loads. That judgement covers neither the reference's scratch tree, which a ref fills, nor what the program the command names does when it runs, so a `run` or `setup` that names a script",
    ]);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      "project's tree as it is when the declaration loads. That judgement covers neither the reference's scratch tree, which a ref fills, nor what the program the command names does when it runs, so a `run` or `setup` that names a script",
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      "project's tree as it is when the declaration loads. That judgement covers neither the reference's scratch tree, which a ref fills, nor what the program the command names does when it runs, so a `run` or `setup` that names a script",
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      "project's tree as it is when the declaration loads. That judgement covers neither the reference's scratch tree, which a ref fills, nor what the program the command names does when it runs, so a `run` or `setup` that names a script",
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      "project's tree as it is when the declaration loads. That judgement covers neither the reference's scratch tree, which a ref fills, nor what the program the command names does when it runs, so a `run` or `setup` that names a script",
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      "project's tree as it is when the declaration loads. That judgement covers neither the reference's scratch tree, which a ref fills, nor what the program the command names does when it runs, so a `run` or `setup` that names a script",
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      "project's tree as it is when the declaration loads. That judgement covers neither the reference's scratch tree, which a ref fills, nor what the program the command names does when it runs, so a `run` or `setup` that names a script",
    ]);
  });

  it('M16 retired wording (r3g): the honest boundary\'s old closing "...a fetch included, and review of the declaration is what covers it." (covering only the script, not also a fetching `setup`) is gone (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = parity();
    expectAbsentFolded(section, [
      'fetch included, and review of the declaration is what covers it.',
    ]);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      'fetch included, and review of the declaration is what covers it.',
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      'fetch included, and review of the declaration is what covers it.',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'fetch included, and review of the declaration is what covers it.',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      'fetch included, and review of the declaration is what covers it.',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      'fetch included, and review of the declaration is what covers it.',
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      'fetch included, and review of the declaration is what covers it.',
    ]);
  });

  it("M16 retired wording (r3g): spec 18's `'parity'` payload clause \"in `FORGE_RUN_ID`; a hunk run's counts\" (no project-root caveat) is gone from §18.4 (r3g item 5: folded, and scanned over specs 17 and 22 too)", () => {
    const section = spec18('## 18.4 ');
    expectAbsentFolded(section, ["in `FORGE_RUN_ID`; a hunk run's counts"]);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      "in `FORGE_RUN_ID`; a hunk run's counts",
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      "in `FORGE_RUN_ID`; a hunk run's counts",
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      "in `FORGE_RUN_ID`; a hunk run's counts",
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      "in `FORGE_RUN_ID`; a hunk run's counts",
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      "in `FORGE_RUN_ID`; a hunk run's counts",
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      "in `FORGE_RUN_ID`; a hunk run's counts",
    ]);
  });

  it('M16 retired wording (r3g): "a `declarations` list, each entry holding the declaration\'s name and digest" (not in order of `name`) is gone from spec 18 §18.7 (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = spec18('## 18.7 ');
    expectAbsentFolded(section, [
      "a `declarations` list, each entry holding the declaration's name and digest",
    ]);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      "a `declarations` list, each entry holding the declaration's name and digest",
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      "a `declarations` list, each entry holding the declaration's name and digest",
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      "a `declarations` list, each entry holding the declaration's name and digest",
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      "a `declarations` list, each entry holding the declaration's name and digest",
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      "a `declarations` list, each entry holding the declaration's name and digest",
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      "a `declarations` list, each entry holding the declaration's name and digest",
    ]);
  });

  it('M16 retired wording (r3g): the §18.7 sentence ending "...flags a `PAR` record or a capture." with no secret-reference exception is gone -- the doctor disclosure now follows in the same sentence (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = spec18('## 18.7 ');
    expectAbsentFolded(section, [
      'that no validation or health check flags a `PAR` record or a capture.',
    ]);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      'that no validation or health check flags a `PAR` record or a capture.',
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      'that no validation or health check flags a `PAR` record or a capture.',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'that no validation or health check flags a `PAR` record or a capture.',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      'that no validation or health check flags a `PAR` record or a capture.',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      'that no validation or health check flags a `PAR` record or a capture.',
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      'that no validation or health check flags a `PAR` record or a capture.',
    ]);
  });

  it('M16 retired wording (r3g): "a bundle without it stays valid. `MutationEvidence` gains" is gone -- "M16 changes no bundle assembler" now sits between them (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = spec18('## 18.7 ');
    expectAbsentFolded(section, ['a bundle without it stays valid. `MutationEvidence` gains']);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      'a bundle without it stays valid. `MutationEvidence` gains',
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      'a bundle without it stays valid. `MutationEvidence` gains',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'a bundle without it stays valid. `MutationEvidence` gains',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      'a bundle without it stays valid. `MutationEvidence` gains',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      'a bundle without it stays valid. `MutationEvidence` gains',
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      'a bundle without it stays valid. `MutationEvidence` gains',
    ]);
  });

  it('M16 retired wording (r3g): "Each is the identity going up" (the migrations\' old going-up rule) is gone from spec 18 §18.7 -- it now sets `schemaVersion: 2` and changes nothing else (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = spec18('## 18.7 ');
    expectAbsentFolded(section, ['Each is the identity going up']);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), ['Each is the identity going up']);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      'Each is the identity going up',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'Each is the identity going up',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      'Each is the identity going up',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), ['Each is the identity going up']);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      'Each is the identity going up',
    ]);
  });

  it('M16 retired wording (r3g): "field-stripping going down" (the migrations\' old going-down rule, stated with no `reversible` gate) is gone from spec 18 §18.7 (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = spec18('## 18.7 ');
    expectAbsentFolded(section, ['field-stripping going down']);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), ['field-stripping going down']);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      'field-stripping going down',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'field-stripping going down',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      'field-stripping going down',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), ['field-stripping going down']);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      'field-stripping going down',
    ]);
  });

  it('M16 retired wording (r3g): "requires. Whether either declares `reversible: true`" is gone -- the golden-fixture "after differs by schemaVersion" sentence now sits between them (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = spec18('## 18.7 ');
    expectAbsentFolded(section, ['requires. Whether either declares `reversible: true`']);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      'requires. Whether either declares `reversible: true`',
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      'requires. Whether either declares `reversible: true`',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'requires. Whether either declares `reversible: true`',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      'requires. Whether either declares `reversible: true`',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      'requires. Whether either declares `reversible: true`',
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      'requires. Whether either declares `reversible: true`',
    ]);
  });

  it('M16 retired wording (r3g): "(`specs/22` M16 P5). As built," is gone -- the reversible-migration\'s going-down behaviour now sits between them (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = spec18('## 18.7 ');
    expectAbsentFolded(section, ['(`specs/22` M16 P5). As built,']);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), ['(`specs/22` M16 P5). As built,']);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      '(`specs/22` M16 P5). As built,',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      '(`specs/22` M16 P5). As built,',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      '(`specs/22` M16 P5). As built,',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), ['(`specs/22` M16 P5). As built,']);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      '(`specs/22` M16 P5). As built,',
    ]);
  });

  it('M16 retired wording (r3g): "record stays. A repeated or concurrent prune is idempotent." is gone -- the retention second-enumeration sentence now sits between them (r3g item 5: folded, and scanned over specs 17 and 22 too)', () => {
    const section = spec18('## 18.7 ');
    expectAbsentFolded(section, [
      'the record stays. A repeated or concurrent prune is idempotent.',
    ]);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      'the record stays. A repeated or concurrent prune is idempotent.',
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      'the record stays. A repeated or concurrent prune is idempotent.',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'the record stays. A repeated or concurrent prune is idempotent.',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      'the record stays. A repeated or concurrent prune is idempotent.',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      'the record stays. A repeated or concurrent prune is idempotent.',
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      'the record stays. A repeated or concurrent prune is idempotent.',
    ]);
  });

  it("M16 retired wording (r3g item 5): specs/03's pre-M16 `forge test <sub>` row, with no `binding` or `exempt`, is gone", () => {
    const section = spec03();
    expectAbsentFolded(section, [
      '`forge test <sub>` | `plan`, `generate`, `run`, `report`, `flaky`, `coverage` |',
    ]);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      '`forge test <sub>` | `plan`, `generate`, `run`, `report`, `flaky`, `coverage` |',
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      '`forge test <sub>` | `plan`, `generate`, `run`, `report`, `flaky`, `coverage` |',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      '`forge test <sub>` | `plan`, `generate`, `run`, `report`, `flaky`, `coverage` |',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      '`forge test <sub>` | `plan`, `generate`, `run`, `report`, `flaky`, `coverage` |',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      '`forge test <sub>` | `plan`, `generate`, `run`, `report`, `flaky`, `coverage` |',
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      '`forge test <sub>` | `plan`, `generate`, `run`, `report`, `flaky`, `coverage` |',
    ]);
  });

  it("M16 referent (r3g item 6): specs/03's upgrade-step 3 backs up to a timestamped tarball, retaining the last 5 (the referent of 03:124's 'retain last 5' citation)", () => {
    expectLines(wholeFile('03-cli-and-installer.md'), [
      '3. **Back up** `docs/forge/` + `.forge/` to `.forge/backups/<timestamp>.tar.gz` (retain last 5).',
    ]);
  });

  it("M16 referent (r3g item 6): the Gate catalogue holds exactly ten rows, the referent of 10:282's 'the ten lifecycle gates of the catalogue below'", () => {
    expectClause(spec10Gates(), [
      '| `G-Problem` |',
      '| `G-Product` |',
      '| `G-Design` |',
      '| `G-Foundation` |',
      '| `G-Ready` |',
      '| `G-Verify` |',
      '| `G-Stable` |',
      '| `G-Integration` (L4) |',
      '| `G-Deliver` |',
      '| `G-Operate` |',
    ]);
  });

  it('M16 referent (r3g item 6): the Gate catalogue table is exactly these ten rows, in this order, none inserted, removed or swapped (closes the count an `expectClause` alone cannot)', () => {
    const section = spec10GateCatalogue();
    expectBlockOrder(section, [
      '### Gate catalogue',
      '| Gate | Fails on (deterministic examples) | |---|---|',
      '| `G-Problem` | No measurable success metric; no identified user; scope contradicts constraints |',
      '| `G-Product` | Capability without acceptance summary; non-numeric NFR; unresolved blocking OQ |',
      '| `G-Design` | Missing ADR coverage; undefined interface refs; KB contradiction; unmodelled NFR; missing or drifted required diagrams (C4 context/container, ER, sequence per cross-boundary flow) |',
      "| `G-Foundation` | Clean clone doesn't build; no reproducible install; CI skeleton absent; no test command; walking skeleton not deployed to a development environment |",
      '| `G-Ready` | DoR violations; story overlap in file claims; unbound ACs; oversized stories |',
      '| `G-Verify` | Failing tests; AC coverage < 100% for done stories; coverage below threshold; lint/typecheck; non-behaviourally-bound tests (post-v1.0, `specs/22` M15, `13` F-TEST-5) |',
      '| `G-Stable` | Open Sev1/Sev2 defects; flaky tests above threshold; unresolved RCA |',
      '| `G-Integration` (L4) | Cross-service contract tests failing; version skew; migration order violations |',
      '| `G-Deliver` | Deploy dry-run fails; rollback untested; secrets unresolved; smoke tests fail in target env; deployment topology and pipeline diagrams missing or stale |',
      '| `G-Operate` | No dashboards/alerts for stage SLOs; runbook missing for each Sev1 failure mode; KB not synced |',
    ]);
  });

  it("M16 referent (r3g item 6): specs/20 §20.1's network allowlist is specific, not a wildcard ('no `*`'), the referent 13:331's 'may not name a `*`' rests on", () => {
    const section = spec20('## 20.1 ');
    expectPinned(section, [
      'Package installation is the common exception and is handled as a **specific allowlist** of registry hosts, not by opening the network.',
    ]);
    expectClause(section, [
      'exact strings, never a wildcard, and only a command that is one plain invocation (no chaining, no `*`, no expansion).',
    ]);
  });

  it('M16 specs/18 §18.7 (r3g item 7): the writer refuses a write to an already-existing path of either type, rather than relying on the naming scheme alone against a collision', () => {
    const section = spec18('## 18.7 ');
    expectPinned(section, [
      'The writer refuses an attempt to write to an already-existing path of either type (`PLAN-M15.md` P2\'s own "a bundle that edits an existing evidence record is refused" test) rather than relying on the naming scheme alone to make collision merely unlikely.',
    ]);
  });

  it("M16 specs/10 §10.3 rule 6 (r3g item 7): under the FORGE session marker, the command tells an agent's own spawned session from a person's own shell -- the marker's purpose clause", () => {
    const section = spec10Gates();
    expectClause(section, [
      "the command tells an agent's own spawned session from a person's own shell: with no marker, or one naming a different run than the one being approved, it is a person (`human`), and `--owner` is the person's own word regardless",
    ]);
  });

  it("M16 retired wording (r3g item 5): specs/18's retired unbounded-retention claim -- an older instance stays on disk and nothing is ever removed -- is gone", () => {
    const section = spec18('## 18.7 ');
    expectAbsentFolded(section, [
      'An older instance stays on disk, readable, and a newer one exists; nothing is ever removed.',
    ]);
    expectAbsentFolded(wholeFile('03-cli-and-installer.md'), [
      'An older instance stays on disk, readable, and a newer one exists; nothing is ever removed.',
    ]);
    expectAbsentFolded(wholeFile('10-workflow-engine-and-lifecycle.md'), [
      'An older instance stays on disk, readable, and a newer one exists; nothing is ever removed.',
    ]);
    expectAbsentFolded(wholeFile('13-frameworks-testing-and-debugging.md'), [
      'An older instance stays on disk, readable, and a newer one exists; nothing is ever removed.',
    ]);
    expectAbsentFolded(wholeFile('17-brownfield-ingestion.md'), [
      'An older instance stays on disk, readable, and a newer one exists; nothing is ever removed.',
    ]);
    expectAbsentFolded(wholeFile('18-persistence-config-and-schemas.md'), [
      'An older instance stays on disk, readable, and a newer one exists; nothing is ever removed.',
    ]);
    expectAbsentFolded(wholeFile('22-build-plan-and-milestones.md'), [
      'An older instance stays on disk, readable, and a newer one exists; nothing is ever removed.',
    ]);
  });

  it("M16 F-TEST-9 (r3g items 1/2): the section's blocks, in order, are exactly these, none inserted, removed, swapped or relocated", () => {
    const section = parity();
    expectBlockOrder(section, [
      '### F-TEST-9 · Parity oracles: the differential and referenc',
      "F-TEST-2's oracles 5 and 6 compare against a reference — the",
      '**The declaration** is `.forge/parity/<name>.parity.yaml`, o',
      "**A capture** is the reference's observed, normalised behavi",
      '**The trust anchor.** A declaration, probe or capture that w',
      "**The anchor's boundary.** The comparison makes a rewritten ",
      '**Stability.** A reference that disagrees with itself is not',
      '**A reference that did not do what was expected is not an or',
      '**Normalisation** is declarative and bounded: no code from a',
      '**The surfaces** are four, and only declared surfaces are ob',
      '**The library probe protocol.** The `library` surface is a `',
      '**The environment is pinned.** Every case runs in a scrubbed',
      '**Where each side is observed.** The reference in a scratch ',
      '**Verdicts.** There are nine, at two levels, listed here in ',
      '`invalid` — the declaration does not load or cannot be trust',
      "`expired` — the declaration's `expires` date, or an `unobser",
      '`missing` — no capture is selected for the declaration, or t',
      '`ambiguous` — two or more differing captures share one selec',
      '`error` — the harness could not complete the case: a timeout',
      "`unclean` — observing changed the candidate's tree, or a cas",
      '`unstable` — the candidate (at check) or the reference (at c',
      "`mismatch` — the candidate's normalised observation differs ",
      "`match` — the candidate's normalised observation equals the ",
      '**Precedence is total**: `invalid`, `expired`, `missing`, `a',
      '**Counting.** The unit is the case. `passing` counts the cas',
      '**`unobservable`** declares, by a human, that a surface genu',
      '**Capture selection.** A capture is selected by the key `(na',
      '**`platform`** is the operating system and CPU architecture ',
      '**What the check prints.** `forge parity check --json` print',
      '**Evidence.** One `forge parity check` invocation writes one',
      '**The honest boundary.** A green parity check says the **dec',
    ]);
  });

  it("M16 F-TEST-9 block [1] (r3g items 1/2): F-TEST-2's oracles 5 and 6 compare against a reference — the implementat...", () => {
    const section = parity();
    expectBlock(section, [
      "F-TEST-2's oracles 5 and 6 compare against a reference — the implementation before a change, or an implementation the project already trusts and holds at a git ref — and until now said nothing about what such a comparison must rest on.",
      'The danger is the one F-TEST-2 already bans: a "reference" recorded from the code under test is that code agreeing with itself.',
      'A **parity oracle**',
      "is therefore a *reviewed declaration* plus an *immutable capture* of the reference's behaviour, never a recording of whatever the candidate does.",
      "Parity applies only where a reference exists: a `refactor` always has one (the code before the change), `adopt`'s is the system as found (`17` §17.4 item 3), and greenfield work has none, so it must not claim parity and keeps relying on behavioural binding (F-TEST-5).",
    ]);
  });

  it('M16 F-TEST-9 block [2] (r3g items 1/2): The declaration', () => {
    const section = parity();
    expectBlock(section, [
      '**The declaration**',
      'is `.forge/parity/<name>.parity.yaml`, one file per declaration, its `name` the file stem.',
      'It names the reference (`reference.ref`) and the surfaces to compare.',
      "`reference.ref` is a full commit sha (40 hexadecimal digits, or 64 in a repository that uses SHA-256) or a tag name, resolved to the commit it points at: a sha as `<sha>^{commit}` and a tag as `refs/tags/<name>^{commit}` (so a tag is peeled), with replace objects disabled, because an unqualified name follows git's own ambiguity rules and a ref planted elsewhere could win, and under the exactness rules that the trust anchor states below (a tag name that `git check-ref-format` does not accept as `refs/tags/<name>`, `v1~1` for one, is `invalid`); `HEAD` and an abbreviated sha are each `invalid`, because each can move or be ambiguous.",
      'So, checked explicitly against `refs/heads/<name>` and regardless of whether a tag of the identical name also exists, is a name that names a branch, since a branch moves exactly as `HEAD` does, which the self-agreeing oracle (F-TEST-2) bans as a reference; a bare name that names no branch is resolved only as a tag, so one with no matching tag reads `missing`, never `invalid`.',
      'The declaration is human-authored and committed.',
      'It is not unwritable by an agent: `.forge/**` is in the never-writable floor for agent steps, but that floor is enforced after the fact, by claim enforcement (`06` §6.7), which runs only when the adapter reports changed files, so a session that commits its own work is not reverted (disclosed in `process/SPEC-QUESTIONS.md` Q212).',
      'The floor is therefore not what protects the oracle: the trust anchor below is, and it has a boundary of its own, stated there.',
      'It satisfies "human or spec review" (F-TEST-2) only with a `review` block — `by` (the reviewer), `basis` (what the review rested on) and `at` (when) — **and**',
      'an `expires` date.',
      "A declaration missing either is `invalid`; one that has reached its `expires` date is `expired` until a person renews it (the date is read as UTC and expires at its start, as an F-TEST-8 exemption's expiry does).",
      "FORGE enforces the block's presence, shape and expiry; it cannot judge how careful the review was.",
    ]);
  });

  it('M16 F-TEST-9 block [3] (r3g items 1/2): A capture', () => {
    const section = parity();
    expectBlock(section, [
      '**A capture**',
      "is the reference's observed, normalised behaviour, taken at the declared ref in a scratch worktree, never in the candidate's tree, and stored at `.forge/parity/captures/<sha256>.json`.",
      "It holds the declaration's name and digest, the reference's ref and sha, the platform and, for each case, the normalised observation (for a file in `bytes` mode, its sha256 alone), as canonical JSON (compact, with keys sorted at every depth and no trailing newline), in UTF-8; it holds no tool or interpreter version, no clock time and no host path of its own, so identical behaviour is the identical file.",
      'It is **content-addressed**',
      '(its file name is the sha256 of its canonical bytes), **digest-bound**',
      "(it records the declaration's digest: a sha256 over the whole declaration in canonical form, except `review`, `expires` and `unobservable`, joined with the content hashes of the files it overlays and the bytes of the probes it names, so renewing a review does not invalidate a capture and changing anything that determines what is observed, or how, does) and **never overwritten**.",
      "A capture's file name must equal the sha256 of its canonical bytes, which is verified whenever a capture is read: a capture that fails the check is `invalid`, and so is the declaration whose name it records.",
      'Capturing identical behaviour again is a no-op; a capture that would differ from an existing one with the same key is refused, never replacing it and never sitting beside it.',
      'Capture is a human act that no workflow runs, so a refactor cannot mint its own oracle, and `forge parity capture` refuses whenever the FORGE session marker `FORGE_RUN_ID` is present, whichever run it names (`10` §10.3 rule 6 defines the marker, an honest-session signal and not a security boundary).',
      'Captures are never pruned (`18` §18.8).',
      "The way out of a refused capture (the reference's behaviour legitimately changed under the same key) and of `ambiguous` is a reviewed commit that deletes the stale capture file; FORGE itself never deletes a capture.",
    ]);
  });

  it('M16 F-TEST-9 block [4] (r3g items 1/2): The trust anchor.', () => {
    const section = parity();
    expectBlock(section, [
      '**The trust anchor.**',
      'A declaration, probe or capture that was rewritten is not an oracle, so `forge parity check --trusted <ref>` compares everything under `.forge/parity/`, whatever `--name` selects, with the tree at `<ref>`, which is a full commit sha or a ref name that begins `refs/` and that `git check-ref-format` accepts; `HEAD`, an abbreviated sha and a bare name (which a tag can shadow) are refused.',
      'It is resolved once, by `git rev-parse --verify <ref>^{commit}` (the form above cannot begin with `-`, so the argument cannot be read as an option), and the commit id that returns is the one every later step uses.',
      "A ref name is resolved only after `git show-ref --verify <ref>` confirms that exact ref exists (a name that merely resolves, as `refs/heads/refs/heads/main` does for `refs/heads/main`, is not that ref), and a sha is accepted only as lower-case digits of the repository's full object-id length, the id `rev-parse` returns having to be those same digits (an abbreviation, an upper-case spelling and a tag object's id are refused).",
      'A `reference.ref` is held to the same rules, a tag being checked as `refs/tags/<name>`: an invalid name or sha is `invalid`, and a valid one that resolves to no commit (a tag that does not exist, for one) is `missing`.',
      "The harness makes the comparison itself and does not ask git what changed: it lists every entry under `.forge/parity/` as it is on disk, without following symlinks and with ignored and untracked entries included, and compares each path, and the git blob id of each file's raw bytes, with the listing of `git ls-tree -r -z <commit> -- .forge/parity` (`<commit>` being that id), run with the project root, the directory that holds `.forge/`, as its working directory.",
      "The blob id is computed in-process, in the repository's object format (a 64-digit commit id means SHA-256), with no filter or line-ending conversion, which `git hash-object <path>` would apply.",
      'It never consults the index or `git status`, which a `skip-worktree` or `assume-unchanged` flag, or an ignore rule, can blind.',
      'Every git command the harness runs has replace objects disabled (`GIT_NO_REPLACE_OBJECTS=1`), because `git replace` can make a ref read as a different tree.',
      'The comparison is made first, before any case runs, and, when a case ran, again after the last, against the same commit id, so a ref that moves while the check runs does not move the anchor.',
      'A path added, modified or deleted relative to that tree is `oracle-changed`, whether the difference is committed, staged, untracked or ignored, and so is a symlink or any other entry that is neither a regular file nor a directory, whatever the tree holds (`.forge` and `.forge/parity` themselves included: where present, each must be a directory), and so is an entry that cannot be read.',
      'Modified means a different blob id.',
      "A file's mode (its executable bit) is not compared, and an empty directory, which git records no entry for, is not an entry: the harness executes nothing under `.forge/parity/` in place (an overlaid file is written as a plain file, below) and loads nothing from a mode or an empty directory, so neither can change what it loads or runs.",
      'Paths are compared as raw bytes, so a case-only or Unicode-normalisation respelling reads as one path deleted and another added.',
      'A checkout that converts bytes (line endings, an `ident` expansion, a smudge filter, a `working-tree-encoding`) reads as a modification, so a project marks `.forge/parity/**` `-text -filter -ident -working-tree-encoding` in its `.gitattributes`: `-text` alone cures only the line endings.',
      '`oracle-changed` makes every declaration `invalid` and the overall verdict `invalid`, and the envelope carries it as its own `reason`, naming each differing path, even when the change was the deletion of every declaration, which reads `oracle-changed` and not `no-declarations`.',
      'At the first comparison each file is read once: the bytes compared are the bytes loaded, and a probe or an overlaid file is written into the tree under observation from those same bytes, never read from `.forge/parity/` again.',
      'The second comparison reads the tree afresh, only to compare it again, and loads nothing.',
      'A `--trusted` that is not in the form above, or that does not resolve, is a refusal (`ok: false`), never a skipped comparison; without `--trusted` the check makes no comparison and the evidence records `trusted: null`.',
      "The `G-Parity` gate's one check is `forge parity check --json --no-record --trusted refs/heads/main` (`10` §10.3 rule 8), so inside a workflow run the anchor is trunk, an explicit argument of the command and nothing sniffed from the environment.",
    ]);
  });

  it("M16 F-TEST-9 block [5] (r3g items 1/2): The anchor's boundary. (reworded M17 P1: the self-reverting-tamper clause is replaced by the candidate-side isolation sentence)", () => {
    const section = parity();
    expectBlock(section, [
      "**The anchor's boundary.**",
      'The comparison makes a rewritten oracle fail the evaluation that sees it, in that run and in every later one until the anchor and the tree agree again.',
      'It does not prevent the rewrite or its landing: a lane is integrated onto the integration branch between ticks whatever a gate says, so the gate that sees a rewrite sees it after it has landed there; an agent with a shell can move a ref; and a project that configures its integration branch to be the trunk itself gets no protection, because lanes then land on the anchor.',
      "A candidate case's own command cannot write or restore anything under `.forge/parity/` while it runs (above, a read-only isolation mechanism still permitting a read), which closes the one self-reverting-tamper gap this boundary used to carry for the candidate side; it can still change and restore any OTHER file in the tree between the two comparisons, which neither comparison sees (the harness uses only the bytes it loaded, so such a change alters nothing the harness itself writes into a tree or compares, but the case's own command can read that other file while it is changed, and can do anything else the user can outside `.forge/parity/`).",
      "It cannot tell a person's deliberate change from an agent's: a reviewed change to `.forge/parity/` is trusted once it is on the anchor, and until then reads `oracle-changed`.",
      "The gates a run evaluates are read from the main project when the run starts, so a lane's edit of a gate or check file does not change that run.",
      'By hand, `forge gate check G-Parity` runs the same command, so it compares with trunk too.',
    ]);
  });

  it('M16 F-TEST-9 block [6] (r3g items 1/2): Stability.', () => {
    const section = parity();
    expectBlock(section, [
      '**Stability.**',
      'A reference that disagrees with itself is not an oracle.',
      'At capture each case runs `stability.runs` times against the reference (default 3; an integer from 2 to 10, else the declaration is `invalid`) and every run must be equal after normalisation, else the case is `unstable` and capture refuses and writes nothing.',
      'At check each case runs `stability.runs` times on the candidate, and every run must be equal after normalisation, else the case is `unstable`; the value the runs share is what is compared with the capture.',
      'Stability is a sample: a case that varies too rarely for `stability.runs` runs to show it can still read `match`.',
    ]);
  });

  it('M16 F-TEST-9 block [7] (r3g items 1/2): A reference that did not do what was expected is not an oracle either.', () => {
    const section = parity();
    expectBlock(section, [
      '**A reference that did not do what was expected is not an oracle either.**',
      "Capture refuses a case whose reference run exits with a code other than the case's declared `expect` exit (default 0), a run that a signal ended included, and a case whose entire observation is empty unless it declares `expect: empty`.",
    ]);
  });

  it('M16 F-TEST-9 block [8] (r3g items 1/2): Normalisation (reworded M17 P1: the root-token/replace requirement and the wall-clock budget are inserted; reworded M17 P14, Q317 Decision 8: `redact-json-pointers` joins the rule list and its one ordering exception against `ignore-json-pointers` is inserted)', () => {
    const section = parity();
    expectBlock(section, [
      '**Normalisation**',
      'is declarative and bounded: no code from a declaration runs.',
      "Before any declared rule runs, the harness rewrites each observed tree's root path, both as given and as its real path, to a fixed token, so where a tree happens to live is not a behaviour difference.",
      '**This root-path rewrite must not be combinable with a declared `replace` rule in a way that can mask a real regression**',
      "(post-v1.0, `specs/22` M17): a root-path token substitution that does not preserve length parity between the reference and the candidate shifts a later, length-anchored `replace` rule's own cut point by a different offset on each side, which can turn a genuine PASS-vs-FAIL difference into byte-identical normalised text on both sides, silently erasing it.",
      "The exact mechanism that closes this — a length-preserving token, a change to the order or composition of the root rewrite against a `replace` rule, or provenance tracking through the later rule so a cut point is reported in pre-rewrite coordinates — is this milestone's own BUILD decision, not fixed here: any of the three satisfies the requirement, and the build is proven against a real repro of the masking behaviour (and a new adversarial round beyond it), not merely asserted safe.",
      "The rules are `strip-ansi`, `line-endings`, `trim-trailing-whitespace`, `sort-lines`, `json-canonical` (parse, sort keys, re-serialise; a non-JSON observation is an error, not a pass), `ignore-json-pointers`, `replace` (a regular-expression source with a literal replacement, scoped to a stream or an output file, linted at load for catastrophic-backtracking shapes — conservative, not a proof of linear time — and run, together with every other rule a declaration lists for one case, under a single stated wall-clock budget (post-v1.0, `specs/22` M17; default 5000 ms, bounding the whole ordered application for that case, not merely one `replace` rule's own match), exceeding which makes the case `error`, a typed refusal, never a hang — the lint at load is advisory defence in depth against a known catastrophic shape, never a substitute for this runtime bound, which also catches a pathological shape the lint's own heuristic misses or a merely large observation) and `redact-json-pointers` (post-v1.0, `specs/22` M17, `process/SPEC-QUESTIONS.md` Q317 Decision 8: at each of its own named pointers, replaces every match of a regular-expression `pattern` found within the STRING there with a literal `replacement`, never deleting the member the way `ignore-json- pointers` does — the one mechanism that can redact a real filesystem path, or any other substring, embedded inside a `library` surface's own structured result, which carries no raw text for `replace` to run against at all.",
      "Refused outright on every surface the root-path rewrite above reaches (`process`/`file`/`http`), for the identical reason `replace` already is there, and so meaningful only on `library`, which the rewrite never touches — its own regular expression runs under the IDENTICAL wall-clock budget, forcibly terminated the identical way, as every other rule's own catastrophic-backtracking shape, even though `library`'s own structured result never passes through the text-shaped rules above at all).",
      'The rules run in the order a declaration lists them, with ONE named exception (post-v1.0, `specs/22` M17, `process/SPEC-QUESTIONS.md` Q317 Decision 8): on the `library` surface, where both `ignore-json-pointers` and `redact-json-pointers` are declared on the same case, `redact-json-pointers` always resolves FIRST, against the value exactly as observed, before `ignore-json-pointers` removes anything, regardless of which the declaration lists first.',
      "`ignore-json-pointers`' own removal can splice an array, shifting a later sibling's own index — resolving `redact-json-pointers` against the result of that shift would force whichever pointer a reviewer writes to depend on an authoring convention they cannot see just by reading the declaration next to the real observed JSON; resolving it first, against the untouched value, needs no such convention and was proven necessary by two independent, adversarial rounds, each in the opposite direction, each confirming a real, silent, unredacted leak under the other order.",
      'This is the only ordering exception among the rules; `line-endings` rewrites CRLF and a lone CR as LF; `strip-ansi` removes CSI escape sequences (`ESC [`, parameter and intermediate bytes, then a final byte); `trim-trailing-whitespace` removes the spaces and tabs at the end of each line; `sort-lines` orders lines by UTF-16 code unit; and `replace` replaces every match.',
      "A rule that would erase a non-empty observation entirely is refused, and so is a `replace` (or a `redact-json-pointers` pointer's own match) whose match is the entire content of a non-empty stream or field: a surface that does not want a stream says so with `streams` (below) rather than erasing it.",
      '**Equality is decided on the full normalised content**, never on a truncated display: a mismatch report shows the first differing line with context under a byte cap, labelled as display only, and printed only without `--json`: an envelope and a `ParityEvidence` record carry no observed text, and a `reason` says where a difference is (the surface, the case and the stream), never what the text was.',
      'The secret check runs on exactly what would be stored, which is the observation after normalisation.',
      'An observation that contains a secret, or a text observation that does not decode as UTF-8, is refused at capture, before anything is stored.',
    ]);
  });

  it('M16 F-TEST-9 block [9] (r3g items 1/2): The surfaces', () => {
    const section = parity();
    expectBlock(section, [
      '**The surfaces**',
      'are four, and only declared surfaces are observed; everything else is unobserved.',
      'A declaration lists its surfaces, each surface lists its own cases (at least one: a surface that lists none observes nothing, and its declaration is `invalid`), and a case belongs to exactly one surface and is run against that surface alone.',
      '`process` observes the stdout, stderr and exit code of a vetted command, or, where a signal ended the process and so there is no exit code, that signal.',
      "Vetting is the engine's check of a command that a project stores and FORGE runs (the confinement model of `20` §20.1, as the engine applies it to a stored command): one plain invocation, with no chaining, redirection or substitution, no variable, tilde or brace expansion and no shell `-c` string, nothing on the hard denylist, and `network: none`, which no declaration can relax for a command, so a program on the engine's list of network programs (`curl`, `wget` and `ssh`, for three), a URL and, for the package managers the engine knows, a verb that fetches or changes dependencies (an install, for one) are refused, and every path it names that exists, a glob's matches included, must stay inside the project, a symlink being followed to where it ends (a path that does not exist yet is judged by its text alone).",
      "It also refuses what the engine's other lists name: some programs that run another program (`env`, `xargs`, `timeout`), some that change files or the environment (`rm`, `mv`, `chmod`), some package runners that fetch what they run (`npx`), `find` with `-exec`, `-execdir`, `-ok`, `-okdir` or `-delete`, a git subcommand outside the engine's read-only set, and a path whose name, as written, matches the engine's patterns for a secret file, `.git` or `.forge/state`.",
      'Those lists, the one of network programs included, are closed, not classes, so a program or path on none of them passes (`cp`, `touch` and `python3 -m pip install` do), and vetting is a filter on what a reviewed declaration can say, not a sandbox.',
      'A glob is allowed, unlike in the test command that `20` §20.1 grants, which may not name a `*`.',
      "Vetting is applied when the declaration loads, against the project's tree, whichever tree a command later runs in.",
      "A `run` or `setup` that vetting refuses, a `run` composed with a case's arguments (below) included, makes the declaration `invalid`, so a declaration that can never run fails at load.",
      'A surface that wants only some of the two streams lists them with `streams` (for example `streams: [stdout]`), and an unlisted stream is unobserved, which shows in review and is reported in the evidence.',
      '`file` observes declared output files at declared paths, cleaned before and after each case.',
      'An output path must be relative, with no `..` component, and lie outside `.git` and `.forge`, and one that is tracked in git in the tree being observed is `invalid`; before cleaning, the harness examines each component of the path without following links, and a case whose output path passes through a symlink is `error`.',
      'Cleaning therefore deletes only a file the reviewed declaration names, and never a tracked one.',
      'A declared file that is not text is declared in `bytes` mode: only its sha256 is observed and stored, never its content.',
      '`library` is the probe protocol below.',
      "`http` observes a request/response pair through an in-process client against a loopback server the harness starts with the declaration's vetted start command: an explicit opt-in in the declaration (`network: loopback`, visible in review), with a literal loopback port verified free before the server starts — a held port makes the case `error`, never a comparison against whatever is listening — and a client that refuses any other host.",
      "A case has no placeholders: its inputs are overlaid files, copied from under `.forge/parity/` (where the trust anchor covers them) to a declared destination in the tree being observed, under the output-path rule above, written from the bytes the harness loaded as a plain file with mode 0644 whatever the source's (so a script is run through its interpreter), and removed after the case.",
      "Its arguments are literal words: each is appended to the surface's `run` as one single-quoted word, and the composed line is what vetting judges at load and what runs, so an argument that holds a single quote, a newline or a shell operator such as `;` or `|` cannot be declared (the declaration is `invalid`), and a value that cannot be a word is an overlaid input instead.",
      'A destination that already exists in that tree makes the case `error`; it is never overwritten.',
    ]);
  });

  it('M16 F-TEST-9 block [10] (r3g items 1/2): The library probe protocol.', () => {
    const section = parity();
    expectBlock(section, [
      '**The library probe protocol.**',
      'The `library` surface is a `process` surface whose command is a reviewed probe script under `.forge/parity/probes/`.',
      'The probe calls the library and prints exactly one JSON object on stdout: `{"ok": true, "value": ...}` for a return, or `{"ok": false, "error": {"name": ..., "message": ...}}` for a thrown error.',
      'A throw is an observation, compared like a return; a stack trace is not part of the protocol, because it carries host paths.',
      'Stdout that is not exactly one such object is `error`, never `match`.',
      "The probe's bytes are in the declaration digest and it is overlaid into whichever tree is observed, from the bytes the harness loaded, so the same reviewed bytes run against the reference and the candidate; being under `.forge/parity/`, it is covered by the trust anchor.",
    ]);
  });

  it('M16 F-TEST-9 block [11] (r3g items 1/2): The environment is pinned.', () => {
    const section = parity();
    expectBlock(section, [
      '**The environment is pinned.**',
      'Every case runs in a scrubbed environment with `TZ=UTC`, `LC_ALL=C.UTF-8` and `LANG=C.UTF-8`, so a locale or timezone difference between machines is not a behaviour difference.',
    ]);
  });

  it('M16 F-TEST-9 block [12] (r3g items 1/2): Where each side is observed. (reworded M17 P1: the candidate-side isolation sentence is inserted; reworded M17 P8: the reference tree moves outside the project)', () => {
    const section = parity();
    expectBlock(section, [
      '**Where each side is observed.**',
      "The reference in a scratch worktree at the declared ref, placed outside the project's own working tree, under the user's cache directory (`18`'s Worktree location paragraph, post-v1.0 `specs/22` M17) and always removed; the candidate in place, with its head sha, a dirty flag and a digest of its working-tree delta recorded.",
      "**Observing the candidate isolates `.forge/parity/` from the candidate's own case commands**",
      "(post-v1.0, `specs/22` M17): the directory is either absent from the tree the case's own `run` sees, or mounted read-only for it, closing the self-reverting-tamper gap the honest boundary below used to disclose rather than close — a case that reads a capture's own stored observation while it runs, edits it, and restores it before the trust anchor's second comparison, which the anchor cannot see either way (its two comparisons bracket the run, never watch it continuously).",
      "Which of the two mechanisms is used is this milestone's own BUILD decision; either makes a case's own `run` unable to write or restore anything under `.forge/parity/` for the duration of its run (a read-only mechanism still permits a read, which the honest boundary below states), which the anchor's own boundary sentence below is corrected to state.",
      "The scratch tree holds the ref's tracked files and nothing installed or built.",
      "Before M17 P8, this tree lived beneath the project directory, so a runtime that finds dependencies by walking up the directory tree (Node's `node_modules`) reached the candidate's own installed copy from both sides as an emergent property of that nesting, never something the engine itself implemented.",
      "Once P8 moved it outside the project's own working tree, that walk-up stopped reaching the candidate's installed packages at all — a disclosed regression (`SPEC-QUESTIONS.md` Q314) the harness now closes explicitly: before any surface's `setup` or `run` reaches the scratch tree, the project's own top-level `node_modules` is symlinked into the scratch tree's root, restoring the identical \"both sides run against one installed copy\" reach the old nesting gave by accident, now as a reviewable mechanism rather than one.",
      "`NODE_PATH` was considered and rejected (Node's own ESM resolver never consults it, so an `import`-based command would still fail), as was a declaration-authored `setup` command (`network: none` already refuses a package-manager install verb, below, so a declaration has no vetted way to populate `node_modules` itself).",
      "This still reaches only the project's top-level `node_modules`, matching the old mechanism's own real reach — a workspace package's own nested `node_modules` was never found by the pre-P8 walk-up either.",
      'For any runtime other than Node, and for anything that must be built from the tracked files, a declaration carries `setup` commands, vetted exactly as `run` is (so `network: none` applies to a `setup` too: an install by a package manager the engine knows is refused, and a declaration is not given the registry allowlist that `20` §20.1 allows an agent that needs one, so `setup` is meant to build from what is tracked, which vetting narrows and does not enforce: see the honest boundary), whose bytes are in the declaration digest and which run only in the scratch tree, before the reference is observed (so only at capture: a check observes the candidate alone and runs no `setup`).',
      'With none, a surface that needs more than the tracked files cannot be observed on the reference side, and the declaration must say how to get it.',
      'FORGE builds nothing for the candidate.',
      "A case's command is the same on both sides, so one that reads build output must build it itself: ignored build output is outside the declaration digest, the anchor and the snapshot below, so a stale build of the candidate is not detected and can read as `match`.",
      "Observing must leave the candidate's tree unchanged.",
      "Before and after each case the harness takes a snapshot: `HEAD`, plus, for every path that `git status --porcelain=v1 -z --no-renames --untracked-files=all` lists (its paths are relative to the repository's top level, which can lie above the project root, and are resolved from there), its status code and a digest of its bytes (or `absent`, `dir` or `link:<target>` where it is not a regular file).",
      'The delta digest recorded for the candidate is the digest of the snapshot taken before the first case, and a case whose two snapshots differ is `unclean`.',
      'An ignored file is not part of a snapshot, and neither is a tracked file marked `skip-worktree` or `assume-unchanged`, so a change to either is not observed.',
    ]);
  });

  it('M16 F-TEST-9 block [13] (r3g items 1/2): Verdicts.', () => {
    const section = parity();
    expectBlock(section, [
      '**Verdicts.**',
      'There are nine, at two levels, listed here in precedence order.',
      'Four are decided about a **declaration**: `invalid`, `expired`, `missing` and `ambiguous`.',
      "Each is decided before any case is observed and stops that declaration's cases from running.",
      "There is one exception: the trust anchor's second comparison, made after the last case, can still find `oracle-changed`, which makes every declaration `invalid` and means that no case's result counts.",
      'Five are decided about a **case**, which runs only when its declaration was not stopped: `error`, `unclean`, `unstable`, `mismatch` and `match`.',
      'Each case that is run ends in exactly one of the five.',
    ]);
  });

  it('M16 F-TEST-9 block [14] (r3g items 1/2): invalid — the declaration does not load or cannot be trusted: an unknown...', () => {
    const section = parity();
    expectBlock(section, [
      "`invalid` — the declaration does not load or cannot be trusted: an unknown key, a missing `review` or `expires`, a `name` that is not its file stem, a `reference.ref` that is not a full commit sha or a tag name, a `stability.runs` outside 2 to 10, a `run` or `setup` command, or a `run` composed with a case's arguments, that vetting refuses, a surface that lists no case, an output path or overlay destination that is absolute, has a `..` component or lies under `.git` or `.forge`, a declared `file` output tracked in git, a capture whose file name is not the sha256 of its bytes, an `unobservable` entry that names no surface of the declaration, an oracle that changed since its trust anchor (`oracle-changed`), or a declaration that compares nothing (`nothing-compared`: it has no surface that is not exempt).",
    ]);
  });

  it("M16 F-TEST-9 block [15] (r3g items 1/2): expired — the declaration's expires date, or an unobservable entry's exp...", () => {
    const section = parity();
    expectBlock(section, [
      "`expired` — the declaration's `expires` date, or an `unobservable` entry's expiry, has been reached (a date is read as UTC and expires at its start).",
    ]);
  });

  it('M16 F-TEST-9 block [16] (r3g items 1/2): missing — no capture is selected for the declaration, or the one selecte...', () => {
    const section = parity();
    expectBlock(section, [
      '`missing` — no capture is selected for the declaration, or the one selected holds no entry for a case that is compared (see capture selection).',
    ]);
  });

  it('M16 F-TEST-9 block [17] (r3g items 1/2): ambiguous — two or more differing captures share one selection key.', () => {
    const section = parity();
    expectBlock(section, ['`ambiguous` — two or more differing captures share one selection key.']);
  });

  it('M16 F-TEST-9 block [18] (r3g items 1/2): error — the harness could not complete the case: a timeout, an output ov...', () => {
    const section = parity();
    expectBlock(section, [
      '`error` — the harness could not complete the case: a timeout, an output over its cap, a probe that printed no well-formed object, a rule that cannot be applied (a `replace` over its time limit included), an output path that passes through a symlink, an overlay destination that already exists, a snapshot that cannot be taken, a loopback port that is not free.',
    ]);
  });

  it("M16 F-TEST-9 block [19] (r3g items 1/2): unclean — observing changed the candidate's tree, or a case wrote outsid...", () => {
    const section = parity();
    expectBlock(section, [
      "`unclean` — observing changed the candidate's tree, or a case wrote outside its declared outputs.",
    ]);
  });

  it('M16 F-TEST-9 block [20] (r3g items 1/2): unstable — the candidate (at check) or the reference (at capture) disagr...', () => {
    const section = parity();
    expectBlock(section, [
      '`unstable` — the candidate (at check) or the reference (at capture) disagrees with itself across repeated runs.',
    ]);
  });

  it("M16 F-TEST-9 block [21] (r3g items 1/2): mismatch — the candidate's normalised observation differs from the captu...", () => {
    const section = parity();
    expectBlock(section, [
      "`mismatch` — the candidate's normalised observation differs from the capture's.",
    ]);
  });

  it("M16 F-TEST-9 block [22] (r3g items 1/2): match — the candidate's normalised observation equals the capture's, in ...", () => {
    const section = parity();
    expectBlock(section, [
      "`match` — the candidate's normalised observation equals the capture's, in full.",
    ]);
  });

  it('M16 F-TEST-9 block [23] (r3g items 1/2): Precedence is total: invalid, expired, missing, ambiguous, error, unclea...', () => {
    const section = parity();
    expectBlock(section, [
      '**Precedence is total**: `invalid`, `expired`, `missing`, `ambiguous`, `error`, `unclean`, `unstable`, `mismatch`, `match`, and the first that applies is the one reported.',
      "The same order picks a declaration's verdict from its cases' verdicts and a record's overall verdict from its declarations'.",
    ]);
  });

  it('M16 F-TEST-9 block [24] (r3g items 1/2): Counting.', () => {
    const section = parity();
    expectBlock(section, [
      '**Counting.**',
      'The unit is the case.',
      '`passing` counts the cases that are `match`, in declarations that were not stopped at declaration level.',
      '`failing` counts the cases that are not `match`, plus one for each declaration that was stopped at declaration level, however many cases it declares.',
      'A case on an exempt surface is not run and has no verdict: the exempt count is separate (below), counts surfaces, is never failing and is never counted as compared.',
      'A check with no declaration at all counts one failing and no passing, and its overall verdict is `invalid` with the `reason` `no-declarations`.',
      'A declaration that was not stopped has a surface that is not exempt, and every surface lists a case, so it runs at least one case: `failing` is 0 only when `passing` is at least 1, and a check that compared nothing cannot pass.',
      'A check that would still print 0 passing and 0 failing is a refusal instead, as is a `--name` that matches no declaration, which names the declarations that exist.',
    ]);
  });

  it('M16 F-TEST-9 block [25] (r3g items 1/2): unobservable', () => {
    const section = parity();
    expectBlock(section, [
      '**`unobservable`**',
      'declares, by a human, that a surface genuinely cannot be observed, and names that surface.',
      'Each entry carries a reason, an owner and an expiry — the shape of an F-TEST-8 exemption.',
      "The surface's cases are not run and have no verdict: it counts in its own exempt bucket, once per surface, and never as a match.",
      'An entry excuses one surface, never a whole declaration (one whose every surface is excused compares nothing: `nothing-compared`), and an expired entry fails (`expired`).',
    ]);
  });

  it('M16 F-TEST-9 block [26] (r3g items 1/2): Capture selection.', () => {
    const section = parity();
    expectBlock(section, [
      '**Capture selection.**',
      'A capture is selected by the key `(name, declaration digest, reference sha, platform)`, the reference sha being the one `reference.ref` resolves to when the check runs.',
      'None selected is `missing` — which is what a capture taken under an older digest, at another reference sha (a tag that has since moved or been deleted, for one) or on another platform reads as: it is never silently compared.',
      'Two or more differing captures under one key is `ambiguous`.',
      "A selected capture that holds no entry for one of the declaration's cases on a surface that is not exempt (an `unobservable` entry removed since the capture was taken) also reads `missing`, never a partial comparison.",
    ]);
  });

  it('M16 F-TEST-9 block [27] (r3g items 1/2): platform', () => {
    const section = parity();
    expectBlock(section, [
      '**`platform`**',
      "is the operating system and CPU architecture as the harness's own runtime reports them, `<os>-<arch>` (for example `darwin-arm64` or `linux-x64`); it is not the agent platform of `07`.",
      'Tool and interpreter versions are recorded in the evidence but are not in the key, and **a capture does not pin interpreter versions**: a reference captured under one runtime and a candidate checked under another are compared as they are, and a difference the interpreter causes reads as a `mismatch` for a person to resolve.',
      'A capture on a second platform is a second human act.',
    ]);
  });

  it('M16 F-TEST-9 block [28] (r3g items 1/2): What the check prints.', () => {
    const section = parity();
    expectBlock(section, [
      '**What the check prints.**',
      '`forge parity check --json` prints one `{"v":1,...}` envelope (`03` §3.5) with numeric `failing` and `passing` counts, which is what the `G-Parity` check\'s `failOn: "failing > 0"` reads under `parser: forge-json` (`10` §10.3\'s check contract); the overall verdict; the check\'s own `reason` where the check itself stopped (`no-declarations`, or `oracle-changed` naming each differing path); the evidence id (null when nothing was recorded, below); and a `declarations` list, in order of `name`, whose entries each give a declaration\'s `name`, `verdict`, `reason` (a short stated reason wherever the verdict is not `match`), `passing` and `failing`.',
      'A check with no declaration has no entry to carry its reason, which is why the envelope does.',
      '`failing` is 0 only when `passing` is at least 1 (Counting, above), so a check that compared nothing cannot pass.',
      'A refusal envelope (`ok: false`) fails the gate; a `--name` that matches no declaration and a `--trusted` that is not in the accepted form or does not resolve each get one.',
    ]);
  });

  it('M16 F-TEST-9 block [29] (r3g items 1/2): Evidence.', () => {
    const section = parity();
    expectBlock(section, [
      '**Evidence.**',
      'One `forge parity check` invocation writes one `ParityEvidence` record (`18` §18.7), however many declarations it checks, unless it is given `--no-record`.',
      "The record's body carries a `declarations` list (for each: the name, the declaration digest, the reference's ref and sha, the platform, the digest of the capture it selected, its verdict and, where that is not `match`, its `reason`, the verdict and content hashes of each case, and the exempt count), the check's own `reason` where the check itself stopped, and `trusted`, the trust anchor's sha or null.",
      'It holds verdicts and content hashes, never the observed content.',
      "`--story <id>` names the story the check ran for: it is the record's `story` and its retention subject, which without it is the single shared subject `project` (`18` §18.7, Retention).",
      '`EvidenceBundle.parityEvidence` is where a bundle lists the ids of these records; M16 changes no bundle assembler, so nothing populates it yet (`18` §18.7).',
      'The `G-Parity` gate (`10` §10.3 rule 8) runs `forge parity check` as its one deterministic check, `behavior:parity`, and passes `--no-record`, because it evaluates in the integration worktree, where a file written by a check leaves the worktree dirty and the next run refuses to start (`VCS-INTEGRATION-DIRTY`).',
      "An evaluation inside a run therefore leaves its trail in the run's event log (`18` §18.4), not in a `ParityEvidence` record: the `GateEvaluated` event carries each check's verdict and output digests, and where the run's id reaches the command in `FORGE_RUN_ID` and the command can name the run's own project root (a gate check runs in the integration worktree, which is not that root), the check adds a `CheckRun` event of kind `'parity'`.",
    ]);
  });

  it('M16 F-TEST-9 block [30] (r3g items 1/2): The honest boundary. (reworded M17 P1: the candidate-read sentence is replaced by the closed-tamper/read-only sentence)', () => {
    const section = parity();
    expectBlock(section, [
      '**The honest boundary.**',
      'A green parity check says the **declared surfaces**',
      'matched the reference on the **declared cases**',
      'after the **declared normalisation**',
      '— never that behaviour is preserved.',
      'Everything undeclared is unobserved, and the evidence says so.',
      'Over-normalising can hide a real difference, which is why the rules sit in a digest-bound, human-reviewed declaration and none may erase everything.',
      "The candidate is observed in place, and its own case command can no longer write or restore anything under `.forge/parity/` (above): where the chosen isolation mechanism makes the directory absent from the tree the command sees, it cannot read it either; where the mechanism is read-only instead, the command can still read it, including a capture's stored observation, and a change that reads its own expected output is a code change this check cannot tell from a faithful one — review is what catches that, exactly as it always has.",
      "Vetting judges a command's text against the engine's closed lists and, for a glob or a symlink, the project's tree as it is when the declaration loads.",
      "That judgement covers neither the reference's scratch tree, which a ref fills, nor what the program the command names does when it runs, nor a program that is on none of the lists, so a `run` or `setup` that names a script does whatever that script does, a fetch included, and a `setup` that runs a program the lists do not know can install dependencies: review of the declaration is what covers both.",
      "Timing, memory and concurrency ordering are not compared, a change of installed dependency is not seen where both sides run against one installed copy, the candidate's own build is not checked (FORGE builds nothing for it, so a stale build can read as `match`), and a reference that is not held at a ref in the project's own history is outside this definition.",
    ]);
  });

  it("M16 F-TEST-10 (r3g items 1/2): the section's blocks, in order, are exactly these, none inserted, removed, swapped or relocated", () => {
    const section = hunks();
    expectBlockOrder(section, [
      '### F-TEST-10 · Hunk-level behavioural binding (post-v1.0, `',
      "F-TEST-5's behavioural binding reverts a story's whole imple",
      '**A hunk** is a unit of *text* change between an explicit ba',
      '**Requirements on a hunk id.** An id is stable for one base/',
      '**`--base <ref>`** is the explicit base for hunk mode: `--hu',
      '**Verdicts.** Each hunk ends in exactly one of five:',
      '`killed` — reversing it made a test that passed at baseline ',
      '`uncovered` — every baseline-passing test still passes with ',
      '`invalid` — the reversal did not apply cleanly, or every fai',
      '`timeout` — the run exceeded its time limit with no killing ',
      '`skipped` — the run could not proceed (a failing baseline, f',
      '**`granularity`.** The `granularity` a run reports says how ',
      '**Report-only.** Hunk verdicts never change the exit code, w',
      '**File-load failures** (the position `specs/22` M16 P10 is t',
      "**Cost.** N hunks cost N + 3 runs of the story's test comman",
      '---',
    ]);
  });

  it("M16 F-TEST-10 block [1] (r3g items 1/2): F-TEST-5's behavioural binding reverts a story's whole implementation ch...", () => {
    const section = hunks();
    expectBlock(section, [
      "F-TEST-5's behavioural binding reverts a story's whole implementation change at once: it shows that the story's tests bind to *something* in the change, not that every part of the change is exercised.",
      'Hunk-level binding is the same mutation at a finer grain — reverse one hunk at a time and ask whether a test that passed at baseline now fails.',
      'It is opt-in, bounded, and report-only.',
    ]);
  });

  it('M16 F-TEST-10 block [2] (r3g items 1/2): A hunk', () => {
    const section = hunks();
    expectBlock(section, [
      '**A hunk**',
      "is a unit of *text* change between an explicit base and the head, over the change's implementation paths only; test files are never mutated.",
      'It is not a semantic unit: a comment-only or formatting-only hunk is still a hunk.',
      'Hunk boundaries are an artefact of the diff algorithm, so the algorithm is pinned and recorded in the evidence.',
      'An added or deleted file, a binary file, a mode-only change and any other non-text change is not split into hunks: it is ONE file mutant, a revert of that file as a whole, whose verdict comes from the same revert-and-run procedure as the change-level mutant for that file and which takes the change-level load-failure credit (File-load failures, below).',
      'A hunk that cannot be reversed against the head is recorded `invalid`, never dropped.',
    ]);
  });

  it('M16 F-TEST-10 block [3] (r3g items 1/2): Requirements on a hunk id.', () => {
    const section = hunks();
    expectBlock(section, [
      '**Requirements on a hunk id.**',
      'An id is stable for one base/head pair: two parses of the same pair give the same ids.',
      'Ids are distinct for textually identical hunks in one file.',
      'The format is not fixed here; the piece that builds the parser (`specs/22` M16 P11) fixes it under these two requirements.',
    ]);
  });

  it('M16 F-TEST-10 block [4] (r3g items 1/2): --base <ref>', () => {
    const section = hunks();
    expectBlock(section, [
      '**`--base <ref>`**',
      'is the explicit base for hunk mode: `--hunks` without it is a usage error, and so is `--base` without `--hunks`.',
      'It governs the whole run, the change-level portion included, so the two halves of one `--json` envelope describe one range.',
      'Without `--hunks` the range is as M15 shipped it.',
    ]);
  });

  it('M16 F-TEST-10 block [5] (r3g items 1/2): Verdicts.', () => {
    const section = hunks();
    expectBlock(section, ['**Verdicts.**', 'Each hunk ends in exactly one of five:']);
  });

  it('M16 F-TEST-10 block [6] (r3g items 1/2): killed — reversing it made a test that passed at baseline fail with an a...', () => {
    const section = hunks();
    expectBlock(section, [
      '`killed` — reversing it made a test that passed at baseline fail with an assertion failure or a crash; the test is named in `killedBy`.',
    ]);
  });

  it('M16 F-TEST-10 block [7] (r3g items 1/2): uncovered — every baseline-passing test still passes with it reversed.', () => {
    const section = hunks();
    expectBlock(section, [
      '`uncovered` — every baseline-passing test still passes with it reversed.',
    ]);
  });

  it('M16 F-TEST-10 block [8] (r3g items 1/2): invalid — the reversal did not apply cleanly, or every failure it caused...', () => {
    const section = hunks();
    expectBlock(section, [
      '`invalid` — the reversal did not apply cleanly, or every failure it caused is a failure to load: a stillborn mutant proves nothing about an assertion.',
    ]);
  });

  it('M16 F-TEST-10 block [9] (r3g items 1/2): timeout — the run exceeded its time limit with no killing failure.', () => {
    const section = hunks();
    expectBlock(section, ['`timeout` — the run exceeded its time limit with no killing failure.']);
  });

  it('M16 F-TEST-10 block [10] (r3g items 1/2): skipped — the run could not proceed (a failing baseline, for one); the r...', () => {
    const section = hunks();
    expectBlock(section, [
      '`skipped` — the run could not proceed (a failing baseline, for one); the reason is recorded.',
    ]);
  });

  it('M16 F-TEST-10 block [11] (r3g items 1/2): granularity.', () => {
    const section = hunks();
    expectBlock(section, [
      '**`granularity`.**',
      'The `granularity` a run reports says how it mutated the text changes: one mutant per hunk (`hunk`), one per file (`file`) or one for the whole change (`change`).',
      'A file that is not split into hunks is a file mutant at `hunk` and at `file`; at `change` everything is the one mutant.',
      'Above `--max-hunks` the mode degrades hunk → file → change and reports the `granularity` it actually used.',
      'It never samples: a sampled result would read as a verdict on hunks that were never run.',
      'The default for `--max-hunks` is not fixed here: `specs/22` M16 P12 chooses it and states it.',
    ]);
  });

  it('M16 F-TEST-10 block [12] (r3g items 1/2): Report-only.', () => {
    const section = hunks();
    expectBlock(section, [
      '**Report-only.**',
      'Hunk verdicts never change the exit code, which follows the change-level result over the same `--base` range, by the rule it follows without `--hunks`; the `--json` additions are optional fields and every M15 field is unchanged.',
      'No default gate threshold ships.',
      "A project that wants one authors a check over the `--json` envelope, under `10` §10.3's check contract, and takes on three costs: a comment-only or formatting-only hunk reads `uncovered`, there is no hunk exemption, and attribution is bounded by the story's own tests.",
    ]);
  });

  it('M16 F-TEST-10 block [13] (r3g items 1/2): File-load failures', () => {
    const section = hunks();
    expectBlock(section, [
      '**File-load failures**',
      '(the position `specs/22` M16 P10 is to confirm by real runs under both test runners, or amend).',
      "At change level a revert that makes a test file unloadable credits the baseline-passing tests of that file under both runners — a new module's tests cannot load without the module, and M15's shipped vitest behaviour already credits it.",
      'At hunk level a text hunk whose reversal makes a file unloadable is `invalid`, not `killed`.',
      'The rule follows the kind of mutant, whatever `granularity` the run reports: a hunk mutant is `invalid` for it, and a file mutant and the whole-change mutant take the change-level credit.',
    ]);
  });

  it('M16 F-TEST-10 block [14] (r3g items 1/2): Cost.', () => {
    const section = hunks();
    expectBlock(section, [
      '**Cost.**',
      "N hunks cost N + 3 runs of the story's test command (baseline, revert, restore, and one per hunk), which is why the mode is opt-in and bounded.",
    ]);
  });

  it('M16 specs/10 rule 8 block (r3g items 1/2): (Post-v1.0, specs/22 M16.) A gate may be workflow-scoped: a gate file wi... (reworded M17 P1: G-TestAdopt is appended as the second workflow-scoped gate)', () => {
    const section = spec10Gates();
    expectBlock(section, [
      "(Post-v1.0, `specs/22` M16.) A gate may be **workflow-scoped**: a gate file with no lifecycle `phase`, scheduled only by a workflow's `kind: gate` step (§10.1, Step kinds).",
      "`phase` is optional in a gate document, so a phase-less gate file loads under rule 6's own strictness: an unknown key, or no deterministic check, is still a load error.",
      'A workflow-scoped gate belongs to no lifecycle phase: no phase transition evaluates it, and no path that enumerates every gate evaluates it.',
      'It is still a gate, and a person can still name it: `forge gate check`, `approve` and `waive` resolve it by id like any other, and `forge gate reject` records against the id it is given.',
      'It is not one of the ten lifecycle gates of the catalogue below, which this rule does not extend.',
      '`G-Adopt` (`17` §17.2) is a different kind of exception, a gate outside the lifecycle that is evaluated in-process with no gate file and that no `kind: gate` step reaches; `G-Parity` (`13` F-TEST-9) is the first workflow-scoped gate to have a file.',
      'Its one check, `behavior:parity`, is `forge parity check --json --no-record --trusted refs/heads/main`: the trust anchor is an explicit argument, trunk, and `--no-record` writes no `ParityEvidence`, because a gate check runs in the integration worktree and a file it writes there leaves the worktree dirty, so that the next run refuses to start (`VCS-INTEGRATION-DIRTY`).',
      'Run by hand, `forge gate check G-Parity` runs the same command, so it compares with trunk too.',
      '**`G-TestAdopt`**',
      "(post-v1.0, `specs/22` M17, `13` F-TEST-11) is the second workflow-scoped gate to have a file, scheduled by the `adopt-tests` workflow's own `kind: gate` step (P7 builds the workflow; this gate's own file).",
      "Its one deterministic check, `checkId: test-adoption:approved`, reads `.forge/test-adopt/<layer>.proposal.yaml` (`13` F-TEST-11's staged proposal record, never the live `.forge/config.yaml` `execution.testCommands` entry: the live entry does not exist yet when this check first needs to pass, and this check existing to gate the live entry's own creation is exactly why it cannot be the thing that reads it) for the layer under review.",
      "It passes when that staged record exists, was produced by `forge test adopt` (human-invoked directly, or via the `adopt-tests` agent workflow), and carries a RECORDED translator-proof result (`13` F-TEST-11) that (a) passed and (b) is no older than the translator's own current content hash and the detected runner's own current version — a proof taken against an earlier translator or an earlier runner version is stale and does not satisfy the check, which fails or is simply never reached otherwise.",
      "`--write` (the promotion that copies the staged record into the live config, `13` F-TEST-11) runs only after this check has passed AND the approval itself has happened (rule 6's own `forge gate approve`), never on the check's pass alone: approving the gate is what certifies the staged record for promotion, and a `--write` attempted before that approval is a typed refusal, not a silent no-op.",
      "This check is **conditional, not universal**: a layer whose `testCommands` entry is the legacy bare-string form (`18` §18.3) never needs this gate at all, because nothing about it was ever proposed by `forge test adopt` — a workflow that wires `adopt-tests` only ever schedules this gate's `kind: gate` step for a layer the structured form governs.",
    ]);
  });

  it('M16 specs/17 §17.2 BASELINE tag block (r3g items 1/2): (Post-v1.0, specs/22 M16.) The BASELINE tag is a legitimate reference.re...', () => {
    const section = spec17('## 17.2 ');
    expectBlock(section, [
      '(Post-v1.0, `specs/22` M16.) The `BASELINE` tag is a legitimate `reference.ref` for a parity declaration (`13` F-TEST-9): it marks the system as found, which is a valid reference for the refactoring that follows adoption (§17.4, item 3).',
      '`adopt` creates the tag at HEAD as of that adoption, and only when the pipeline reaches this phase and the repository has a commit: not under `--depth quick`, not when a size-gated survey answers a run given no `--scope` with a scoped proposal, and never again once a `BASELINE` tag exists, since an existing tag is neither recreated nor moved.',
      'A declaration that names it therefore names the commit of the adoption that created it, and a repository with no such tag has none to name.',
      'This builds no `adopt` wiring: `G-Adopt` is evaluated in-process and has no gate file, and the `adopt` workflow gains no gate step.',
    ]);
  });

  it('M16 specs/18 §18.7 ParityEvidence registration paragraph block (r3g items 1/2): ParityEvidence was added post-v1.0 (specs/22 M16), the same way and by t...', () => {
    const section = spec18('## 18.7 ');
    expectBlock(section, [
      "`ParityEvidence` was added post-v1.0 (`specs/22` M16), the same way and by the same checklist: a real capability (`13` F-TEST-9's parity oracles) that needed a committed, typed artifact.",
      'It has the registry entry above, a JSON Schema, a template, and no graph edge declaration beyond an optional `story` id: like `MutationEvidence` and `EvidenceBundle` it is outside the traceability chain of `09` §9.4, and unlike them it has no `parent`.',
      '(What `{slug}` names is settled when the type is built, `specs/22` M16 P5.) It is **append-only**',
      "exactly as they are: one `forge parity check` invocation writes one `PAR-<n>` record, however many declarations it checks (none, when it is given `--no-record`, as the `G-Parity` gate's check is: `13` F-TEST-9), and a write to an existing path is refused, never an edit.",
      "The record's body carries a `declarations` list, in order of `name`, each entry holding the declaration's name and digest, the reference's ref and sha, the platform, the digest of the capture it selected, its verdict and, where that is not `match`, its `reason`, the verdict and content hashes of each case, and its exempt count.",
      "Beside that list the record holds the candidate's `headSha`, `dirty` flag and delta digest, `trusted` (the trust anchor's sha, or null: `13` F-TEST-9), the overall verdict, the check's own `reason` where the check itself stopped (`no-declarations`, `oracle-changed`), and tool versions.",
      'Its `story`, when `forge parity check` is given `--story <id>`, is its retention subject (Retention, below).',
      'It holds names, digests, verdicts and hashes, never an observed value (`13` F-TEST-9).',
      "The `platform` of a `declarations` entry is the operating system and architecture its capture was taken on, `<os>-<arch>`; it is not the agent platform of §18.3's `platform` block or the ledger's `platform` column.",
      'A parity capture is not a registry artifact: it is a content-addressed JSON file with no front matter under `.forge/parity/captures/` (§18.2), which the id scan never lists, because it reads `.md` files only and skips `.forge` (`packages/core/src/ids/scan.ts`).',
      "`specs/22` M16 P5 must show, by a test over a project holding both, that no validation or health check flags a `PAR` record or a capture, unless its text holds a `${secret:NAME}` reference: `forge doctor`'s `secret-references` check scans every `.yaml`, `.yml`, `.md` and `.json` file under `.forge/` (outside `.forge/state`) and `docs/forge/` for those, so a declaration, a capture or a record that holds one draws its warning.",
    ]);
  });

  it('M16 specs/22 M16 premise block (r3g items 1/2): The premise, corrected.', () => {
    const section = spec22M16();
    expectBlock(section, [
      '**The premise, corrected.**',
      'The paragraph above speaks of refusing "the gate" on divergence, and presumes a gate those three workflows already reach.',
      'None did.',
      'As M15 shipped them, `refactor`, `migrate` and `adopt` contained no `kind: gate` step, so there was no gate for a parity check to be wired into.',
      '`refactor` was `state-invariants` → `refactor-code` → `verify-invariants` (a plain `forge test run --json` command step) → `commit`.',
      '`migrate` ended in the same plain command (its `verify-migration` step), and its `migrate-data` step ran `forge migrate run`, which was not wired (`test/command-steps.test.ts` pins it as a known gap; Q213, Q202).',
      '`adopt` was an inventory command (`forge adopt inventory --json`, also pinned there as unwired; Q213) plus two agent steps, and its one gate, `G-Adopt`, was evaluated in-process with no gate file.',
      'M16 therefore creates the gate it was meant to feed: the **workflow-scoped gate `G-Parity`**, with one `behavior:parity` check, reached through explicit `kind: gate` steps (`10` §10.3 rule 8).',
      'The wiring is this: `refactor` must fail before any agent step runs when no declaration compares at least one surface, and again at a `verify-parity` gate between `verify-invariants` and `commit` (whether the first check is a leading `kind: gate` step or an entry preflight is the choice of `specs/22` M16 P9); `migrate` gets the same verification gate, unreachable until `forge migrate run` is wired; `adopt` gets no gate step, only the documented use of `BASELINE` (`17` §17.2).',
      'See `process/plans/PLAN-M16.md`.',
    ]);
  });
});

describe('pin helpers (specs/22 M16 P1) (SPEC-QUESTIONS.md Q294, PLAN-M16.md P1) — a pin helper that stops failing when it should is a pin that guards nothing', () => {
  const sectionOf = (text: string) => sectionFromLines(text.split('\n'));

  const paragraph = sectionOf(
    [
      '# Heading',
      '',
      'First sentence stands alone. The check compares the candidate with the capture, and the tail of this sentence must not be pinnable by itself.',
      '',
    ].join('\n'),
  );

  it('M16 pin helpers: a needle that is the tail of a longer sentence throws', () => {
    expect(() => {
      expectPinned(paragraph, ['the tail of this sentence must not be pinnable by itself.']);
    }).toThrow();
  });

  it('M16 pin helpers: the same sentence pinned from its start passes, as does the one before it', () => {
    expect(() => {
      expectPinned(paragraph, [
        'The check compares the candidate with the capture, and the tail of this sentence must not be pinnable by itself.',
        'First sentence stands alone.',
      ]);
    }).not.toThrow();
    const marks = sectionOf(
      [
        '# Heading',
        '',
        'Is it so? The next sentence. Stop! Another sentence. A word ending in kcf. The last sentence.',
        '',
      ].join('\n'),
    );
    expect(() => {
      expectPinned(marks, ['The next sentence.', 'Another sentence.', 'The last sentence.']);
    }).not.toThrow();
  });

  it('M16 pin helpers: a needle after an abbreviation or a colon is still inside its sentence and throws', () => {
    const inside = sectionOf(
      [
        '# Heading',
        '',
        'Pass a literal, e.g. The quoted words follow here. The command is: run this exact thing.',
        '',
      ].join('\n'),
    );
    expect(() => {
      expectPinned(inside, ['The quoted words follow here.']);
    }).toThrow();
    for (const abbreviation of ['e.g.', 'i.e.', 'cf.', 'vs.', 'E.g.']) {
      const abbreviated = sectionOf(
        ['# Heading', '', `Pass a literal, ${abbreviation} The quoted words follow here.`, ''].join(
          '\n',
        ),
      );
      expect(() => {
        expectPinned(abbreviated, ['The quoted words follow here.']);
      }).toThrow();
    }
    expect(() => {
      expectPinned(inside, ['run this exact thing.']);
    }).toThrow();
    expect(() => {
      expectPinned(inside, ['The command is: run this exact thing.']);
    }).not.toThrow();
  });

  it('M16 pin helpers: a needle found only inside an HTML comment is not present, but expectAbsent still finds it', () => {
    const commented = sectionOf(
      [
        '# Heading',
        '',
        'Visible sentence.',
        '<!-- A hidden sentence in a one-line comment. -->',
        '',
        'Another visible sentence. <!--',
        'A multi-line comment hides this sentence.',
        '-->',
        '',
      ].join('\n'),
    );
    expect(() => {
      expectPinned(commented, ['Visible sentence.', 'Another visible sentence.']);
    }).not.toThrow();
    expect(() => {
      expectPinned(commented, ['A hidden sentence in a one-line comment.']);
    }).toThrow();
    expect(() => {
      expectPinned(commented, ['A multi-line comment hides this sentence.']);
    }).toThrow();
    expect(() => {
      expectClause(commented, ['A hidden sentence in a one-line comment.']);
    }).toThrow();
    expect(() => {
      expectAbsent(commented, ['A hidden sentence in a one-line comment.']);
    }).toThrow();
    expect(() => {
      expectAbsent(commented, ['A multi-line comment hides this sentence.']);
    }).toThrow();
    expect(() => {
      expectAbsent(commented, ['A sentence written nowhere at all.']);
    }).not.toThrow();
  });

  it('M16 pin helpers: a needle found only inside a code fence is not present, but expectAbsent and expectLines still find it', () => {
    const fenced = sectionOf(
      [
        '# Heading',
        '',
        'Before the fence.',
        '',
        '```yaml',
        'fenced: A sentence only inside a code fence.',
        '```',
        '',
        'After the fence.',
        '',
      ].join('\n'),
    );
    expect(() => {
      expectPinned(fenced, ['Before the fence.', 'After the fence.']);
    }).not.toThrow();
    expect(() => {
      expectPinned(fenced, ['A sentence only inside a code fence.']);
    }).toThrow();
    expect(() => {
      expectClause(fenced, ['A sentence only inside a code fence.']);
    }).toThrow();
    expect(() => {
      expectAbsent(fenced, ['A sentence only inside a code fence.']);
    }).toThrow();
    expect(() => {
      expectLines(fenced, ['fenced: A sentence only inside a code fence.']);
    }).not.toThrow();
  });

  it('M16 pin helpers: expectLines does not read a line that sits inside an HTML comment', () => {
    const commented = sectionOf(
      ['# Heading', '', '<!--', '| `forge parity x` | A row nobody sees. |', '-->', ''].join('\n'),
    );
    expect(() => {
      expectLines(commented, ['| `forge parity x` | A row nobody sees. |']);
    }).toThrow();
  });

  it('M16 pin helpers: a `#` line inside a code fence or an HTML comment is not a heading', () => {
    const spec = [
      '## One',
      '',
      '```yaml',
      '# a yaml comment, not a heading',
      '```',
      '<!--',
      '## Two, in a comment',
      '-->',
      'Still section one.',
      '',
      '## Three',
      '',
      'Section three.',
      '',
    ].join('\n');
    expect(() => {
      expectPinned(headingSection(spec, '## One'), ['Still section one.']);
    }).not.toThrow();
    expect(() => {
      headingSection(spec, '## Two');
    }).toThrow();
  });

  it('M16 pin helpers: a needle after the bold lead-in `** ` passes', () => {
    const bold = sectionOf(
      ['# Heading', '', '- **Lead-in.** The sentence after the bold lead-in.', ''].join('\n'),
    );
    expect(() => {
      expectPinned(bold, ['The sentence after the bold lead-in.']);
    }).not.toThrow();
  });

  it('M16 pin helpers: a needle in a table cell after `| ` passes, and so does one that starts at the row', () => {
    const table = sectionOf(
      [
        '# Heading',
        '',
        '| Command | What it does |',
        '| --- | --- |',
        '| `forge x` | A cell sentence. |',
        '',
      ].join('\n'),
    );
    expect(() => {
      expectPinned(table, ['A cell sentence.']);
    }).not.toThrow();
    expect(() => {
      expectPinned(table, ['| `forge x` | A cell sentence.']);
    }).not.toThrow();
  });

  it('M16 pin helpers: a needle after a list marker passes, whether it starts at the marker or after it', () => {
    const list = sectionOf(
      ['# Heading', '', '- A bullet sentence.', '3. A numbered sentence.', ''].join('\n'),
    );
    expect(() => {
      expectPinned(list, ['A bullet sentence.', 'A numbered sentence.']);
    }).not.toThrow();
    expect(() => {
      expectPinned(list, ['- A bullet sentence.', '3. A numbered sentence.']);
    }).not.toThrow();
  });

  it('M16 pin helpers: a needle that occurs twice throws, even when both are at a sentence start', () => {
    const twice = sectionOf(
      ['# Heading', '', 'The same sentence.', '', 'The same sentence.', ''].join('\n'),
    );
    expect(() => {
      expectPinned(twice, ['The same sentence.']);
    }).toThrow();
  });

  it('M16 pin helpers: a needle that occurs nowhere throws', () => {
    expect(() => {
      expectPinned(paragraph, ['A sentence that is not there.']);
    }).toThrow();
    const endsOnAStop = sectionOf(['# Heading', '', 'A sentence. Z'].join('\n'));
    expect(() => {
      expectPinned(endsOnAStop, ['A sentence that is not there.']);
    }).toThrow();
  });

  it('M16 pin helpers: a needle that does not run to a full stop throws', () => {
    expect(() => {
      expectPinned(paragraph, ['First sentence stands alone']);
    }).toThrow();
  });

  it('M16 pin helpers: expectClause is not anchored to a sentence start, and expectLines wants a whole line', () => {
    expect(() => {
      expectClause(paragraph, ['the tail of this sentence must not be pinnable by itself.']);
    }).not.toThrow();
    expect(() => {
      expectLines(paragraph, ['First sentence stands alone.']);
    }).toThrow();
  });

  it('M16 pin helpers: expectClause and expectLines want exactly one match', () => {
    const twice = sectionOf(
      ['# Heading', '', 'A clause, twice. A clause, twice.', '', '| a row |', '| a row |', ''].join(
        '\n',
      ),
    );
    expect(() => {
      expectClause(twice, ['A clause, twice.']);
    }).toThrow();
    expect(() => {
      expectClause(twice, ['A clause nobody wrote.']);
    }).toThrow();
    expect(() => {
      expectLines(twice, ['| a row |']);
    }).toThrow();
    expect(() => {
      expectLines(twice, ['| a row nobody wrote |']);
    }).toThrow();
    expect(() => {
      expectClause(paragraph, ['the tail of this sentence']);
    }).not.toThrow();
    expect(() => {
      expectLines(sectionOf(['# Heading', '', '| a row |', ''].join('\n')), ['| a row |']);
    }).not.toThrow();
  });

  it('M16 pin helpers: headingSection throws when two headings start with the prefix', () => {
    const spec = ['## One', '', 'First.', '', '## One again', '', 'Second.', ''].join('\n');
    expect(() => {
      headingSection(spec, '## One');
    }).toThrow();
    expect(() => {
      expectPinned(headingSection(spec, '## One again'), ['Second.']);
    }).not.toThrow();
  });

  it('M16 pin helpers: a sentence right after a heading line, a code fence or a comment line begins a paragraph', () => {
    const tight = sectionOf(
      [
        '# Heading',
        'Right after the heading.',
        'Text before the fence, no stop',
        '```',
        'code',
        '```',
        'Right after the fence.',
        'A line without a stop',
        '<!-- a comment on a line of its own -->',
        'Right after the comment.',
        '',
      ].join('\n'),
    );
    expect(() => {
      expectPinned(tight, [
        'Right after the heading.',
        'Right after the fence.',
        'Right after the comment.',
      ]);
    }).not.toThrow();
  });

  it('M16 pin helpers: a fence line inside an HTML comment does not open a fence', () => {
    const spec = sectionOf(
      ['# Heading', '', '<!--', '```', '-->', '', 'Prose after the commented fence.', ''].join(
        '\n',
      ),
    );
    expect(() => {
      expectPinned(spec, ['Prose after the commented fence.']);
    }).not.toThrow();
  });

  it('M16 pin helpers: a `<!--` inside a code fence does not open a comment', () => {
    const spec = sectionOf(
      [
        '# Heading',
        '',
        '```html',
        '<!-- an opener nobody closes',
        '```',
        '',
        'Prose after the fence.',
        '',
      ].join('\n'),
    );
    expect(() => {
      expectPinned(spec, ['Prose after the fence.']);
    }).not.toThrow();
  });

  it('M16 pin helpers: normalise folds only space, tab, CR and LF, never an NBSP or another Unicode space', () => {
    expect(normalise('a\t b\r\nc')).toBe('a b c');
    expect(normalise('a b')).toBe('a b');
    expect(normalise('a b')).toBe('a b');
    expect(normalise('a﻿b')).toBe('a﻿b');
    const nbsp = sectionOf(['# Heading', '', 'A sentence with an NBSP inside it.', ''].join('\n'));
    expect(() => {
      expectPinned(nbsp, ['A sentence with an NBSP inside it.']);
    }).toThrow();
    expect(() => {
      expectPinned(nbsp, ['A sentence with an NBSP inside it.']);
    }).not.toThrow();
  });

  it('M16 pin helpers: expectLines requires the same leading whitespace, not just the same trimmed text', () => {
    const indented = sectionOf(['# Heading', '', '  - a row', ''].join('\n'));
    expect(() => {
      expectLines(indented, ['  - a row']);
    }).not.toThrow();
    expect(() => {
      expectLines(indented, ['- a row']);
    }).toThrow();
    expect(() => {
      expectLines(indented, ['    - a row']);
    }).toThrow();
  });

  it('M16 pin helpers: expectLines requires its items in the listed order, even when each occurs once', () => {
    const ordered = sectionOf(
      ['# Heading', '', 'First row', 'Second row', 'Third row', ''].join('\n'),
    );
    expect(() => {
      expectLines(ordered, ['First row', 'Second row', 'Third row']);
    }).not.toThrow();
    expect(() => {
      expectLines(ordered, ['Third row', 'First row']);
    }).toThrow();
    expect(() => {
      expectLines(ordered, ['Second row', 'First row']);
    }).toThrow();
  });

  const twoSentenceBlock = sectionOf(
    [
      '# Heading',
      '',
      '- **A rule.** First sentence of the block. Second sentence of the block, which ends with a trailing default.',
      '- A sentence in the next block.',
      '',
    ].join('\n'),
  );

  it('M16 pin helpers: expectBlock passes when the listed sentences are exactly the block, in order, the bold lead-in its own first entry', () => {
    expect(() => {
      expectBlock(twoSentenceBlock, [
        '**A rule.**',
        'First sentence of the block.',
        'Second sentence of the block, which ends with a trailing default.',
      ]);
    }).not.toThrow();
  });

  it('M16 pin helpers: expectBlock throws when a sentence pinned alone leaves a neighbour in its block unpinned', () => {
    expect(() => {
      expectBlock(twoSentenceBlock, ['**A rule.**', 'First sentence of the block.']);
    }).toThrow();
  });

  it('M16 pin helpers: expectBlock throws when a sentence from the next block is folded in, or the two are reordered', () => {
    expect(() => {
      expectBlock(twoSentenceBlock, [
        '**A rule.**',
        'First sentence of the block.',
        'Second sentence of the block, which ends with a trailing default.',
        'A sentence in the next block.',
      ]);
    }).toThrow();
    expect(() => {
      expectBlock(twoSentenceBlock, [
        '**A rule.**',
        'Second sentence of the block, which ends with a trailing default.',
        'First sentence of the block.',
      ]);
    }).toThrow();
  });

  it('M16 pin helpers: expectBlock throws when the block opening it is given does not open a block at all', () => {
    expect(() => {
      expectBlock(twoSentenceBlock, ['First sentence of the block.']);
    }).toThrow();
  });

  it("M16 pin helpers: expectBlock requires every non-final sentence to run to its own full stop, and allows a last fragment ending in a colon when it is genuinely the block's last content", () => {
    expect(() => {
      expectBlock(twoSentenceBlock, [
        '**A rule.**',
        'First sentence of the block',
        'Second sentence of the block, which ends with a trailing default.',
      ]);
    }).toThrow();
    const colonBlock = sectionOf(
      [
        '# Heading',
        '',
        '- A rule with a trailing list:',
        '  - one',
        '  - two',
        '- Next item.',
        '',
      ].join('\n'),
    );
    expect(() => {
      expectBlock(colonBlock, ['A rule with a trailing list:']);
    }).not.toThrow();
  });

  it('M16 pin helpers: expectBlockOrder passes when the section blocks, in order, open with the listed text, and throws on an inserted, removed or swapped block', () => {
    const section = sectionOf(
      ['# Heading', '', 'First paragraph.', '', '- First bullet.', '- Second bullet.', ''].join(
        '\n',
      ),
    );
    expect(() => {
      expectBlockOrder(section, [
        '# Heading',
        'First paragraph.',
        'First bullet.',
        'Second bullet.',
      ]);
    }).not.toThrow();
    expect(() => {
      expectBlockOrder(section, [
        '# Heading',
        'First paragraph.',
        'Second bullet.',
        'First bullet.',
      ]);
    }).toThrow();
    expect(() => {
      expectBlockOrder(section, ['# Heading', 'First paragraph.', 'First bullet.']);
    }).toThrow();
    const withInsertion = sectionOf(
      [
        '# Heading',
        '',
        'First paragraph.',
        '',
        '- First bullet.',
        '- An inserted bullet.',
        '- Second bullet.',
        '',
      ].join('\n'),
    );
    expect(() => {
      expectBlockOrder(withInsertion, [
        '# Heading',
        'First paragraph.',
        'First bullet.',
        'Second bullet.',
      ]);
    }).toThrow();
  });

  it('M16 pin helpers: a block carries its content from just after its marker, with the inter-line gap trimmed off, and a table separator row is folded into the header row above it, never a block of its own', () => {
    const list = sectionOf(['# Heading', '', '  - A nested bullet.', ''].join('\n'));
    expect(list.blocks.map((block) => block.text)).toEqual(['# Heading', 'A nested bullet.']);
    const table = sectionOf(['# Heading', '', '| Head |', '| --- |', '| Row |', ''].join('\n'));
    expect(table.blocks.map((block) => block.text)).toEqual([
      '# Heading',
      '| Head | | --- |',
      '| Row |',
    ]);
  });

  it('M16 pin helpers: expectAbsentFolded catches a retired wording reinserted with different case or a dropped/added hyphen', () => {
    const cased = sectionOf(['# Heading', '', 'A Bare Checkout rule applies here.', ''].join('\n'));
    expect(() => {
      expectAbsent(cased, ['bare checkout']);
    }).not.toThrow();
    expect(() => {
      expectAbsentFolded(cased, ['bare checkout']);
    }).toThrow();
    const dehyphenated = sectionOf(
      ['# Heading', '', 'This keeps an honest session fence.', ''].join('\n'),
    );
    expect(() => {
      expectAbsent(dehyphenated, ['honest-session fence']);
    }).not.toThrow();
    expect(() => {
      expectAbsentFolded(dehyphenated, ['honest-session fence']);
    }).toThrow();
    expect(() => {
      expectAbsentFolded(cased, ['a sentence written nowhere at all']);
    }).not.toThrow();
  });

  it('M16 pin helpers: a second HTML comment on the same line closes at its own `-->`, not at the first one found after the first comment opened', () => {
    const twoComments = sectionOf(
      ['# Heading', '', 'a <!-- one --> b <!-- two --> c.', ''].join('\n'),
    );
    expect(() => {
      expectPinned(twoComments, ['a b c.']);
    }).not.toThrow();
  });

  it('M16 pin helpers: a fence only closes on a line of pure backticks, and an opening fence line may carry a language tag', () => {
    const tagged = sectionOf(
      ['# Heading', '', '```yaml extra', 'fenced text', '```', '', 'After the fence.', ''].join(
        '\n',
      ),
    );
    expect(() => {
      expectPinned(tagged, ['After the fence.']);
    }).not.toThrow();
    expect(() => {
      expectAbsent(tagged, ['fenced text']);
    }).toThrow();
    const trailingOnClose = sectionOf(
      [
        '# Heading',
        '',
        '```',
        'still fenced, not closed by a dirty fence line',
        '``` not a close',
        'actually closed here',
        '```',
        '',
        'After.',
        '',
      ].join('\n'),
    );
    expect(() => {
      expectPinned(trailingOnClose, ['After.']);
    }).not.toThrow();
    expect(() => {
      expectAbsent(trailingOnClose, ['actually closed here']);
    }).toThrow();
  });

  it('M16 pin helpers: a `+` marker and a `1)` numbered marker are both list markers', () => {
    const markers = sectionOf(
      ['# Heading', '', '+ A plus-marked item.', '1) A paren-numbered item.', ''].join('\n'),
    );
    expect(() => {
      expectPinned(markers, ['A plus-marked item.', 'A paren-numbered item.']);
    }).not.toThrow();
  });

  it('M16 pin helpers: a `#` line with no space after the hashes is not a heading', () => {
    const spec = ['##NotAHeading', '', '## Real Heading', '', 'Body.', ''].join('\n');
    expect(() => {
      headingSection(spec, '## Real Heading');
    }).not.toThrow();
    expect(() => {
      headingSection(spec, '##NotAHeading');
    }).toThrow();
  });

  it('M16 pin helpers: expectLines and expectAbsent trim trailing whitespace a spec line carries', () => {
    const trailing = sectionOf(['# Heading', '', 'A row with trailing space.   ', ''].join('\n'));
    expect(() => {
      expectLines(trailing, ['A row with trailing space.']);
    }).not.toThrow();
  });

  it('M16 pin helpers: a retired wording that spans a hard line-wrap is still found by expectAbsent, because the join plants the one space the wrap itself stood for', () => {
    const wrapped = sectionOf(
      ['# Heading', '', 'A phrase split across a', 'hard wrap like this.', ''].join('\n'),
    );
    expect(() => {
      expectAbsent(wrapped, ['split across a hard wrap']);
    }).toThrow();
    expect(() => {
      expectAbsent(wrapped, ['a hardwrap']);
    }).not.toThrow();
  });
});

describe('M16 naming rule (specs/22 M16 P1) — an empty `-t` selection exits 0, so a renamed describe must be caught by a test, not just by convention', () => {
  const MARKER = /\(specs\/22 M16 P(\d+)\)/;

  /** Every tracked, and every untracked-but-not-ignored, file in the repository, `node_modules` and a
   * nested worktree excluded because `--exclude-standard` honours `.gitignore`. */
  function repoTestFiles(): string[] {
    const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    return out
      .split('\0')
      .filter((file) => file.length > 0 && /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file));
  }

  /** Every `describe(` title's literal string argument in `text`, found the same way vitest finds a
   * title: not evaluated, just read off the source. A title built from an expression (not a plain
   * string literal) is not a title this scan can read, and is out of scope the same way a dynamic
   * `describe` title is out of scope for any static naming-rule check. */
  function describeTitlesIn(text: string): string[] {
    const titles: string[] = [];
    const re = /\bdescribe\(\s*(['"])((?:\\.|(?!\1).)*)\1/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) titles.push(m[2]!.replace(/\\(.)/g, '$1'));
    return titles;
  }

  it('M16 naming rule: every describe title containing "M16", across every test file in the repository, carries (specs/22 M16 P<n>) with n from 1 to 17', () => {
    const violations: string[] = [];
    let sawAny = false;
    for (const file of repoTestFiles()) {
      const text = readFileSync(path.join(repoRoot, file), 'utf8');
      for (const title of describeTitlesIn(text)) {
        if (!title.includes('M16')) continue;
        sawAny = true;
        const found = MARKER.exec(title);
        const n = found ? Number(found[1]) : NaN;
        if (!found || !Number.isInteger(n) || n < 1 || n > 17) {
          violations.push(`${file}: ${JSON.stringify(title)}`);
        }
      }
    }
    expect(
      sawAny,
      'expected to find at least one M16 describe title (this scan found none at all)',
    ).toBe(true);
    expect(
      violations,
      `every M16 describe title must carry (specs/22 M16 P<n>), n in 1..17:\n${violations.join('\n')}`,
    ).toEqual([]);
  });
});

/**
 * `M17 P1` (`SPEC-QUESTIONS.md` Q313, `PLAN-M17.md` P1): the normative text this piece wrote —
 * specs/22's two-phase M17 entry and the M16 exit-tests correction; specs/09 §9.5's
 * `forge-test-report` v1 contract; specs/13 F-TEST-1/6/7/9/11; specs/18's structured
 * `testCommands`, coverage `source`/`format`, `vcs.trunk` and the worktree-location move; specs/03's
 * `forge test adopt`/`forge spec re-derive`/`forge migrate run` rows; specs/10's `G-TestAdopt` gate;
 * specs/06 §6.4/§6.5/§6.8; specs/07 §7.2/§7.3 — pinned the identical way M16 P1 pinned its own new
 * text (`expectPinned`/`expectBlock`/`expectLines`/`expectAbsent`, above). Not exhaustive: this is a
 * single builder pass, not M16 P1's three-round gauntlet, so a number of new sentences (named in this
 * piece's own report) are not individually pinned here — a gap to close, not a claim this file does
 * not make.
 *
 * @see specs/03 §3.2.1, §3.2.2, §3.2.5
 * @see specs/06 §6.4, §6.5, §6.8
 * @see specs/07 §7.2, §7.3
 * @see specs/09 §9.5
 * @see specs/10 §10.3
 * @see specs/13 F-TEST-1, F-TEST-6, F-TEST-7, F-TEST-9, F-TEST-11
 * @see specs/18 §18.1, §18.2, §18.3
 * @see specs/22 M17
 * @see PLAN-M17.md P1
 * @see SPEC-QUESTIONS.md Q313
 */
describe('pinned sentences (specs/22 M17 P1) (SPEC-QUESTIONS.md Q313, PLAN-M17.md P1) — delete an `it` individually once a later piece legitimately rewords its sentence again', () => {
  const spec22M17 = () => headingSection(readSpec('22-build-plan-and-milestones.md'), '## M17 — ');
  const spec09 = () => headingSection(readSpec('09-spec-driven-development.md'), '## 9.5 ');
  const ftest1 = () =>
    headingSection(readSpec('13-frameworks-testing-and-debugging.md'), '### F-TEST-1 ');
  const ftest6 = () =>
    headingSection(readSpec('13-frameworks-testing-and-debugging.md'), '### F-TEST-6 ');
  const ftest7 = () =>
    headingSection(readSpec('13-frameworks-testing-and-debugging.md'), '### F-TEST-7 ');
  const ftest9 = () =>
    headingSection(readSpec('13-frameworks-testing-and-debugging.md'), '### F-TEST-9 ');
  const ftest11 = () =>
    headingSection(readSpec('13-frameworks-testing-and-debugging.md'), '### F-TEST-11 ');
  const spec18Config = () =>
    headingSection(readSpec('18-persistence-config-and-schemas.md'), '## 18.3 ');
  const spec18Layout = () =>
    headingSection(readSpec('18-persistence-config-and-schemas.md'), '## 18.2 ');
  const spec18Tiers = () =>
    headingSection(readSpec('18-persistence-config-and-schemas.md'), '## 18.1 ');
  const spec03_321 = () => headingSection(readSpec('03-cli-and-installer.md'), '### 3.2.1 ');
  const spec03_322 = () => headingSection(readSpec('03-cli-and-installer.md'), '### 3.2.2 ');
  const spec03_325 = () => headingSection(readSpec('03-cli-and-installer.md'), '### 3.2.5 ');
  const spec10 = () => headingSection(readSpec('10-workflow-engine-and-lifecycle.md'), '## 10.3 ');
  const spec06_64 = () =>
    headingSection(readSpec('06-orchestration-and-parallelism.md'), '## 6.4 ');
  const spec06_65 = () =>
    headingSection(readSpec('06-orchestration-and-parallelism.md'), '## 6.5 ');
  const spec06_68 = () =>
    headingSection(readSpec('06-orchestration-and-parallelism.md'), '## 6.8 ');
  const spec07_72 = () => headingSection(readSpec('07-platform-adapters.md'), '## 7.2 ');
  const spec07_73 = () => headingSection(readSpec('07-platform-adapters.md'), '## 7.3 ');

  // --- specs/22 M17: two phases, the frozen tag, the M16 correction --------------------------------

  it('M17 specs/22: two phases, in a fixed order, with a hard precondition between them', () => {
    expectPinned(spec22M17(), [
      '**Two phases, in a fixed order, with a hard precondition between them.** On 2026-10-11 the owner added a precondition: every disclosed defect is fixed before the trial starts, regardless of whether the trial project would ever actually hit it.',
    ]);
  });

  it('M17 specs/22: hardening cannot happen concurrently with or after the trial starts', () => {
    expectPinned(spec22M17(), [
      "This is also what the trial's own measurement integrity requires, independent of the owner's instruction: the whole point of Phase B is a trial of a FORGE that does not change during the measurement window, so **hardening cannot happen concurrently with, or after, the trial starts** — a FORGE that changes mid-trial confounds the very before/after comparison the milestone exists to make.",
    ]);
  });

  it('M17 specs/22: Phase A ends with the m17-hardened tag, and Phase B measures only that tag', () => {
    expectPinned(spec22M17(), [
      'Phase A ends with a real, owner-authorized live run and a git tag, **`m17-hardened`**: no Phase B work starts before that tag exists, and Phase B measures that exact tag and nothing newer — a defect the trial later finds is recorded and fixed only after the measurement window closes.',
    ]);
  });

  it('M17 specs/22: the M16 correction — pnpm test was never run, and bin.ts is 0% covered', () => {
    expectPinned(spec22M17(), [
      "This milestone's own exit tests (below) are not the first to list `pnpm test` — M16's exit tests already did, and that was never honoured.",
      'It has been failing the entire time: `packages/cli/src/bin.ts` reports 0% line coverage against the 85% per-file floor `vitest.config.ts` sets (`bin.ts` runs only as a spawned subprocess in every CLI test, and v8 coverage cannot see into a spawned child process), and every recent CI run on this repository is red for exactly that reason.',
    ]);
    expectAbsent(spec22M17(), [
      'M16 was verified piece by piece with `node scripts/run-tests.mjs run`',
    ]);
  });

  it('M17 specs/22: every M17 test carries its own piece marker, exactly as the M16 convention does', () => {
    expectPinned(spec22M17(), [
      'Every M17 test\'s `describe` name carries `(specs/22 M17 P<n>)`, which is what `-t "M17"` selects on, exactly as the M16 convention above works: that filter exits 0 when it selects nothing, so a green `-t "M17"` run is not by itself evidence that anything ran, and the exit gate also requires that every piece that adds tests has at least one test carrying its own marker.',
    ]);
    expectLines(spec22M17(), ['node scripts/run-tests.mjs run -t "M17"']);
  });

  it("M17 specs/22: Phase B do-not-build still names concealment as Decision 11's own non-goal", () => {
    expectPinned(spec22M17(), [
      '**Do not build (Phase B):** a second trial to replace a disappointing first one; any metric chosen after seeing the data; marketing claims not carried by the published result; concealment work of any kind — hiding the trial app from screen sharing, recording or proctoring (Decision 11).',
    ]);
    expectAbsent(spec22M17(), [
      '**Do not build:** a second trial to replace a disappointing first one',
    ]);
  });

  // --- specs/09 §9.5: the forge-test-report v1 contract ---------------------------------------------

  it('M17 specs/09: only name and status are required, every other field degrades per 13 F-TEST-*', () => {
    expectPinned(spec09(), [
      "Only `name` and `status` are required on each entry; every other field is optional, and a consumer that needs a field the project's own test command did not supply degrades to a stated, typed outcome rather than guessing (`13` F-TEST-1 point 4, F-TEST-6, F-TEST-7 and F-TEST-10 each state theirs).",
    ]);
  });

  it('M17 specs/09: status skip names a test the runner itself skipped, never run and never failed', () => {
    expectPinned(spec09(), [
      "`status: 'skip'` names a test the runner itself skipped — not run, and not failed.",
    ]);
  });

  it('M17 specs/09: kind only applies on fail, and assertion is the conservative default for hunk credit', () => {
    expectPinned(spec09(), [
      "`kind` applies only when `status` is `'fail'` and is omitted for a pass or a skip; `assertion` is the default reading when the source format carries no finer failure signal than pass/fail (TAP, for one), which is the conservative choice `13` F-TEST-10's own hunk-mutation credit logic reads from here rather than guessing itself.",
    ]);
  });

  it('M17 specs/09: acId is additive to the existing extractAcId convention, never a replacement', () => {
    expectPinned(spec09(), [
      "`acId`, when present, is an already-extracted AC id from a `forge-json`-emitting translator that knows its own project's naming convention better than a generic regex would; when absent, the `extractAcId` regex-over-`name` convention point 2 above describes still applies, unchanged — this field is additive, never a replacement for it.",
    ]);
    expectAbsent(spec09(), [
      'Emit results into a normalised report (`docs/forge/reports/test-results.json`) mapping',
    ]);
  });

  it('M17 P21 specs/09 (Q346): message is valid on fail or skip, refused on pass, unlike kind', () => {
    expectPinned(spec09(), [
      "`message` (post-v1.0, `specs/22` M17 P21, Q346) is free-text detail about why a test did not pass, valid on `'fail'` OR `'skip'` (a real skip reason, e.g. JUnit's `<skipped message=\"...\">` or pytest's `skip(reason=...)`) but refused on `'pass'` — unlike `kind`, which classifies only a failure and has no \"kind of skip,\" so the two fields are NOT restricted to the same statuses.",
    ]);
  });

  it('M17 P21 specs/09 (Q346, round 3): junit-xml and vitest-json are the two built-in formats that populate message so far', () => {
    expectPinned(spec09(), [
      "Present only when the project's own test command (or a translator reading it) actually has this text to report; of the built-in formats, `junit-xml` reads a real one straight off `<failure>`/`<error>`/`<skipped>` when the dialect gives one, and `vitest-json` carries one through for its own hook-throw reclassification, but no other built-in format does yet — so its absence on a real failure or skip is not itself a signal of anything.",
    ]);
  });

  // --- specs/13 F-TEST-1/6/7: consumers re-stated in terms of forge-test-report ---------------------

  it('M17 specs/13 F-TEST-1 point 4: the single layer command is the testCommands entry either form', () => {
    expectPinned(ftest1(), [
      "**Every layer has a single command** recorded in the KB: `test:unit`, `test:integration`, `test:contract`, `test:e2e`, `test:nfr` — the layer's own `execution.testCommands` entry (`18` §18.3's legacy bare string or post-v1.0 `specs/22` M17's structured form, converted into `09` §9.5's `forge-test-report` either way), never an ad-hoc invocation a gate composes for itself.",
    ]);
  });

  it('M17 specs/13 F-TEST-6: no filter means the retry is skipped and recorded unclassified', () => {
    expectPinned(ftest6(), [
      '"In isolation" means the layer\'s own `filter` capability (`18` §18.3\'s structured `execution.testCommands`, post-v1.0 `specs/22` M17): a layer declared only as a legacy bare string, or declared structured with no `filter` template, cannot run one test in isolation at all, and the retry is skipped — the failure is recorded `unclassified`, never silently read as "not flaky" and never silently read as a confirmed regression either.',
    ]);
  });

  it('M17 specs/13 F-TEST-7 point 2: forge-test-report is the one shape every consumer reads', () => {
    expectPinned(ftest7(), [
      "Whichever it is, FORGE converts it into **`forge-test-report` v1** (`09` §9.5), the one shape every later consumer of a test result — this section's own flake control, a binding check, hunk mutation, AC-coverage — actually reads; nothing downstream reasons about a runner-native format directly, and a project using only the legacy bare-string `testCommands` form keeps today's exact Vitest/pytest behaviour, converted the same way.",
    ]);
  });

  it("M17 specs/13 F-TEST-7 point 5: no scope/filter is each consumer's own stated, bounded degradation", () => {
    expectPinned(ftest7(), [
      "A structured layer's own `scope`/`filter` templates (`18` §18.3) are how a project opts into file- and name-scoped runs; a layer with neither runs its whole suite every time, which the consumers that would otherwise scope to one file (F-TEST-6 above, F-TEST-5's binding, F-TEST-10's hunk mutation) each handle as their own stated, bounded, typed degradation, never an unbounded fallback.",
    ]);
  });

  // --- specs/13 F-TEST-9: the three hardening additions ----------------------------------------------

  it('M17 specs/13 F-TEST-9(a): the root-path token rewrite must not mask a replace-masked regression', () => {
    expectPinned(ftest9(), [
      "**This root-path rewrite must not be combinable with a declared `replace` rule in a way that can mask a real regression** (post-v1.0, `specs/22` M17): a root-path token substitution that does not preserve length parity between the reference and the candidate shifts a later, length-anchored `replace` rule's own cut point by a different offset on each side, which can turn a genuine PASS-vs-FAIL difference into byte-identical normalised text on both sides, silently erasing it.",
      "The exact mechanism that closes this — a length-preserving token, a change to the order or composition of the root rewrite against a `replace` rule, or provenance tracking through the later rule so a cut point is reported in pre-rewrite coordinates — is this milestone's own BUILD decision, not fixed here: any of the three satisfies the requirement, and the build is proven against a real repro of the masking behaviour (and a new adversarial round beyond it), not merely asserted safe.",
    ]);
  });

  it('M17 specs/13 F-TEST-9(c): normalisation runs under one stated wall-clock budget for the whole case (reworded M17 P14, Q317 Decision 8: `redact-json-pointers` joins the closed rule list)', () => {
    expectPinned(ftest9(), [
      "The rules are `strip-ansi`, `line-endings`, `trim-trailing-whitespace`, `sort-lines`, `json-canonical` (parse, sort keys, re-serialise; a non-JSON observation is an error, not a pass), `ignore-json-pointers`, `replace` (a regular-expression source with a literal replacement, scoped to a stream or an output file, linted at load for catastrophic-backtracking shapes — conservative, not a proof of linear time — and run, together with every other rule a declaration lists for one case, under a single stated wall-clock budget (post-v1.0, `specs/22` M17; default 5000 ms, bounding the whole ordered application for that case, not merely one `replace` rule's own match), exceeding which makes the case `error`, a typed refusal, never a hang — the lint at load is advisory defence in depth against a known catastrophic shape, never a substitute for this runtime bound, which also catches a pathological shape the lint's own heuristic misses or a merely large observation) and `redact-json-pointers` (post-v1.0, `specs/22` M17, `process/SPEC-QUESTIONS.md` Q317 Decision 8: at each of its own named pointers, replaces every match of a regular-expression `pattern` found within the STRING there with a literal `replacement`, never deleting the member the way `ignore-json- pointers` does — the one mechanism that can redact a real filesystem path, or any other substring, embedded inside a `library` surface's own structured result, which carries no raw text for `replace` to run against at all.",
    ]);
  });

  it('M17 specs/13 F-TEST-9(b): observing the candidate isolates .forge/parity/ from its own case commands', () => {
    expectPinned(ftest9(), [
      "**Observing the candidate isolates `.forge/parity/` from the candidate's own case commands** (post-v1.0, `specs/22` M17): the directory is either absent from the tree the case's own `run` sees, or mounted read-only for it, closing the self-reverting-tamper gap the honest boundary below used to disclose rather than close — a case that reads a capture's own stored observation while it runs, edits it, and restores it before the trust anchor's second comparison, which the anchor cannot see either way (its two comparisons bracket the run, never watch it continuously).",
    ]);
  });

  it("M17 specs/13 F-TEST-9: the anchor's boundary is corrected — .forge/parity/ tamper is closed for the candidate", () => {
    expectPinned(ftest9(), [
      "A candidate case's own command cannot write or restore anything under `.forge/parity/` while it runs (above, a read-only isolation mechanism still permitting a read), which closes the one self-reverting-tamper gap this boundary used to carry for the candidate side; it can still change and restore any OTHER file in the tree between the two comparisons, which neither comparison sees (the harness uses only the bytes it loaded, so such a change alters nothing the harness itself writes into a tree or compares, but the case's own command can read that other file while it is changed, and can do anything else the user can outside `.forge/parity/`).",
    ]);
    expectAbsent(ftest9(), [
      'code a case runs can change a file and restore it between the two comparisons',
    ]);
  });

  it('M17 specs/13 F-TEST-9: the honest boundary is corrected — read-only still permits the review-caught read-cheat', () => {
    expectPinned(ftest9(), [
      "The candidate is observed in place, and its own case command can no longer write or restore anything under `.forge/parity/` (above): where the chosen isolation mechanism makes the directory absent from the tree the command sees, it cannot read it either; where the mechanism is read-only instead, the command can still read it, including a capture's stored observation, and a change that reads its own expected output is a code change this check cannot tell from a faithful one — review is what catches that, exactly as it always has.",
    ]);
    expectAbsent(ftest9(), ['the candidate is observed in place, so the code under test can read']);
  });

  // --- specs/13 F-TEST-11: test adoption and the translator proof -----------------------------------

  it('M17 specs/13 F-TEST-11: testCommands is either the legacy or the structured form, never mixed', () => {
    expectPinned(ftest11(), [
      "A project's test configuration (`18` §18.3's `execution.testCommands.<layer>`) is EITHER the legacy bare-string form — unchanged meaning, Vitest JSON or pytest JUnit XML by `detectEcosystem`, F-TEST-1 point 4 — OR the structured form F-TEST-7 point 2 names.",
    ]);
  });

  it('M17 specs/13 F-TEST-11: what detection cannot confidently recognise hands off to adopt-tests', () => {
    expectPinned(ftest11(), [
      'An unfamiliar framework, an in-house runner with its own output shape, a polyglot repository detection reads only partly, or a project with no test setup at all — anything detection does not confidently recognise — is handed to an AI-driven workflow instead of guessing: **`adopt-tests`** (P7 builds it).',
    ]);
  });

  it('M17 specs/13 F-TEST-11: a failing translator proof is a typed refusal naming the failing check', () => {
    expectPinned(ftest11(), [
      'A failing proof is a typed refusal naming the check that failed, never a partial or a best-effort pass.',
    ]);
  });

  it('M17 specs/13 F-TEST-11: a passing proof is evidence pinned to content hash and runner version', () => {
    expectPinned(ftest11(), [
      "A passing proof's result is itself evidence: pinned to the translator's own content hash and the detected runner's version, it is re-run by `forge doctor` whenever either changes, so a translator or a runner upgrade does not silently keep trusting a proof taken against an older pair.",
    ]);
  });

  it('M17 specs/13 F-TEST-11: an agent-proposed config is copied in only after the proof AND G-TestAdopt', () => {
    expectPinned(ftest11(), [
      'An agent-proposed configuration — a translator, a runner choice proposed for a project with no test setup, or anything else `adopt-tests` produces — reaches its staged proposal record the identical way a confident detection\'s does, and is copied into `.forge/config.yaml` ONLY after it passes the translator proof AND a human approves it at the **`G-TestAdopt`** gate (`10` defines its one check, which reads that same staged record); a human-authored translator or a human-chosen runner for a no-tests project passes through the identical proof, record and gate, since F-TEST-9\'s own "a reference recorded from the code under test agrees with itself" danger applies equally to a translator nobody but its own author reviewed.',
    ]);
  });

  it('M17 specs/13 F-TEST-11: the staged proposal record is what breaks the write/approve circularity', () => {
    expectPinned(ftest11(), [
      '**The staged proposal, and why writing and approving cannot be the same act.** Applying a proposal to the live config and approving `G-TestAdopt` cannot be ordered as "write, then the gate checks what was written": the gate\'s own deterministic check has to find something to evaluate before a human approves it, and nothing may reach the live `execution.testCommands.<layer>` entry before that approval — each side needs the other to have gone first.',
    ]);
  });

  // --- specs/18: structured testCommands, coverage source/format, vcs.trunk, worktree location -----

  it('M17 specs/18 §18.3: the legacy bare string keeps its exact current meaning', () => {
    expectPinned(spec18Config(), [
      '**`execution.testCommands.<layer>` — structured form (post-v1.0, `specs/22` M17).** The bare string shown above (`"pnpm test"`) keeps its EXACT current meaning: a single shell command, its output read as Vitest JSON for a `package.json`-having project or pytest JUnit XML for a Python-marker project, by the pre-existing `detectEcosystem` rule — the LEGACY path, not the only path, and never changed by a project that does not opt into the alternative below; `detectEcosystem` leaves the test-time path entirely once a layer uses it (`13` F-TEST-1).',
    ]);
  });

  it('M17 specs/18 §18.3: {output} is FORGE-allocated and deleted before every run — a stale report is never read', () => {
    expectPinned(spec18Config(), [
      '`output.source: file` names `{output}`, a path FORGE itself allocates and deletes before every run of that layer: a stale report left over from an earlier run, a crash or an unrelated process is never read, which is a real, load-bearing guarantee, not a convenience — a command whose `run` does not itself write that exact path fails typed rather than silently reading an old result.',
    ]);
  });

  it('M17 specs/18 §18.3: a translate that exits non-zero or prints invalid forge-json is a typed tool-error', () => {
    expectPinned(spec18Config(), [
      "`format` picks a built-in parser into `09` §9.5's `forge-test-report`; `translate`, when given, is an additional command run under the identical confined-command sandbox and timeout `run` itself runs under, with `{output}` available to it, and it MUST print a schema-valid `forge-test-report` on stdout — a `translate` that exits non-zero, or whose stdout does not parse as that shape, is a typed tool-error, never silently read as zero tests.",
    ]);
  });

  it('M17 specs/18 §18.3: the degradation table — no filter, no scope, no file attribution, no kind', () => {
    expectPinned(spec18Config(), [
      'No `filter` → the flaky-retry-in-isolation mechanism (`13` F-TEST-6) is skipped for that layer and the test is recorded `unclassified`, never silently read as "not flaky".',
      'No `scope` → a consumer that would otherwise scope to one file or story (binding, hunk mutation) runs the whole suite instead, bounded by a stated budget, with a typed refusal past it, never an unbounded fallback.',
      'No per-test file attribution in the chosen `format` → a consumer attributes by test name alone and says so in its output, never guessing a file.',
      "No `kind` signal in the chosen `format` (TAP, for one) → every failure reads `kind: 'assertion'`, `09` §9.5's own conservative default for hunk-mutation credit.",
    ]);
  });

  it('M17 specs/18 §18.3: coverage source/format replaces the hard-coded Istanbul path', () => {
    expectPinned(spec18Config(), [
      "**`quality.coverage.source`/`.path` (post-v1.0, `specs/22` M17).** `source` (`istanbul-json` default | `lcov` | `cobertura` | `jacoco`) and an optional `path` override replace the previously hard-coded assumption that coverage always arrives as Istanbul's own `coverage/coverage-summary.json` (confirmed pre-M17: `packages/cli/src/commands/loop/test/coverage.ts`'s own `COVERAGE_SUMMARY_RELATIVE_PATH` constant named exactly that path, unconditionally) — a project whose own tooling emits `lcov.info`, Cobertura XML or a JaCoCo report declares which, and coverage reads that format at that layer's own conventional path instead.",
    ]);
  });

  it('M17 specs/18 §18.3: vcs.trunk defaults to main and is proposed at init from origin/HEAD', () => {
    expectPinned(spec18Config(), [
      '**`vcs.trunk` (post-v1.0, `specs/22` M17).** A string, default `"main"`.',
    ]);
  });

  it('M17 specs/18 §18.3: worktrees move under the user cache directory, keyed by a project hash', () => {
    expectPinned(spec18Config(), [
      "**Worktree location (post-v1.0, `specs/22` M17).** Lane and integration worktrees, and parity's own reference scratch tree, move out of the project's own working tree entirely: `18.1`'s \"Run state\" tier and `18.2`'s layout below are amended accordingly.",
    ]);
  });

  it('M17 specs/18 §18.3: forge doctor reports an old in-tree worktree and offers to remove it', () => {
    expectPinned(spec18Config(), [
      '`forge doctor` reports any worktree it still finds under the old, in-tree location and offers to remove it (`06` §6.4).',
    ]);
  });

  it('M17 specs/18 §18.1: the Run state tier no longer lists worktrees among what it holds', () => {
    expectLines(spec18Tiers(), [
      '| **Run state** | `.forge/state/**` | ❌ gitignored | partially | Event log (truth for runs), index, caches (lane/integration worktrees live outside the project tree entirely, post-v1.0 `specs/22` M17 — see 18.3) |',
    ]);
    expectAbsent(spec18Tiers(), ['Event log (truth for runs), index, worktrees, caches']);
  });

  it('M17 specs/18 §18.2: a short note points a reader of the layout diagram at the new worktree location', () => {
    expectPinned(spec18Layout(), [
      "**Lane and integration worktrees no longer live under `.forge/state/`** (post-v1.0, `specs/22` M17): they sit outside the project tree entirely, under the user's cache directory.",
    ]);
    expectAbsent(spec18Layout(), ['worktrees/<laneId>/         git worktrees']);
  });

  // --- specs/03: forge test adopt, forge spec re-derive, forge migrate run --------------------------

  it('M17 specs/03 §3.2.1: the existing forge adopt row is unchanged (confirmed accurate, not a new row)', () => {
    expectLines(spec03_321(), [
      '| `forge adopt [dir]` | Brownfield: ingest an existing codebase into a KB (see `17`). |',
    ]);
  });

  it('M17 specs/03 §3.2.2: forge spec re-derive is now a named subcommand, wired by P17', () => {
    expectLines(spec03_322(), [
      '| `forge spec <sub>` | `list`, `show <id>`, `validate`, `trace <id>`, `matrix`, `orphans`, `new <type>`, `re-derive` (post-v1.0, `specs/22` M17 P17; `09` §9.7 point 4) |',
    ]);
  });

  it('M17 specs/03 §3.2.5: forge test adopt proposes a structured testCommands entry per layer', () => {
    expectLines(spec03_325(), [
      '| `forge test <sub>` | `plan`, `generate`, `run`, `report`, `flaky`, `coverage`, `binding`, `exempt`, `adopt` (post-v1.0, `specs/22` M17) |',
    ]);
    expectPinned(spec03_325(), [
      "(Post-v1.0, `specs/22` M17 P6/P7.) Detects, or hands off to the agent-run `adopt-tests` workflow for, a project's test runner per layer (`13` F-TEST-11): inspects manifests, CI configuration and build files; writes a structured `execution.testCommands` entry preferring the runner's richest machine-readable format to a STAGED proposal record, `.forge/test-adopt/<layer>.proposal.yaml`, never straight to `.forge/config.yaml`.",
      "`--write [--run <runId>]`, run alone, is the separate PROMOTION step: it copies a layer's staged proposal into the live `.forge/config.yaml`, which it refuses (typed, not a silent no-op) until that proposal's translator proof has passed and a human has approved it at `G-TestAdopt` (`10`); `--run` scopes the approval lookup to one run (defaulting to the project's own last dispatched run), the same convention `forge gate approve`'s own `--run` already uses.",
    ]);
  });

  it('M17 specs/03 §3.2.5: forge migrate run applies not-yet-applied migrations.yaml entries by phase', () => {
    expectPinned(spec03_325(), [
      "(Post-v1.0, `specs/22` M17 P18.) Applies every not-yet-applied entry of `docs/forge/kb/data/migrations.yaml` (`09` §9.7 point 4, the `model-data` brief's own shape) whose `phase` matches the given value, in the file's own apply order, honouring each entry's `after`/`expands` dependency: for each, runs the migration script or backfill routine the entry's own owning ADR named (built by the `expand`/`contract` workflow step that precedes this command in the `migrate` workflow), recording which entries this invocation applied so a repeat invocation is a no-op for them (the scripts themselves are also required to be independently idempotent, `12` F-DATA-6).",
    ]);
  });

  // --- specs/10 §10.3: the G-TestAdopt gate ----------------------------------------------------------

  it('M17 specs/10 §10.3: G-TestAdopt is the second workflow-scoped gate, conditional on the structured form', () => {
    expectPinned(spec10(), [
      "**`G-TestAdopt`** (post-v1.0, `specs/22` M17, `13` F-TEST-11) is the second workflow-scoped gate to have a file, scheduled by the `adopt-tests` workflow's own `kind: gate` step (P7 builds the workflow; this gate's own file).",
    ]);
    expectPinned(spec10(), [
      "This check is **conditional, not universal**: a layer whose `testCommands` entry is the legacy bare-string form (`18` §18.3) never needs this gate at all, because nothing about it was ever proposed by `forge test adopt` — a workflow that wires `adopt-tests` only ever schedules this gate's `kind: gate` step for a layer the structured form governs.",
    ]);
  });

  it('M17 specs/10 §10.3: G-TestAdopt reads the staged proposal record, never the live config entry', () => {
    expectPinned(spec10(), [
      "Its one deterministic check, `checkId: test-adoption:approved`, reads `.forge/test-adopt/<layer>.proposal.yaml` (`13` F-TEST-11's staged proposal record, never the live `.forge/config.yaml` `execution.testCommands` entry: the live entry does not exist yet when this check first needs to pass, and this check existing to gate the live entry's own creation is exactly why it cannot be the thing that reads it) for the layer under review.",
    ]);
  });

  it('M17 specs/10 §10.3: `--write` promotes only after the check has passed AND the gate is approved', () => {
    expectPinned(spec10(), [
      "`--write` (the promotion that copies the staged record into the live config, `13` F-TEST-11) runs only after this check has passed AND the approval itself has happened (rule 6's own `forge gate approve`), never on the check's pass alone: approving the gate is what certifies the staged record for promotion, and a `--write` attempted before that approval is a typed refusal, not a silent no-op.",
    ]);
  });

  // --- specs/18 §18.2: the staged test-adoption proposal directory -----------------------------------

  it('M17 specs/18 §18.2: the on-disk layout lists `.forge/test-adopt/` as committed — staged proposals', () => {
    const section = spec18Layout();
    expectLines(section, [
      '│  ├─ test-adopt/                    committed: staged (not-yet-live) testCommands proposals, one per layer (13 F-TEST-11)',
    ]);
  });

  // --- specs/06: worktree location, landing on trunk, real retries ----------------------------------

  it('M17 specs/06 §6.4: the worktree location moves outside the project tree, keyed by project hash', () => {
    expectPinned(spec06_64(), [
      "**Worktree location (post-v1.0, `specs/22` M17).** Before M17, a lane's worktree lived inside the project tree, at `.forge/state/worktrees/<laneId>/`, which required the `.gitignore` rule below to keep it from self-referencing, and let any runner that globs the whole project tree discover a lane's own in-progress copy of the project's test files.",
    ]);
  });

  it('M17 specs/06 §6.5: two paths land a finished run on trunk, and the diverged refusal names the remedy', () => {
    expectPinned(spec06_65(), [
      "**Landing a finished run on trunk (post-v1.0, `specs/22` M17).** Before M17, a completed run's own integration branch was left exactly where the run's last merge put it: no command and no doc said how, or whether, it ever reaches `vcs.trunk` (`18` §18.3), and a person who committed it there by hand then blocked the next run (its lanes branch from the integration-branch tip, which a manual trunk commit never updates).",
    ]);
    expectPinned(spec06_65(), [
      "Two paths now land a run, and a project picks one by its own `execution.integrationBranch` configuration: (1) a project that configures its integration branch to BE the trunk itself (the \"configurable to merge directly to a trunk\" form above) needs nothing further — each lane merge already lands on trunk as the run proceeds, which is also why F-TEST-9's trust anchor names this as a project that \"gets no protection\" from a rewritten oracle (`13` F-TEST-9, the anchor's boundary); (2) a project whose integration branch is the default, separate `forge/integration/<stage>` branch lands a finished run with an explicit command (P9 names and builds it) that fast-forwards or merges the run's own integration-branch tip onto `vcs.trunk`, refusing when trunk has diverged from the integration branch's own base since the run started — the refusal names the remedy (P9's own exact wording) rather than leaving the project blocked with no path forward: at minimum, which ref to rebase the integration branch onto and which command re-attempts the land once it is current.",
    ]);
  });

  it('M17 specs/06 §6.8: driveToCompletion must actually consult decideRetry/computeBackoff, not merely describe them', () => {
    expectPinned(spec06_68(), [
      "**This table describes a policy, not merely a config shape (post-v1.0, `specs/22` M17).** A retryable failure is not retried because this table names a class `retryOn` lists; it is retried because `driveToCompletion`'s own failure handling actually consults the step's declared `RetryPolicy`, decides whether and when to retry, and computes the real backoff — the identical decision-and-backoff logic the Never-retry rule above already depends on — before any retry attempt is scheduled, recreating the lane and re-executing from the step's own idempotency key, and emitting a `retry` event (`07` §7.2's `AdapterEvent{type:'retry'}` is the adapter-level signal; the engine's own retry decision is a separate, run-level event).",
    ]);
  });

  // --- specs/07 §7.2/§7.3: multi-event mapping, structured_output, cache tokens ----------------------

  it('M17 specs/07 §7.2: one raw message may map to several AdapterEvents, in emission order', () => {
    expectPinned(spec07_72(), [
      '**One raw adapter message may map to several `AdapterEvent`s (post-v1.0, `specs/22` M17).** `SessionHandle.events` is already `AsyncIterable<AdapterEvent>`, so this was always representable; the normative gap is that an adapter transport MUST actually do it rather than collapsing one raw message into at most one `AdapterEvent` and silently dropping the rest.',
    ]);
  });

  it('M17 specs/07 §7.3: the CLI transport is brought to the same multi-event shape as the SDK transport', () => {
    expectPinned(spec07_73(), [
      '**The CLI transport maps one raw message to several events, exactly as the SDK transport already does** (post-v1.0, `specs/22` M17).',
    ]);
  });

  it('M17 specs/07 §7.3: SessionResult.structured is populated from the real structured_output field', () => {
    expectPinned(spec07_73(), [
      '**`SessionResult.structured` is populated from the real `structured_output` field when one is present** (post-v1.0, `specs/22` M17).',
    ]);
  });

  it('M17 specs/07 §7.3: cacheReadTokens/cacheCreationTokens are summed from the per-model usage breakdown', () => {
    expectPinned(spec07_73(), [
      '**Honest cache-token accounting (post-v1.0, `specs/22` M17).** `SessionUsage` gains `cacheReadTokens`/`cacheCreationTokens` alongside its existing fields (above).',
    ]);
    expectPinned(spec07_73(), [
      "Both are summed from the adapter's own real **per-model** usage breakdown the result message carries (every model call made through the query pipeline — the main loop, Task subagents, sidechains and internal calls), never read from the main-loop-only usage field alone: the main-loop-only field excludes exactly the subagent and sidechain spend a real multi-agent FORGE step routinely makes, so a ledger that reads only it under-reports real cache spend whenever a step uses either.",
    ]);
  });
});

describe("pin-test gaps closed to block granularity (specs/22 M17 P19) (PLAN-M17.md P19, SPEC-QUESTIONS.md Q294) — 77 of the 78 sentence-only pins an earlier milestone's own spec-first piece left open at block granularity (disclosed in GAUNTLET-LOG.md), confirmed still needed by a fresh re-audit this piece ran itself, now each also pinned to its own block, so a sentence inserted beside, relocated into, or swapped with one of them turns this red, not just the original expectPinned", () => {
  const spec03 = () => headingSection(readSpec('03-cli-and-installer.md'), '### 3.2.5 ');
  const spec10Gates = () =>
    headingSection(readSpec('10-workflow-engine-and-lifecycle.md'), '## 10.3 ');
  const spec17 = (prefix: string) => headingSection(readSpec('17-brownfield-ingestion.md'), prefix);
  const spec18 = (prefix: string) =>
    headingSection(readSpec('18-persistence-config-and-schemas.md'), prefix);
  const spec22M16 = () => headingSection(readSpec('22-build-plan-and-milestones.md'), '## M16 — ');

  it('M16 specs/03 §3.2.5 `forge parity capture` row block: the row, its human-act refusal, the --name default and the identical-capture no-op', () => {
    expectBlock(spec03(), [
      '| `forge parity capture [--name <name>]` | (Post-v1.0, `specs/22` M16; not wired yet.) Observe the reference a parity declaration names, at its declared ref and in a scratch worktree, and write the content-addressed capture under `.forge/parity/captures/` (`13` F-TEST-9).',
      'A human act: no workflow runs it, and it refuses whenever the FORGE session marker `FORGE_RUN_ID` is present, whichever run it names (`10` §10.3 rule 6 defines the marker, an honest-session signal and not a security boundary).',
      'Without `--name`, every declaration; a `--name` that matches no declaration is refused.',
      'Capturing identical behaviour again changes nothing; a capture that would differ from an existing one for the same key is refused, never overwritten.',
      '|',
    ]);
  });

  it('M16 specs/03 §3.2.5 `forge parity check` row block: the row, --trusted, --story, the exit code and the refusal reasons', () => {
    expectBlock(spec03(), [
      "| `forge parity check [--name <name>] [--trusted <ref>] [--story <id>] [--no-record]` | (Post-v1.0, `specs/22` M16; not wired yet.) Compare the candidate, observed in place, with each declaration's selected capture, and write one `ParityEvidence` record for the invocation (`18` §18.7) unless given `--no-record`, which writes none.",
      '`--trusted <ref>` names the trust anchor, a full commit sha or a ref name that begins `refs/` and that `git check-ref-format` accepts: everything under `.forge/parity/` is compared, as it is on disk, with the tree at that ref, and a difference is `oracle-changed` (`13` F-TEST-9); without it nothing is compared and the record says `trusted: null`.',
      '`--story <id>` names the story the record is for.',
      'Exit 0 only when no verdict is failing.',
      'No declaration (`no-declarations`) and nothing compared (`nothing-compared`) each fail with a `reason` rather than passing; a `--name` that matches no declaration, and a `--trusted` that is not in that form or does not resolve, are refused.',
      'It is the one deterministic check, `behavior:parity`, of the workflow-scoped gate `G-Parity` (`10` §10.3 rule 8), which runs it as `forge parity check --json --no-record --trusted refs/heads/main`.',
      '|',
    ]);
  });

  it('M16 specs/03 §3.2.5 `forge evidence prune` row block: the row, the --apply refusal, --keep and the never-pruned guarantee', () => {
    expectBlock(spec03(), [
      '| `forge evidence prune [--apply] [--keep <n>]` | (Post-v1.0, `specs/22` M16; not wired yet.) Retention for `MutationEvidence`, `EvidenceBundle` and `ParityEvidence` records (`18` §18.7, Retention).',
      'A dry run unless `--apply`, which refuses whenever the FORGE session marker `FORGE_RUN_ID` is present, as `forge parity capture` does.',
      '`--keep <n>` keeps the `n` newest (highest-id) records per type and subject, `n` an integer of at least 1, default 5.',
      'The highest id of each type, and any record something still references, is never pruned; what is referenced is computed to a fixed point, and a prune that cannot enumerate every store that can hold an evidence id refuses and removes nothing.',
      '|',
    ]);
  });

  it('M16 specs/03 §3.2.5 `forge test binding --hunks` row block: the row, the --base requirement and the report-only exit code', () => {
    expectBlock(spec03(), [
      '| `forge test binding --story <id> --hunks --base <ref> [--max-hunks <n>]` | (Post-v1.0, `specs/22` M16; not wired yet.) The `--hunks` form of `forge test binding`: behavioural binding at hunk granularity rather than for the change as a whole (`13` F-TEST-10).',
      '`--hunks` requires `--base`, and `--base` without `--hunks` is a usage error.',
      'Above `--max-hunks` it degrades to file or change granularity and says so.',
      'Report-only: the exit code follows the change-level result over the same `--base` range, by the rule it follows without `--hunks`.',
      '|',
    ]);
  });

  it('M17 specs/03 §3.2.5 `forge test adopt` row block: the row, --write promotion, --agent, --check-proof and what it prints', () => {
    expectBlock(spec03(), [
      "| `forge test adopt [--write [--run <runId>]] [--agent] [--check-proof <layer>] [--json]` | (Post-v1.0, `specs/22` M17 P6/P7.) Detects, or hands off to the agent-run `adopt-tests` workflow for, a project's test runner per layer (`13` F-TEST-11): inspects manifests, CI configuration and build files; writes a structured `execution.testCommands` entry preferring the runner's richest machine-readable format to a STAGED proposal record, `.forge/test-adopt/<layer>.proposal.yaml`, never straight to `.forge/config.yaml`.",
      "`--write [--run <runId>]`, run alone, is the separate PROMOTION step: it copies a layer's staged proposal into the live `.forge/config.yaml`, which it refuses (typed, not a silent no-op) until that proposal's translator proof has passed and a human has approved it at `G-TestAdopt` (`10`); `--run` scopes the approval lookup to one run (defaulting to the project's own last dispatched run), the same convention `forge gate approve`'s own `--run` already uses.",
      '`--agent` runs the `adopt-tests` workflow directly, investigating and proving a translator for real, rather than only proposing on an unrecognised runner.',
      "`--check-proof <layer>` is `G-TestAdopt.gate.yaml`'s own deterministic check command, re-verifying the staged proof's own freshness.",
      'Prints what it detected or proposed, the translator-proof result where one ran, and, for `--write`, the promotion outcome.',
      '|',
    ]);
  });

  it('M17 specs/03 §3.2.5 `forge migrate run` row block: the row, --migration, the exit codes and the --json envelope', () => {
    expectBlock(spec03(), [
      "| `forge migrate run --phase <expand\\|migrate\\|contract> [--migration <id>] [--json]` | (Post-v1.0, `specs/22` M17 P18.) Applies every not-yet-applied entry of `docs/forge/kb/data/migrations.yaml` (`09` §9.7 point 4, the `model-data` brief's own shape) whose `phase` matches the given value, in the file's own apply order, honouring each entry's `after`/`expands` dependency: for each, runs the migration script or backfill routine the entry's own owning ADR named (built by the `expand`/`contract` workflow step that precedes this command in the `migrate` workflow), recording which entries this invocation applied so a repeat invocation is a no-op for them (the scripts themselves are also required to be independently idempotent, `12` F-DATA-6).",
      '`--migration <id>` restricts the run to one named entry rather than every entry of the given phase.',
      'Exit 0 only when every entry it attempted applied cleanly; 1 when one failed or could not be found; 2 on a usage error (an unknown `--phase` value, or `--migration` naming an id `migrations.yaml` does not have).',
      '`--json` prints `{"v":1,"phase":"<the --phase value>","applied":["id",...],"failed":0,"errors":0,"problems"?}`, the same `errors`/`problems` convention `forge test run`\'s own envelope uses (`09` §9.5).',
      '|',
    ]);
  });

  it('M16/M17 specs/03 §3.2.5 trailer paragraph block: the test <sub> row history, the shared --json envelope, the retention default and the two new M17 rows', () => {
    expectBlock(spec03(), [
      'Before M16 the `forge test <sub>` row omitted `binding` and `exempt`, both wired since `specs/22` M15 (`forge test binding [--story <id>]` reports behavioural binding, `13` F-TEST-5; `forge test exempt <storyId> <testId> --reason <text> --owner <identifier> --expires <iso-date>` records an exemption, `13` F-TEST-8).',
      'That omission predates M16; the row now lists them.',
      'Each of the four M16 commands above takes the global `--json` flag (§3.2) and prints one `{"v":1,...}` object (§3.5).',
      'The retention default of 5 follows §3.4\'s "retain last 5" backups.',
      'The two M17 rows above are new CLI surface this file did not define before M17 P1: `forge adopt` and `forge spec re-derive` already had rows (§3.2.1, §3.2.2), confirmed still accurate against what P11/P17 build; `forge test adopt` and `forge migrate run` did not exist here at all.',
    ]);
  });

  it('M16 specs/10 §10.3 reference-oracle paragraph block: the inputs-contract line, the five refusal reasons and the no-nothing-as-success guard', () => {
    expectBlock(spec10Gates(), [
      '(Post-v1.0, `specs/22` M16.) A check against a reference oracle (`13` F-TEST-9) holds the same line for its own inputs.',
      "A check with no declaration at all (`no-declarations`), a declaration with no capture of its reference, an expired review or `unobservable` entry (a declaration's `expires` date, or an entry's expiry, has been reached), an oracle that changed since its trust anchor (`oracle-changed`), and a declaration that compares nothing, because it has no surface that is not exempt as `unobservable` (`nothing-compared`), each fail with a stated `reason`: an absent reference is not parity, and an empty comparison is not a match.",
      'A check that would print no passing and no failing case is refused (`ok: false`) instead, so `failOn: "failing > 0"` can never read nothing as success.',
      "Every check's result records its stdout, its exit code and its stderr (stderr sanitised of secrets and control bytes, and capped) as the audit trail (rule 4); an approval or waiver event carries their digests.",
    ]);
  });

  it('M16 specs/17 §17.4 item-3 characterisation-tests block: tests-before-refactor, the differential oracle, the reviewed-immutable reference and the BASELINE tag', () => {
    expectBlock(spec17('## 17.4 '), [
      '**Characterisation tests before refactoring.**',
      'Untested code that must change gets tests capturing *current* behaviour first (differential oracle, `13` F-TEST-2 #5).',
      'Only then does it change.',
      '(Post-v1.0, `specs/22` M16.) The system as found is a valid reference for that comparison, but only as a *reviewed, immutable* one (`13` F-TEST-9): a parity declaration whose `reference.ref` names the commit that holds the system as found, captured by a human act, never a recording the refactoring agent makes of the code it is about to change.',
      "The `BASELINE` tag that adoption's phase 8 creates (§17.2) is a legitimate `reference.ref`, where one exists.",
    ]);
  });

  it('M16 specs/18 §18.4 payload-versioning block: v, no per-payload version, kind-first dispatch, the additive rule and the parity payload', () => {
    expectBlock(spec18('## 18.4 '), [
      '**Payload versioning (post-v1.0, `specs/22` M16).**',
      '`v` versions the envelope and nothing else: it is the field of `ForgeEvent` above, and a log whose events carry any other `v` is refused by the reader, not guessed at.',
      'No payload carries a version of its own.',
      "A payload's shape is selected by its event `type` and, for `CheckRun`, by its `kind` (`'binding'` and `'exemption-declared'` from M15, `'parity'` from M16), checked first and explicitly, never inferred from which other fields happen to be present.",
      'Adding a `kind`, or adding an optional field to an existing `kind`, is additive and leaves `v` at 1: a reader skips a `kind` it does not recognise, reads an optional field only when it is present and well-typed, and ignores a field it does not know.',
      'A change that is not additive (a field changing its meaning or its type, a required field appearing) takes a new `kind` and never reinterprets an existing one.',
      "A `'parity'` payload carries the count per verdict, the total, the evidence id (null for a check run with `--no-record`) and the declaration names, never an observation, and, like the other kinds, it is written only where the run's id reaches the command in `FORGE_RUN_ID` and the command can name the run's own project root; a hunk run's counts and `granularity` are optional fields on the existing `'binding'` payload.",
    ]);
  });

  it('M16 specs/18 §18.7 append-only-discipline block: both types append-only, their own distinct file-per-run paths, what "superseded" means and the existing-path refusal', () => {
    expectBlock(spec18('## 18.7 '), [
      'Both are genuinely **append-only — never edited, only superseded**',
      "(`PLAN-M15.md` P2's own binding Mandate, mirroring the deprecate-not-delete discipline this registry already uses: an id, once allocated, is never reused or silently overwritten — `18` §18.8).",
      "Concretely, each is a NEW, distinctly-id'd file every time one is produced, never a rewrite of a prior one: `MutationEvidence`'s path (`reports/mutation/{story}-{ts}.md`, mirroring `GateReport`'s own `{gate}-{ts}` naming) makes every `forge test binding` run its own file; `EvidenceBundle`'s path (`reports/evidence/{id}-{story}.md`) carries its own real `EVID-####` id, so two assemblies for the same story — or two concurrent stories, `PLAN-M15.md` P7's own \"Tests first\" requirement — are two distinct files, never one file edited twice.",
      '"Superseded" means exactly what it means for an ADR (`08` §8.3/§8.4\'s `status: superseded` convention): an older instance stays on disk, readable, until `forge evidence prune` removes it (§18.7, Retention), and a newer one exists; nothing here claims a bundle is a single revised document the way a Story is (an earlier draft of this entry wrongly claimed that — see `SPEC-QUESTIONS.md` Q280\'s round-2 record — and separately miscited `18` §18.8 as defining "superseded," which it does not; the real definition is `08`\'s).',
      'The writer refuses an attempt to write to an already-existing path of either type (`PLAN-M15.md` P2\'s own "a bundle that edits an existing evidence record is refused" test) rather than relying on the naming scheme alone to make collision merely unlikely.',
    ]);
  });

  it('M16 specs/18 §18.7 hunk-level-MutationEvidence block: the EvidenceBundle.parityEvidence addition, the revert-hunks shape and the one-new-record rule', () => {
    expectBlock(spec18('## 18.7 '), [
      '`EvidenceBundle` gains an optional `parityEvidence` list, the ids of the `ParityEvidence` records a bundle rests on, beside its `bindingEvidence`; a bundle without it stays valid, and M16 changes no bundle assembler, so nothing populates it yet.',
      '`MutationEvidence` gains a second shape for hunk-level mutation (`13` F-TEST-10), which its field list above already anticipated ("the exact commit range or hunk set reverted"): its `mutationKind` has a second member, `revert-hunks`, beside `revert-implementation`, and a record of that kind carries, beyond what schema version 1 records, the base sha the hunks were taken against, the diff algorithm, the `granularity` used (`hunk`, `file` or `change`) and the hunk list: each hunk\'s id, path, ranges, content hash, verdict and `killedBy`.',
      'A hunk run is its own new record; an existing change-level record is never rewritten to add one.',
    ]);
  });

  it('M16 specs/18 §18.7 schemaVersion-migrations block: the 1→2 bump, purity and the golden-file requirement, reversibility and the upgrade-coverage gap', () => {
    expectBlock(spec18('## 18.7 '), [
      'A record that uses a field schema version 1 lacks carries `schemaVersion: 2` (§18.6), and two migrations (§18.9) are added with those fields, both `1→2`: `MutationEvidence` and `EvidenceBundle`.',
      'Each sets `schemaVersion: 2` going up and changes nothing else (a version-1 record is otherwise already a valid version-2 record), is pure, and is covered by a golden-file test with a real "before" fixture, as §18.9 requires: the fixture\'s "after" differs from its "before" by `schemaVersion` at least.',
      'Whether either declares `reversible: true` is settled when it is written (`specs/22` M16 P5); one that does removes the version-2 fields and sets `schemaVersion: 1` going down, and a hunk-level `MutationEvidence` record has no version-1 form (`revert-hunks` is not a version-1 `mutationKind`), so that migration, if reversible, refuses such a record going down rather than stripping it.',
      'As built, the artifact-migration step of `forge upgrade` (`03` §3.4, step 4) lists only the documents under the specs root (`packages/cli/src/commands/upgrade/migrate-artifacts.ts`), so a record under `reports/` is not reached by it: version-1 evidence stays version 1 on disk.',
      'Until a migration has run, every reader of these two types must accept `schemaVersion` 1 and 2 (`specs/22` M16 P5).',
    ]);
  });

  it('M16 specs/18 §18.7 Retention-intro block: evidence files accumulate, and forge evidence prune is the deferred M15 policy', () => {
    expectBlock(spec18('## 18.7 '), [
      '**Retention (post-v1.0, `specs/22` M16).**',
      'Evidence files accumulate: every run writes a new one and none is edited.',
      '`forge evidence prune` (`03` §3.2.5) is the retention policy `specs/22` M15 P7 deferred.',
    ]);
  });

  it('M16 specs/18 §18.7 Retention three-types block: MutationEvidence/EvidenceBundle/ParityEvidence only, and what it never prunes', () => {
    expectBlock(spec18('## 18.7 '), [
      'It manages three types, `MutationEvidence`, `EvidenceBundle` and `ParityEvidence`, and nothing else.',
      "It never prunes a parity capture (the oracle's baseline, not its evidence), a collection-shaped artifact, the event log, or the tombstones below.",
    ]);
  });

  it('M16 specs/18 §18.7 Retention dry-run-by-default block', () => {
    expectBlock(spec18('## 18.7 '), [
      'It is a dry run by default: a dry run writes nothing and names what it would remove, and only `--apply` removes anything.',
    ]);
  });

  it('M16 specs/18 §18.7 Retention --apply-refusal block: the FORGE_RUN_ID refusal and the always-allowed dry run', () => {
    expectBlock(spec18('## 18.7 '), [
      '`--apply` refuses whenever the FORGE session marker `FORGE_RUN_ID` is present, whichever run it names (`10` §10.3 rule 6 defines the marker, an honest-session signal and not a security boundary), because a prune is a human act, as `forge parity capture` is: a run must not be able to discard the evidence about its own work.',
      'A dry run is always allowed.',
    ]);
  });

  it('M16 specs/18 §18.7 Retention --keep block: the newest-n-per-subject rule, the numeric-id ordering and the default of 5', () => {
    expectBlock(spec18('## 18.7 '), [
      '`--keep <n>` keeps the newest `n` records per type and subject: the story id when the record was written for a story, else the single shared subject `project`.',
      "Newest means highest id, compared as a number (§18.8), never a file's modification time.",
      "`n` is an integer of at least 1 (0, a negative number and a non-integer are refused) and defaults to 5, the precedent being `03` §3.4's retention of the last 5 backups.",
    ]);
  });

  it('M16 specs/18 §18.7 Retention highest-id-never-pruned block: stated on its own for the allocator no-reuse guarantee', () => {
    expectBlock(spec18('## 18.7 '), [
      'The highest id of each type is never pruned.',
      "`n` of at least 1 already implies it; it is stated on its own because the allocator's no-reuse guarantee rests on it (§18.8: allocation is a scan of what exists).",
    ]);
  });

  it('M16 specs/18 §18.7 Retention fixed-point-protection block: a referenced record is protected, computed to a fixed point, visiting-order-independent', () => {
    expectBlock(spec18('## 18.7 '), [
      'A record that anything still references is protected and reported with the reason.',
      'What survives is computed to a fixed point: it starts from the records `--keep` and the highest-id rule keep, and adds every record that a surviving record, or a store outside the evidence records, references, until nothing more is added.',
      'A record referenced only by a record this prune removes is therefore not protected, and the outcome does not depend on the order in which records are visited.',
      "The stores that can hold an evidence id (a surviving `EvidenceBundle`, a gate approval or waiver under `10` §10.3's evidence resolution, and whatever else the command's own enumeration finds) are enumerated and tested when it is built (`specs/22` M16 P14).",
    ]);
  });

  it('M16 specs/18 §18.7 Retention cannot-enumerate-refuses block', () => {
    expectBlock(spec18('## 18.7 '), [
      'A prune that cannot enumerate every store that can hold an evidence id, because one is unreadable or does not parse, refuses and removes nothing: a reference it could not see is one it could break.',
    ]);
  });

  it('M16 specs/18 §18.7 Retention two-step-pruning block: tombstone first, removal second, crash recovery, idempotence and the pruned-vs-dangling answer', () => {
    expectBlock(spec18('## 18.7 '), [
      'Pruning a record is two steps in a fixed order.',
      "A tombstone for its id (`docs/forge/reports/pruned/<id>.json`: the id, the type, the subject, the record's sha256 and the time) is created first, atomically (written whole to a temporary file beside it and renamed into place, so one that exists is never partial); the record is removed second.",
      'A crash between the two leaves a pending removal, a tombstone with its record still present.',
      'While both exist the record wins: a reference to the id resolves to the record, never to "pruned".',
      'A later prune completes a pending removal only if that record is still selected for removal by that prune; otherwise the record stays.',
      'The stores are enumerated once more after the tombstones are written and before any record is removed, and a record that has been referenced since the first enumeration is not removed (its tombstone stays, a pending removal as above); a reference written after that second enumeration is not seen, so `--apply` is not safe to run while a run or an approval that could cite a record it removes is in progress.',
      'A repeated or concurrent prune is idempotent.',
      'A reference to an id that has been pruned (its record removed) resolves to a distinct "pruned" answer that names the tombstone, never to "dangling".',
    ]);
  });

  it('M16 specs/18 §18.7 Retention tombstone-reader block: whether the allocator also reads tombstones is a build-time choice, either way no id reused', () => {
    expectBlock(spec18('## 18.7 '), [
      'Whether the id allocator also reads the tombstones is decided when the command is built (`specs/22` M16 P14); either way an id is never issued twice.',
    ]);
  });

  it('M16 specs/22 M16 "Build:" paragraph block: the harness, the two commands, G-Parity, the registered ParityEvidence type, per-hunk mutation and retention', () => {
    expectBlock(spec22M16(), [
      '**Build:**',
      "a behaviour-parity harness over observable surfaces FORGE can capture without owning the app (process stdout/exit codes, HTTP request/response pairs, library call/return, file outputs); `forge parity capture` and `forge parity check --json`; the workflow-scoped gate `G-Parity`, whose one `behavior:parity` deterministic check is reached through explicit `kind: gate` steps in the workflows that have a reference; parity evidence as a registered `ParityEvidence` artifact type plus the additive optional `EvidenceBundle.parityEvidence` id list; per-hunk mutation raising M15's binding evidence from change-level to hunk-level attribution; an evidence retention policy, deferred from M15 P7.",
    ]);
  });

  it('M16 specs/22 M16 "Do not build:" paragraph block: no visual/screenshot parity, no parity claim for greenfield work', () => {
    expectBlock(spec22M16(), [
      '**Do not build:**',
      "visual/screenshot parity — FORGE is not UI-framework-specific and a pixel oracle needs a rendering target it does not own; a parity claim for greenfield work, which has no reference by definition and must keep relying on M15's binding oracle.",
    ]);
  });

  it('M16 specs/22 M16 exit-tests paragraph block: the describe-name naming rule, the non-vacuous -t "M16" requirement and the twice-run parity exit test', () => {
    expectBlock(spec22M16(), [
      'Every M16 test\'s `describe` name carries `(specs/22 M16 P<n>)`, which is what `-t "M16"` selects on.',
      'That filter exits 0 when it selects nothing, so a green `-t "M16"` run is not by itself evidence that anything ran: the exit gate also requires that every piece that adds tests has at least one test carrying its own `(specs/22 M16 P<n>)` marker.',
      'The `forge parity check --json` exit tests run over one fixture refactor twice, once with a behaviour-preserving change (exit 0) and once with a behaviour-changing one (non-zero), so a check that never refuses and a check that always refuses each fail the gate.',
    ]);
  });

  // Not re-pinned here (78th of the 78): the rule-8 numbered-list opening ("8. (Post-v1.0 ...) A
  // gate may be workflow-scoped ...") already has full insertion/relocation/swap protection from the
  // pre-existing r3g block at "M16 specs/10 rule 8 block" above (`expectBlock` matches on
  // block.text, which a numbered-list block.text never includes its own "8. " marker in, so that
  // block already closes this content regardless of the marker). Giving it a second, parallel
  // expectBlock with the "8. "-prefixed text would just fail "found 0 blocks", because no block ever
  // opens with a list marker. The one gap that sentence-only pin still has — a renumbering that
  // relabels it "9." while leaving its content alone — is a different property than this piece's
  // mandate (content insertion/relocation/swap within a block) and is left as a disclosed gap.
});

describe('scanLines: tilde fences, indented code and hidden <div> wrappers (specs/22 M17 P19) (PLAN-M17.md P19) — closing the three shapes an earlier milestone\'s spec-first piece flagged as still evading expectAbsent (GAUNTLET-LOG.md, "item 10"); no specs/*.md file currently uses any of the three (checked by grep across every spec file before writing these), so all three are proven here against a synthetic fixture built the same way the existing fence/comment tests already are', () => {
  const sectionOf = (text: string) => sectionFromLines(text.split('\n'));

  it('M17 P19 scanLines: a tilde fence hides its content from prose exactly as a backtick fence does, and the two never cross-close each other', () => {
    const tilded = sectionOf(
      [
        '# Heading',
        '',
        'Before the tilde fence.',
        '',
        '~~~yaml',
        'fenced: A sentence only inside a tilde fence.',
        '~~~',
        '',
        'After the tilde fence.',
        '',
      ].join('\n'),
    );
    expect(() => {
      expectPinned(tilded, ['Before the tilde fence.', 'After the tilde fence.']);
    }).not.toThrow();
    expect(() => {
      expectPinned(tilded, ['A sentence only inside a tilde fence.']);
    }).toThrow();
    expect(() => {
      expectAbsent(tilded, ['A sentence only inside a tilde fence.']);
    }).toThrow();
    expect(() => {
      expectLines(tilded, ['fenced: A sentence only inside a tilde fence.']);
    }).not.toThrow();
    // Direct, sentence-boundary-independent proof (the fenced line's own "fenced: " prefix would
    // make expectPinned throw on an invalid sentence start regardless of fencing, so that throw
    // alone would not prove the fence worked): the literal text must not reach prose at all.
    expect(tilded.text).not.toContain('A sentence only inside a tilde fence.');

    const crossed = sectionOf(
      [
        '# Heading',
        '',
        '~~~',
        'still fenced: a line of backticks does not close a tilde fence',
        '```',
        'still fenced after the backtick line too',
        '~~~',
        '',
        'After the mixed fence.',
        '',
      ].join('\n'),
    );
    expect(() => {
      expectPinned(crossed, ['After the mixed fence.']);
    }).not.toThrow();
    expect(() => {
      expectAbsent(crossed, ['still fenced after the backtick line too']);
    }).toThrow();
  });

  it('M17 P19 scanLines: a bare 4-space-indented block hides its content from prose exactly as a fenced block does, but only when it opens right after a blank line or the document start', () => {
    const indented = sectionOf(
      [
        '# Heading',
        '',
        'Before the indented block.',
        '',
        '    A sentence only inside bare indented code.',
        '',
        'After the indented block.',
        '',
      ].join('\n'),
    );
    expect(() => {
      expectPinned(indented, ['Before the indented block.', 'After the indented block.']);
    }).not.toThrow();
    // The indented line opens right after a blank line, so if it were NOT swallowed as code it would
    // read as an ordinary new paragraph (a real block start `beginsASentence` accepts): this needle,
    // on its own with no confounding prefix, only fails to be found because the line is hidden.
    expect(() => {
      expectPinned(indented, ['A sentence only inside bare indented code.']);
    }).toThrow();
    expect(() => {
      expectAbsent(indented, ['A sentence only inside bare indented code.']);
    }).toThrow();
    expect(() => {
      expectLines(indented, ['    A sentence only inside bare indented code.']);
    }).not.toThrow();
    expect(indented.text).not.toContain('A sentence only inside bare indented code.');

    const wrappedParagraph = sectionOf(
      [
        '# Heading',
        '',
        'A paragraph that',
        '    wraps with extra indentation, still one paragraph, because it does not follow a blank line.',
        '',
      ].join('\n'),
    );
    expect(() => {
      expectPinned(wrappedParagraph, [
        'A paragraph that wraps with extra indentation, still one paragraph, because it does not follow a blank line.',
      ]);
    }).not.toThrow();
  });

  it('M17 P19 scanLines: a `<div>...</div>` wrapper hides its content from prose exactly as an HTML comment does, including a nested div and one spanning several lines', () => {
    const divved = sectionOf(
      [
        '# Heading',
        '',
        'Visible sentence.',
        '<div>A hidden sentence in a one-line div.</div>',
        '',
        'Another visible sentence. <div>',
        'A multi-line div hides this sentence.',
        '<div>A nested div inside it.</div>',
        '</div>',
        '',
        'After the div.',
        '',
      ].join('\n'),
    );
    expect(() => {
      expectPinned(divved, ['Visible sentence.', 'Another visible sentence.', 'After the div.']);
    }).not.toThrow();
    for (const hidden of [
      'A hidden sentence in a one-line div.',
      'A multi-line div hides this sentence.',
      'A nested div inside it.',
    ]) {
      expect(() => {
        expectPinned(divved, [hidden]);
      }).toThrow();
      expect(() => {
        expectAbsent(divved, [hidden]);
      }).toThrow();
      // Direct, sentence-boundary-independent proof, for the same reason as the tilde-fence test
      // above: none of these three ever reach prose at all, not merely "fail to parse as a sentence".
      expect(divved.text).not.toContain(hidden);
    }
  });

  it('M17 P19 scanLines: a fence always wins over a div, and an open div blocks a fresh indented-code open — the two never misfire into each other', () => {
    const fenceWins = sectionOf(
      [
        '# Heading',
        '',
        '```html',
        '<div>',
        'still fenced, not a div',
        '```',
        '',
        'After.',
        '',
      ].join('\n'),
    );
    expect(() => {
      expectPinned(fenceWins, ['After.']);
    }).not.toThrow();
    expect(() => {
      expectAbsent(fenceWins, ['still fenced, not a div']);
    }).toThrow();

    const divBlocksIndent = sectionOf(
      [
        '# Heading',
        '',
        'Prose. <div>',
        '    looks indented but is inside the div, not a bare code block',
        '</div>',
        '',
        'After.',
        '',
      ].join('\n'),
    );
    expect(() => {
      expectAbsent(divBlocksIndent, [
        'looks indented but is inside the div, not a bare code block',
      ]);
    }).toThrow();
    expect(() => {
      expectLines(divBlocksIndent, [
        '    looks indented but is inside the div, not a bare code block',
      ]);
    }).toThrow();
    expect(() => {
      expectPinned(divBlocksIndent, ['Prose.', 'After.']);
    }).not.toThrow();
  });

  it("M17 P19 pin helpers: expectBlock accepts a table row's own trailing ` | ` as the block's final element, the shape every real table-row block-pin in this piece needs", () => {
    const row = sectionOf(
      [
        '# Heading',
        '',
        '| Command | What it does |',
        '| --- | --- |',
        '| `forge x` | First sentence. Second sentence. |',
        '',
      ].join('\n'),
    );
    expect(() => {
      expectBlock(row, ['| `forge x` | First sentence.', 'Second sentence.', '|']);
    }).not.toThrow();
    expect(() => {
      expectBlock(row, ['| `forge x` | First sentence.', 'Second sentence.']);
    }).toThrow();
  });
});

/**
 * The `(specs/22 M17 P<n>)` naming rule (companion to the M16 one above, same reason: an empty `-t`
 * selection exits 0, so a renamed or mismarked `describe` must be caught by a test, not by convention
 * alone). `n` is bounded 1..25 — `PLAN-M17.md` runs Phase A P1-P21 and outlines Phase B P22-P25.
 */
describe('M17 naming rule (specs/22 M17 P1) (SPEC-QUESTIONS.md Q313) — an empty `-t` selection exits 0, so a renamed describe must be caught by a test, not just by convention', () => {
  const MARKER = /\(specs\/22 M17 P(\d+)\)/;

  function repoTestFiles(): string[] {
    const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    return out
      .split('\0')
      .filter((file) => file.length > 0 && /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file));
  }

  function describeTitlesIn(text: string): string[] {
    const titles: string[] = [];
    const re = /\bdescribe\(\s*(['"])((?:\\.|(?!\1).)*)\1/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) titles.push(m[2]!.replace(/\\(.)/g, '$1'));
    return titles;
  }

  it('every describe title containing "M17", across every test file in the repository, carries (specs/22 M17 P<n>) with n from 1 to 25', () => {
    const violations: string[] = [];
    let sawAny = false;
    for (const file of repoTestFiles()) {
      const text = readFileSync(path.join(repoRoot, file), 'utf8');
      for (const title of describeTitlesIn(text)) {
        if (!title.includes('M17')) continue;
        sawAny = true;
        const found = MARKER.exec(title);
        const n = found ? Number(found[1]) : NaN;
        if (!found || !Number.isInteger(n) || n < 1 || n > 25) {
          violations.push(`${file}: ${JSON.stringify(title)}`);
        }
      }
    }
    expect(
      sawAny,
      'expected to find at least one M17 describe title (this scan found none at all)',
    ).toBe(true);
    expect(
      violations,
      `every M17 describe title must carry (specs/22 M17 P<n>), n in 1..25:\n${violations.join('\n')}`,
    ).toEqual([]);
  });
});
