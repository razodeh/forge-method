/**
 * `forge spec validate --rule slo-observability-coverage` and `--rule runbook-coverage`: the two deterministic
 * checks `G-Operate` names (`10` §10.3: "No dashboards/alerts for stage SLOs; runbook missing for each Sev1 failure
 * mode", `14` §14.7 items 3 and 4), added by `PLAN-M13.md` P26 (Q228).
 *
 * **What the specs and briefs define, and what is read.** `14` §14.5 derives SLOs "from the `NFR-###` set", and the
 * `define-slos` brief writes each SLO as an `NFR` whose `verification` is `kind: monitor` with `ref` the id of the
 * alert or dashboard that evaluates it (`ALERT-<slug>` / `DASH-<slug>`, from the observability plan or a planned item in
 * the SLO's own body), and whose body states the burn-rate alert policy. The `write-runbooks` brief writes one `Runbook`
 * per Sev1 failure mode, titled with the failure mode "worded as it is in its source", and each runbook's `symptoms`
 * names the alert by that same id. The failure modes themselves are recorded per component in
 * `architecture/components.md` (`failureModes`, `08` §8.2). These rules read exactly those documents: the NFRs under the
 * specs root, the KB tree (components, runbooks, `ops/` entries) and the reports root's `handoffs.md` (where the
 * observability plan lives). No clock, no network, no model; output is sorted.
 *
 * **`slo-observability-coverage`.** Every SLO (an NFR with `verification.kind: monitor`, not `deprecated`/`superseded`)
 * must name a monitor id of that shape; that id must be defined somewhere a reader can find it (the SLO's own body, an
 * `ops/` KB entry, or the observability plan in `handoffs.md`; the front matter of the SLO itself does not count, it is
 * the reference); and the SLO's body must state a burn-rate policy (`14` §14.5: alerts fire on error-budget burn rate).
 * A project with no SLO fails: the gate's condition is "no dashboards/alerts for stage SLOs" and an empty set shows none.
 *
 * **`runbook-coverage`.** Every identified failure mode has a usable runbook, and every SLO alert has one that names it.
 * Identified failure modes are every `failureModes` entry of every component (the inventory records no severity per
 * mode, so every mode is read as Sev1: the conservative reading, cleared by a runbook or a Waiver) and every alert an
 * SLO names. A runbook is usable when it is schema-valid, not `deprecated`/`retired`/`superseded`/`archived`, carries no
 * unfilled template placeholder, and has at least one diagnosis step. A mode is covered when a usable runbook's title
 * says it (case, punctuation and spacing ignored; either text may contain the other). A project with nothing
 * identified fails: no mode and no alert means the failure analysis has not been done, not that nothing can fail.
 *
 * **Not judged** (the advisory `critique-operational-readiness` review's): whether the mode list is complete, whether a
 * runbook's commands exist, whether an alert is actionable, whether a burn-rate policy is sound. `stages.md`'s per-stage
 * `nfr_subset` is not read (its shape is not a schema), so every SLO in the project counts.
 *
 * @see specs/10 §10.3
 * @see specs/14 §14.5, §14.7
 * @see PLAN-M13.md P26
 */
import { readTextFile, pathExists } from '@forge/core/fs';
import { parseKbTree, type KbTree } from '@forge/kb/schema';
import type { Runbook } from '@forge/schemas';

import type { SpecCommandContext } from '../spec.ts';
import { compare, errorMessage, oneLine, readSpecDocuments } from './spec-files.ts';
import type { RuleValidationResult, RuleViolation, ValidateRuleId } from './validate-rules.ts';

type OpsRuleId = Extract<ValidateRuleId, 'slo-observability-coverage' | 'runbook-coverage'>;

