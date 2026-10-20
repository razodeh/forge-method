/**
 * `commands/dispatch/adopt.ts` — `forge adopt [dir] [--scope <path|module>] [--depth
 * quick|standard|deep] [--no-verify]`, plus its own `--incremental`/`--report` forms (`03` §3.2.1,
 * `17` §17.6, `specs/22` M17 P17): the real CLI entry point for `../adopt.ts`'s own eight-phase
 * brownfield-ingestion pipeline, wired into `bin.ts`'s real dispatch chain for the first time.
 *
 * `SPEC-QUESTIONS.md` Q213 decision 5 found `forge adopt` "wired nowhere in bin.ts," deferred because
 * wiring it needed a product decision on the pipeline's own CARTOGRAPHY/INFERENCE dispatch (see
 * `../adopt.ts`'s own top-of-file doc comment for that decision, revisited and left as-is by this
 * piece) — the rest of the pipeline (SURVEY/INVENTORY/VERIFICATION/RECONSTRUCTION/GAP ANALYSIS/
 * BASELINE/human confirmation) was already real and runnable, only unreachable from the real CLI.
 *
 * `forge baseline show|diff` (`17` §17.6's own command block) is deliberately NOT wired here: `03`
 * gives it no row at all (only `17` does), and this piece's own mandate names only the two verbs `03`
 * and `17` BOTH define (`forge adopt`, `forge spec re-derive`, see `./spec.ts`) — a project can
 * already read `reports/adoption/baseline.json` directly, which `adopt()`/`adoptIncremental()`
 * already write, or use `forge adopt --report`, wired below. Disclosed, not silently dropped.
 *
 * @see specs/03 §3.2.1
 * @see specs/17 §17.6
 * @see specs/22 M17 P17
 * @see SPEC-QUESTIONS.md Q213
 */
import path from 'node:path';

import { EXIT_CODES, ForgeError } from '@forge/core/errors';

import {
  adopt,
  adoptIncremental,
  adoptReport,
  type AdoptContext,
  type AdoptDepth,
  type AdoptOptions,
  type AdoptReportResult,
  type AdoptRunResult,
  type IncrementalReport,
} from '../adopt.ts';
import {
  parseCommandFlags,
  realEnvSnapshot,
  sanitizeDeep,
  type DispatchContext,
} from './shared.ts';

const ADOPT_DEPTHS: ReadonlySet<string> = new Set<AdoptDepth>(['quick', 'standard', 'deep']);

function isAdoptDepth(value: string): value is AdoptDepth {
  return ADOPT_DEPTHS.has(value);
}

/** Every real flag `forge adopt` (in any of its three forms) accepts — a flag not in this set is a
 * real, reported `USR-002` (`parseCommandFlags`' own contract), never silently ignored. */
const ADOPT_FLAGS = {
  '--scope': true,
  '--depth': true,
  '--no-verify': false,
  '--incremental': false,
  '--report': false,
} as const;

function usageError(message: string): number {
  console.error(`forge: ${message}`);
  return EXIT_CODES.usage;
}

/** `forge adopt`'s own real output, sanitized (an adopted project's own file paths, manifests and
 * free text are untrusted, hostile-author-controlled input per `20` §20.5 — the identical
 * `sanitizeDeep` precedent `module`/`kb`/`spec`/`adr`/`diagram` already apply to their own
 * project-authored content). Human-readable mode prints a short summary rather than the full nested
 * shape — the real detail is always available via `--json`. */