const DEFAULT_REPORTS_ROOT = 'docs/forge/reports';
const HANDOFFS_FILE = 'handoffs.md';
/** `ALERT-<slug>` or `DASH-<slug>` (`instrument-observability` brief). */
const MONITOR_ID = /^(?:ALERT|DASH)-[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const RETIRED_STATUSES = new Set(['deprecated', 'retired', 'superseded', 'archived', 'rejected']);
const BURN_RATE = /burn[\s-]*rate/i;
/** An unfilled shipped-template placeholder such as `<the failure mode this runbook covers>`. */
const PLACEHOLDER = /^<[^>]*>$/s;
/** A text of fewer words than this cannot be told apart from an unrelated title by containment ("Database" would
 * cover every database failure); a whole-word match of at least this many words is a title that says the mode. */
const MIN_CONTAINED_WORDS = 2;
/** A field that is only a stand-in for an answer. */
const STAND_IN = /^(?:todo|tbd|fixme|n\/a|none|unknown|\.\.\.|-)$/i;

function violation(subject: string, message: string, remedy: string): RuleViolation {
  return { subject, message, remedy };
}

function result(rule: OpsRuleId, violations: readonly RuleViolation[]): RuleValidationResult {
  return {
    rule,
    violations: [...violations].sort(
      (a, b) => compare(a.subject, b.subject) || compare(a.message, b.message),
    ),
  };
}

/** A whole-token match: `ALERT-api-5xx` does not match inside `ALERT-api-5xx-fast`. */
function mentions(text: string, id: string): boolean {
  let from = 0;
  for (;;) {
    const at = text.indexOf(id, from);
    if (at === -1) return false;
    const before = at === 0 ? '' : (text[at - 1] ?? '');
    const after = text[at + id.length] ?? '';
    if (!/[A-Za-z0-9_-]/.test(before) && !/[A-Za-z0-9_-]/.test(after)) return true;
    from = at + 1;
  }
}

interface Slo {
  readonly id: string;
  readonly path: string;
  readonly monitor: string | undefined;
  readonly body: string;
}

interface OpsInputs {
  readonly slos: readonly Slo[];
  readonly tree: KbTree;
  readonly handoffs: string;
  /** Anything that stopped an input being read: reported by both rules, never skipped. */
  readonly unreadable: readonly RuleViolation[];
}

async function loadInputs(ctx: SpecCommandContext): Promise<OpsInputs> {
  const unreadable: RuleViolation[] = [];
  const specs = await readSpecDocuments(ctx, ctx.specsRoot, 'the SLOs', 'interfaces');
  unreadable.push(...specs.unreadable);

  const slos: Slo[] = [];
  for (const doc of specs.docs) {
    const fm = doc.frontMatter as Record<string, unknown>;
    if (fm['type'] !== 'NFR') continue;
    const verification = fm['verification'];
    if (
      typeof verification !== 'object' ||
      verification === null ||
      Array.isArray(verification) ||
      (verification as Record<string, unknown>)['kind'] !== 'monitor'
    ) {
      continue;
    }
    if (typeof fm['status'] === 'string' && RETIRED_STATUSES.has(fm['status'])) continue;
    const ref = (verification as Record<string, unknown>)['ref'];
    slos.push({
      id: typeof fm['id'] === 'string' ? oneLine(fm['id'], 60) : doc.path,
      path: doc.path,
      monitor: typeof ref === 'string' && MONITOR_ID.test(ref.trim()) ? ref.trim() : undefined,
      body: doc.body,
    });
  }

  const tree = await parseKbTree(ctx.paths, ctx.kbRoot);
  // A file that failed its schema is missing from what the rules can count. Only the ones that could hold a runbook,
  // the component inventory or an observability plan matter here; an unrelated ADR is not this check's to fail on.
  const relevant = (path: string): boolean =>
    path === ctx.kbRoot || path.startsWith('ops/') || path === 'architecture/components.md';
  for (const error of tree.errors.filter((candidate) => relevant(candidate.path))) {
    unreadable.push(
      violation(
        error.path,
        `${error.path} could not be read (${oneLine(error.message)}), so what it defines cannot be counted.`,
        `Repair ${error.path}, then run the check again.`,
      ),
    );
  }

  let handoffs = '';
  const handoffsPath = `${ctx.reportsRoot ?? DEFAULT_REPORTS_ROOT}/${HANDOFFS_FILE}`;
  try {
    if (await pathExists(ctx.paths.resolveWithin(handoffsPath))) {
      handoffs = await readTextFile(ctx.paths.resolveWithin(handoffsPath));
    }
  } catch (cause) {
    unreadable.push(
      violation(
        handoffsPath,
        `${handoffsPath} could not be read (${oneLine(errorMessage(cause))}), so the observability plan cannot be searched.`,
        `Repair ${handoffsPath}, then run the check again.`,
      ),
    );
  }
  return { slos: slos.sort((a, b) => compare(a.id, b.id)), tree, handoffs, unreadable };
}

// --- slo-observability-coverage -------------------------------------------------------------------------

const REMEDY_SLO =
  'Run the define-slos step for the stage (an SLO is an NFR whose verification is kind: monitor with the id of its alert or dashboard), then run the check again.';

export async function validateSloObservabilityCoverage(
  ctx: SpecCommandContext,
): Promise<RuleValidationResult> {
  const rule: OpsRuleId = 'slo-observability-coverage';
  try {
    const inputs = await loadInputs(ctx);
    const violations: RuleViolation[] = [...inputs.unreadable];
    if (inputs.slos.length === 0) {
      violations.push(
        violation(
          'nfr',
          'No SLO is declared: no NFR has verification.kind "monitor", so no dashboard or alert is shown for any stage SLO.',
          REMEDY_SLO,
        ),
      );
    }
    const planned = [
      inputs.handoffs,
      ...inputs.tree.entries.flatMap((entry) =>
        entry.kind === 'kb-entry' && entry.path.startsWith('ops/') ? [entry.value.body] : [],
      ),
    ];
    for (const slo of inputs.slos) {
      if (slo.monitor === undefined) {
        violations.push(
          violation(
            slo.id,
            `${slo.id}: verification.ref does not name a dashboard or alert (expected an ALERT-<slug> or DASH-<slug> id).`,
            `Set verification.ref in ${slo.path} to the id of the alert or dashboard that evaluates this SLO.`,
          ),
        );
      } else if (
        !planned.some((text) => mentions(text, slo.monitor ?? '')) &&
        !mentions(slo.body, slo.monitor)
      ) {
        violations.push(
          violation(
            slo.id,
            `${slo.id}: ${slo.monitor} is not defined anywhere: it does not appear in the SLO's body, in an ops/ KB entry or in the observability plan.`,
            `Add ${slo.monitor} to the observability plan (the instrument-observability step) or describe it as a planned item, with its expression and window, in the body of ${slo.path}.`,
          ),
        );
      }
      if (!BURN_RATE.test(slo.body)) {
        violations.push(
          violation(
            slo.id,
            `${slo.id}: the body does not state a burn-rate alert policy (alerts fire on error-budget burn rate, not a raw threshold).`,
            `State the burn-rate policy (fast and slow windows, what pages and what only opens a ticket) in the body of ${slo.path}.`,
          ),
        );
      }
    }
    return result(rule, violations);
  } catch (cause) {
    return result(rule, [
      violation(
        rule,
        `The check could not run: ${oneLine(errorMessage(cause))}.`,
        'Fix what the message names, then run the check again.',
      ),
    ]);
  }
}

// --- runbook-coverage -----------------------------------------------------------------------------------

function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function coversMode(title: string, mode: string): boolean {
  const a = normalise(title);
  const b = normalise(mode);
  if (a === '' || b === '') return false;
  if (a === b) return true;
  const words = (text: string): number => text.split(' ').length;
  // Whole-word containment: the shorter text sits between word boundaries of the longer one.
  const within = (inner: string, outer: string): boolean =>
    words(inner) >= MIN_CONTAINED_WORDS && ` ${outer} `.includes(` ${inner} `);
  return within(a, b) || within(b, a);
}

function blank(value: string): boolean {
  return value.trim() === '' || PLACEHOLDER.test(value.trim()) || STAND_IN.test(value.trim());
}

/** Why a runbook does not count, or `undefined` when it does. */
function unusable(runbook: Runbook): string | undefined {
  if (RETIRED_STATUSES.has(runbook.status)) return `its status is "${runbook.status}"`;
  for (const field of ['title', 'symptoms', 'immediate_mitigation', 'escalation'] as const) {
    if (blank(runbook[field])) return `${field} is empty or an unfilled template placeholder`;
  }
  if (runbook.diagnosis_steps.length === 0) return 'it has no diagnosis steps';
  if (runbook.diagnosis_steps.some(blank)) return 'a diagnosis step is empty or a placeholder';
  return undefined;
}

const REMEDY_RUNBOOK =
  'Write the runbook (the write-runbooks step): kb/ops/runbooks/RUN-###-<slug>.md titled with the failure mode, with symptoms, immediate mitigation, diagnosis steps, escalation and post-incident actions filled in.';

export async function validateRunbookCoverage(
  ctx: SpecCommandContext,
): Promise<RuleValidationResult> {
  const rule: OpsRuleId = 'runbook-coverage';
  try {
    const inputs = await loadInputs(ctx);
    const violations: RuleViolation[] = [...inputs.unreadable];

    const runbooks = inputs.tree.entries.flatMap((entry) =>
      entry.kind === 'runbook' ? [entry.value] : [],
    );
    const usable: Runbook[] = [];
    const rejected: { readonly runbook: Runbook; readonly problem: string }[] = [];
    for (const runbook of runbooks) {
      const problem = unusable(runbook);
      if (problem === undefined) usable.push(runbook);
      else rejected.push({ runbook, problem });
    }
    /** Names a runbook that looks like the one wanted but does not count, so the fix is obvious. */
    const nearMiss = (covers: (runbook: Runbook) => boolean): string => {
      const found = rejected.find(({ runbook }) => covers(runbook));
      return found === undefined
        ? ''
        : ` ${found.runbook.id} looks like it but does not count: ${found.problem}.`;
    };

    const modes: { readonly subject: string; readonly mode: string }[] = [];
    for (const entry of inputs.tree.entries) {
      if (entry.kind !== 'components-file') continue;
      for (const component of entry.value.components) {
        for (const mode of component.failureModes) modes.push({ subject: component.id, mode });
      }
    }
    const alerts = inputs.slos.flatMap((slo) =>
      slo.monitor?.startsWith('ALERT-') === true ? [{ slo: slo.id, alert: slo.monitor }] : [],
    );

    if (modes.length === 0 && alerts.length === 0) {
      violations.push(
        violation(
          'failure-modes',
          'No failure mode is identified (no component lists failureModes and no SLO names an alert), so no runbook coverage can be shown.',
          "Record each component's failure modes in kb/architecture/components.md and define the stage SLOs, then write a runbook for each.",
        ),
      );
    }
    for (const { subject, mode } of modes) {
      if (!usable.some((runbook) => coversMode(runbook.title, mode))) {
        violations.push(
          violation(
            `${subject}: ${oneLine(mode, 80)}`,
            `${subject}'s failure mode "${oneLine(mode, 80)}" has no runbook: no usable runbook is titled with it.${nearMiss((runbook) => coversMode(runbook.title, mode))}`,
            REMEDY_RUNBOOK,
          ),
        );
      }
    }
    for (const { slo, alert } of alerts) {
      if (!usable.some((runbook) => mentions(runbook.symptoms, alert))) {
        violations.push(
          violation(
            `${slo}: ${alert}`,
            `${slo}'s alert ${alert} links no runbook: no usable runbook's symptoms name it.${nearMiss((runbook) => mentions(runbook.symptoms, alert))}`,
            `Write or update the runbook for this alert's failure mode so its symptoms name ${alert} (an alert with no runbook is deleted or downgraded, 14 section 14.5).`,
          ),
        );
      }
    }
    return result(rule, violations);
  } catch (cause) {
    return result(rule, [
      violation(
        rule,
        `The check could not run: ${oneLine(errorMessage(cause))}.`,
        'Fix what the message names, then run the check again.',
      ),
    ]);
  }
}