function printAdoptResult(result: AdoptRunResult, json: boolean): void {
  const r = sanitizeDeep(result);
  if (json) {
    console.log(JSON.stringify({ v: 1, ...r }));
    return;
  }
  if (r.scopedProposal !== undefined) {
    console.log(
      'forge adopt: this repository is large enough to propose a scoped adoption rather than ' +
        'attempting the whole thing.',
    );
    console.log(r.scopedProposal.reason);
    for (const scope of r.scopedProposal.suggestedScopes) console.log(`  --scope ${scope}`);
    return;
  }
  console.log(
    `forge adopt: survey found ${String(r.survey.survey.manifests.length)} manifest(s), ` +
      `${String(r.survey.survey.size.totalFiles)} file(s).`,
  );
  console.log(
    `  inventory: ${String(r.inventory.publicApiSurface.length)} public API signal(s), ` +
      `${String(r.inventory.dataSurface.length)} data-surface signal(s), ` +
      `${String(r.inventory.dependencyGraph.cycles.length)} dependency cycle(s).`,
  );
  console.log(
    `  cartography: ${String(r.cartography.findings.length)} finding(s), ` +
      `${String(r.cartography.sharedWriteTables.length)} shared-write table(s).`,
  );
  if (r.inference !== undefined) {
    console.log(`  inference: ${String(r.inference.findings.length)} finding(s).`);
  }
  if (r.verification !== undefined) {
    const byOutcome = (outcome: string): number =>
      r.verification?.findings.filter((f) => f.outcome === outcome).length ?? 0;
    console.log(
      `  verification: ${String(byOutcome('pass'))} pass, ${String(byOutcome('fail'))} fail, ` +
        `${String(byOutcome('inconclusive'))} inconclusive.`,
    );
  }
  if (r.gapAnalysis !== undefined) {
    console.log(
      `  gap analysis: ${String(r.gapAnalysis.findings.length)} gap(s) (see reports/adoption/gaps.md).`,
    );
  }
  if (r.confirmation !== undefined) {
    console.log(
      `  human confirmation: ${String(r.confirmation.outcomes.length)} answered, ` +
        `${String(r.confirmation.unresolved.length)} unresolved/deferred, ` +
        `${String(r.confirmation.openQuestionIds.length)} open question(s) recorded.`,
    );
  }
  if (r.baseline !== undefined) {
    console.log(
      `  baseline: ${r.baseline.tag ?? '(no tag)'}` +
        `${r.baseline.commit === undefined ? '' : ` at ${r.baseline.commit}`}, ` +
        `G-Adopt ${r.baseline.gate.passed ? 'passed' : 'not passed'}.`,
    );
  }
  if (r.testAdoption !== undefined) {
    console.log(
      r.testAdoption.outcome === 'staged'
        ? `  test adoption: staged a proposal for layer "${r.testAdoption.layer}" (${r.testAdoption.candidate.reason}); ` +
            'run "forge gate check G-TestAdopt" then "forge test adopt --write" once approved.'
        : `  test adoption: no confident detection (${r.testAdoption.candidate.reason}); ` +
            'run "forge test adopt --agent" to investigate.',
    );
  }
  for (const warning of r.warnings) console.log(`  warning: ${warning}`);
}

function printAdoptReport(report: AdoptReportResult, json: boolean): void {
  const r = sanitizeDeep(report);
  if (json) {
    console.log(JSON.stringify({ v: 1, ...r }));
    return;
  }
  if (r.survey === undefined) {
    console.log('forge adopt --report: no survey report on disk yet — run "forge adopt" first.');
  } else {
    console.log(
      `forge adopt --report: survey found ${String(r.survey.manifests.length)} manifest(s), ` +
        `${String(r.survey.size.totalFiles)} file(s).`,
    );
  }
  console.log(r.gapsReport ?? '(no gap report on disk yet)');
  if (r.baseline !== undefined) {
    console.log(
      `baseline: ${r.baseline.tag ?? '(no tag)'}, G-Adopt ${r.baseline.gate.passed ? 'passed' : 'not passed'}.`,
    );
  }
}

function printIncrementalReport(report: IncrementalReport, json: boolean): void {
  const r = sanitizeDeep(report);
  if (json) {
    console.log(JSON.stringify({ v: 1, ...r }));
    return;
  }
  console.log(
    `forge adopt --incremental: ${String(r.newRoutes.length)} new route(s), ` +
      `${String(r.newComponents.length)} new component(s), ${String(r.newTables.length)} new table(s).`,
  );
  for (const route of r.newRoutes) console.log(`  new route: ${route}`);
  for (const component of r.newComponents) console.log(`  new component: ${component}`);
  for (const table of r.newTables) console.log(`  new table: ${table}`);
  if (r.gapDeltas !== undefined) console.log(`  gap deltas: ${JSON.stringify(r.gapDeltas)}`);
  for (const warning of r.warnings) console.log(`  warning: ${warning}`);
}

/**
 * Dispatches `forge adopt` (every form). `undefined` for every other command.
 *
 * @see specs/22 M17 P17
 */
export async function dispatchAdopt(ctx: DispatchContext): Promise<number | undefined> {
  const [command, ...rest] = ctx.positionals;
  if (command !== 'adopt') return undefined;

  const { values, flags, positionals } = parseCommandFlags(rest, ADOPT_FLAGS);
  const json = ctx.flags.json;
  const depthFlag = values.get('--depth');
  if (depthFlag !== undefined && !isAdoptDepth(depthFlag)) {
    throw new ForgeError('USR-002', { flag: '--depth', value: depthFlag });
  }

  // No `kbRoot`/`owner`/`ask` override: `adopt()`'s own real defaults (`DEFAULT_KB_ROOT`, `'adoption'`,
  // "answer every batched claim 'unknown'") apply, identical to every existing library-level caller —
  // see `../adopt.ts`'s own top-of-file doc comment for why this piece does not build a real
  // interactive terminal confirmation prompt (a separate, disclosed scope decision).
  const adoptCtx: AdoptContext = { paths: ctx.paths, env: realEnvSnapshot() };

  if (flags.has('--report')) {
    if (
      flags.has('--incremental') ||
      flags.has('--scope') ||
      flags.has('--depth') ||
      flags.has('--no-verify') ||
      positionals.length > 0
    ) {
      return usageError(
        '"adopt --report" takes no other flag or argument — it only re-prints the survey/gaps ' +
          'already on disk.',
      );
    }
    printAdoptReport(await adoptReport(adoptCtx), json);
    return EXIT_CODES.success;
  }

  if (flags.has('--incremental')) {
    if (flags.has('--scope') || flags.has('--depth')) {
      return usageError('"adopt --incremental" does not take --scope or --depth.');
    }
    if (positionals.length > 1) {
      return usageError('"adopt --incremental" takes at most one [dir].');
    }
    const dirArg = positionals[0];
    const options: AdoptOptions = {
      ...(dirArg === undefined ? {} : { dir: path.resolve(ctx.projectRoot, dirArg) }),
      noVerify: flags.has('--no-verify'),
      dryRun: ctx.flags.dryRun,
    };
    printIncrementalReport(await adoptIncremental(adoptCtx, options), json);
    return EXIT_CODES.success;
  }

  if (positionals.length > 1) {
    return usageError('"adopt" takes at most one [dir].');
  }
  const dirArg = positionals[0];
  const scope = values.get('--scope');
  const options: AdoptOptions = {
    ...(dirArg === undefined ? {} : { dir: path.resolve(ctx.projectRoot, dirArg) }),
    ...(scope === undefined ? {} : { scope }),
    ...(depthFlag === undefined ? {} : { depth: depthFlag }),
    noVerify: flags.has('--no-verify'),
    // `03` §3.2's global `--dry-run` ("Plan and print; make no writes, spawn no sessions") — a
    // gauntlet critic found this real, already-parsed global flag was never read anywhere downstream,
    // so `forge adopt --dry-run` ran the full real pipeline, including the one-shot BASELINE git tag
    // `17` §17.2 phase 8 never recreates once it exists. See `AdoptOptions.dryRun`'s own doc comment.
    dryRun: ctx.flags.dryRun,
  };
  printAdoptResult(await adopt(adoptCtx, options), json);
  return EXIT_CODES.success;
}
