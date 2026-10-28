/**
 * `migrateRun` — `forge migrate run --phase <expand|migrate|contract> [--migration <id>] [--json]`
 * (`03` §3.2.5; #14; `SPEC-QUESTIONS.md` Q213/Q202), real for the first time. Applies every
 * not-yet-applied entry of `docs/forge/kb/data/migrations.yaml` (`09` §9.7 point 4, the `model-data`
 * brief's own shape, read through `../spec/integration-rules.ts`'s `readMigrationEntries`) whose
 * `phase` matches `options.phase`, in the file's own apply order, honouring each entry's
 * `after`/`expands` dependency.
 *
 * **Where the migration script lives (DECISION, `specs/22` M17 P18).** `03` §3.2.5 says this command
 * "runs the migration script or backfill routine the entry's own owning ADR named." Neither
 * `migrations.yaml`'s own schema (`integration-rules.ts`, `PLAN-M13.md` P26, deliberately left
 * untouched by this piece) nor an ADR's front matter (`adr.ts`) carries a machine-readable field for
 * a path — an ADR's body is free prose, and nothing in this codebase parses ADR prose to find a path
 * FORGE then trusts blindly (the opposite of Decision 2's own deterministic-detection stance for test
 * runners). Rather than inventing ADR-prose-parsing, this piece fixes the smallest convention that
 * still lets the ADR "name" the path truthfully by construction, not by agreement: every entry's
 * script is `docs/forge/migrations/<id>.mjs`, `<id>` being exactly the entry's own `migrations.yaml`
 * id (never a path the ADR or the `expand` step is free to choose), run as a plain Node subprocess
 * (`node <path>`, exit 0 = applied cleanly) — the identical "shell out to project-owned code, never
 * import it in-process" convention every other FORGE-run project command already uses
 * (`testCommands.run`, a `translate` command, `09` §9.5). `briefs/plan-migration.md`'s own "how the
 * data migration runs" section and `briefs/migration-expand.md`'s own build-the-script bullet both
 * name this exact path convention (not a prior, independently-chosen one this function would then
 * have to infer) — a critic round confirmed the first draft of this piece built the convention here
 * without yet updating either brief to say so, which would have made the real end-to-end reachability
 * proof (`parity-gate.test.ts`) true only for a fixture that bypassed the real brief text, never for a
 * real architect/backend agent pair following it; both briefs were corrected in the same pass as this
 * fix.
 *
 * **Idempotency, two layers (`12` F-DATA-6).** This function's own ledger
 * (`.forge/migrate/applied.json`) records which entries it has already applied, so a repeat
 * invocation naming the same phase/migration is a genuine no-op for them — the script is never even
 * re-invoked. The scripts themselves are independently required to be idempotent too (`03` §3.2.5
 * parenthetical): the ledger is this project's own record, not a cryptographic guarantee, and a lost
 * or hand-edited ledger must not be able to corrupt data on a re-run.
 *
 * **The multi-instance race (`12` F-DATA-6's own "a decision on the multi-instance race").** A
 * critic round reproduced live, against the real compiled CLI, exactly what that spec line warns
 * against: two concurrent `forge migrate run` invocations, naming different and otherwise unrelated
 * migration ids, each genuinely ran its own script, but a plain read-modify-write of the ledger lost
 * one of the two applications outright — silently, with no `problems` entry and no nonzero exit — and
 * a later invocation then re-ran the lost entry's script a second time. The read-modify-write of the
 * ledger is now serialized across processes by `./lock.ts`'s `acquireMigrateLock`/`releaseMigrateLock`
 * (`.forge/migrate/lock.json`), held for the whole apply loop below: a second invocation waits for the
 * first to finish rather than racing it, then reads the now-updated ledger for real.
 *
 * @see specs/03 §3.2.5
 * @see specs/09 §9.7 point 4
 * @see specs/12 F-DATA-6
 * @see specs/22 M17 P18
 */
import { SYSTEM_CLOCK, type Clock } from '@forge/core';
import { pathExists, readTextFile, writeFileAtomic, type ProjectPaths } from '@forge/core/fs';
import { killGroup } from '@forge/engine/dispatch';
import { execa } from 'execa';

import { acquireMigrateLock, assertMigrateLockStillHeld, releaseMigrateLock } from './lock.ts';
import type { SpecCommandContext } from '../spec.ts';
import {
  readMigrationEntries,
  validateMigrationOrder,
  type MigrationEntry,
} from '../spec/integration-rules.ts';

/** `03` §3.2.5's own three `--phase` values. */
export type MigratePhase = 'expand' | 'migrate' | 'contract';

/** Exported so the CLI dispatch boundary (`bin.ts`) and this module's own tests share one list,
 * rather than each hand-copying the three literals `migrationSchema` (`integration-rules.ts`)
 * already declares. */
export const MIGRATE_PHASES: readonly MigratePhase[] = ['expand', 'migrate', 'contract'];

/** Whether `value` is one of `MIGRATE_PHASES` — the one place that list is read back as a guard. */
export function isMigratePhase(value: string): value is MigratePhase {
  // Sound: widening to `readonly string[]` only relaxes the search array's own element type for
  // `includes`'s sake -- a plain `string` is never falsely reported as a `MigratePhase` this way,
  // since the search still checks `value` against the exact three real literals `MIGRATE_PHASES`
  // holds, unchanged.
  return (MIGRATE_PHASES as readonly string[]).includes(value);
}

/** The fixed, FORGE-owned directory a migration entry's own script lives under (this file's own
 * header doc comment explains why the path is fixed rather than ADR-chosen). Project-relative. */
const SCRIPTS_DIR = 'docs/forge/migrations';

/** The project-relative path of `forge migrate run`'s own idempotency ledger — a FORGE-owned record,
 * the identical `.forge/<subsystem>/...` convention `.forge/parity/captures/` and
 * `.forge/test-adopt/<layer>.proposal.yaml` already establish for similar "this command's own
 * durable state" files. */
const LEDGER_PATH = '.forge/migrate/applied.json';

/** The same real wall-clock ceiling `reporter.ts`'s own `DEFAULT_TEST_RUN_TIMEOUT_MS` documents
 * (`@forge/engine/dispatch`'s own `ENGINE_COMMAND_LIMITS`, not imported directly for the identical
 * "same number, deliberately not the same import, to keep this piece's diff inside its own files"
 * reasoning that constant's doc comment gives) — a runaway migration script is killed rather than
 * hanging a run forever. */
const DEFAULT_SCRIPT_TIMEOUT_MS = 1_200_000;

/** One applied-entry record in the ledger. */
interface LedgerEntry {
  readonly appliedAt: string;
  readonly phase: MigratePhase;
}

/** `.forge/migrate/applied.json`'s own real shape. */
interface Ledger {
  readonly v: 1;
  readonly applied: Readonly<Record<string, LedgerEntry>>;
}

function emptyLedger(): Ledger {
  return { v: 1, applied: {} };
}

function isLedgerEntry(value: unknown): value is LedgerEntry {
  if (typeof value !== 'object' || value === null) return false;
  // Sound: the guard just above already refused every shape but a real, non-null object; every
  // member read below is itself checked before being trusted (the identical pattern this codebase's
  // own `reporter.ts` already establishes for the same unknown-JSON-shape problem).
  const candidate = value as Readonly<Record<string, unknown>>;
  return (
    typeof candidate['appliedAt'] === 'string' &&
    isMigratePhase(typeof candidate['phase'] === 'string' ? candidate['phase'] : '')
  );
}

function isLedger(value: unknown): value is Ledger {
  if (typeof value !== 'object' || value === null) return false;
  // Sound: same reasoning as isLedgerEntry's own identical cast, just above.
  const candidate = value as Readonly<Record<string, unknown>>;
  if (candidate['v'] !== 1) return false;
  const applied = candidate['applied'];
  if (typeof applied !== 'object' || applied === null) return false;
  // Sound: the guard just above already refused every shape but a real, non-null object.
  return Object.values(applied as Readonly<Record<string, unknown>>).every(isLedgerEntry);
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Reads the ledger, tolerating every real failure to read it (missing, unreadable, malformed) by
 * starting from an empty one rather than refusing the whole run: the scripts themselves are required
 * to be independently idempotent (`12` F-DATA-6), so re-attempting an already-applied entry after a
 * lost ledger is safe, merely redundant — a disclosed `problem`, never a silent reset. */
async function readLedger(
  paths: ProjectPaths,
): Promise<{ readonly ledger: Ledger; readonly problem?: string }> {
  const target = paths.resolveWithin(LEDGER_PATH);
  if (!(await pathExists(target))) return { ledger: emptyLedger() };
  try {
    const raw: unknown = JSON.parse(await readTextFile(target));
    if (!isLedger(raw)) {
      return {
        ledger: emptyLedger(),
        problem:
          `${LEDGER_PATH} does not have the expected { v: 1, applied: {...} } shape; treating it ` +
          'as empty. Every migration script is required to be independently idempotent (12 F-DATA-6), ' +
          'so re-attempting an already-applied entry is safe.',
      };
    }
    return { ledger: raw };
  } catch (cause) {
    return {
      ledger: emptyLedger(),
      problem:
        `${LEDGER_PATH} could not be read (${describeCause(cause)}); treating it as empty. Every ` +
        'migration script is required to be independently idempotent (12 F-DATA-6), so re-attempting ' +
        'an already-applied entry is safe.',
    };
  }
}

async function writeLedger(paths: ProjectPaths, ledger: Ledger): Promise<void> {
  await writeFileAtomic(paths.resolveWithin(LEDGER_PATH), `${JSON.stringify(ledger, null, 2)}\n`);
}

function truncate(text: string): string {
  return text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
}

/** Runs one entry's own script as a plain Node subprocess (this file's own header doc comment has
 * the full reasoning for why it is a subprocess, never an in-process `import()`). Exit 0 is the whole
 * contract: a non-zero exit, or outliving `timeoutMs`, is a failure, with enough of the process's own
 * output to diagnose why.
 *
 * Spawned as `execa(process.execPath, [scriptPath], ...)` — a real argv array, never a shell string
 * (`02` §2.7 makes Windows first-class). This is always exactly "run node on this one path," with no
 * shell feature (`&&`, `$VAR`, a glob) it ever genuinely needs, so there is no reason to involve a
 * shell at all — and so no POSIX-vs-cmd.exe quoting dialect for `scriptPath` to get wrong in the
 * first place. A prior version built `node ${shellQuote(scriptPath)}` (POSIX single-quoting) and ran
 * it through `@forge/engine/dispatch`'s `runShellCommand` with `env` always `undefined` — the one
 * shape that keeps `shell: true` (cmd.exe on Windows) rather than ever consulting
 * `resolvePosixShell`, since that function has no real `PATH` to search without a concrete `env`
 * (`shell.ts`'s own doc comment). cmd.exe does not treat `'...'` as a quoted argument at all, so
 * `node` would have received one literal argument containing apostrophes and failed to find the
 * module — every real `forge migrate run` invocation would have failed on Windows. The argv form
 * sidesteps the whole dialect question instead of needing to pick one: Node's own child-process layer
 * escapes each array element for the OS's real argv convention (a POSIX `exec`, or Windows
 * `CreateProcess`'s own command-line quoting) regardless of platform, with no shell in between to
 * (mis)interpret it a second time.
 *
 * The timeout kill reuses `@forge/engine/dispatch`'s own exported `killGroup` verbatim — the real,
 * already-fixed "kill the whole process group AND walk every real `ps`-reported descendant
 * individually" logic (`specs/22` M16 P10, `SPEC-QUESTIONS.md` Q296 Decisions 1/5), the IDENTICAL
 * primitive `runShellCommand`/`runConfinedCommand` already use and `commands/parity/http-server.ts`
 * already reuses this same way for the identical reason (see that module's own "Why this is not
 * runConfinedCommand" doc comment). A migration script is arbitrary Node code a project owns, not
 * code this codebase controls the shape of — a dependency that daemonizes, or forks a worker that
 * calls `setsid(2)` (Node's own `detached: true`), is an ordinary thing a real script can do, not a
 * script bug this caller is entitled to assume away. The group kill alone (`process.kill(-pid, ...)`)
 * does not reach such a descendant, which immediately leaves the group on its own `setsid()` call
 * (`killGroup`'s own doc comment has the full, confirmed repro) — `listDescendantPids`'s real `ps`
 * walk is what actually finds and kills it, individually, whether or not it is still a group member.
 * A second, independently-written, narrower copy of this exact logic is exactly the "two places this
 * can drift" shape this codebase avoids elsewhere, so this reuses the export rather than reimplementing
 * a weaker version of it. */
async function runMigrationScript(
  scriptPath: string,
  cwd: string,
  timeoutMs: number,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }> {
  const subprocess = execa(process.execPath, [scriptPath], {
    cwd,
    reject: false,
    stdin: 'ignore',
    // Its own process group (POSIX), so `killGroup` can end everything the script started, not only
    // the script's own direct process — see that function's own doc comment.
    detached: process.platform !== 'win32',
  });
  const state = { timedOut: false };
  const timer = setTimeout(() => {
    state.timedOut = true;
    killGroup(subprocess);
  }, timeoutMs);
  let result;
  try {
    result = await subprocess;
  } finally {
    clearTimeout(timer);
  }
  if (state.timedOut) {
    return { ok: false, message: `script timed out after ${String(timeoutMs)}ms and was killed` };
  }
  // `?? 1`: a process execa reports with no numeric exit code at all (killed by a signal this
  // function did not itself request, e.g. the `timedOut` branch above already returned) is still a
  // real failure, never printed as the literal text "undefined" — the identical fallback `shell.ts`'s
  // own `runShellCommand` already applies to every other command this codebase runs.
  const exitCode = result.exitCode ?? 1;
  if (exitCode !== 0) {
    const detail = result.stderr.trim() !== '' ? result.stderr.trim() : result.stdout.trim();
    return {
      ok: false,
      message: `script exited ${String(exitCode)}${detail === '' ? '' : `: ${truncate(detail)}`}`,
    };
  }
  return { ok: true };
}

/** `forge migrate run`'s own options, already validated at the CLI dispatch boundary (`bin.ts`):
 * `phase` is one of `MIGRATE_PHASES`, and `migration`, when given, is checked against the real
 * `migrations.yaml` entries by `migrateRun` itself (a `USR-006` usage error if it names no entry of
 * `phase`) before anything is applied. */
export interface MigrateRunOptions {
  readonly phase: MigratePhase;
  readonly migration?: string;
}

/** `forge migrate run`'s own result — the library half of the `{"v":1,"phase":...}` envelope `03`
 * §3.2.5 prints, the same `errors`/`problems` convention `forge test run`'s envelope already uses
 * (`09` §9.5, `loop/test/run.ts`'s `TestRunResult`). `applied` lists only the ids THIS invocation
 * applied (never one already applied by an earlier call) — empty, with `failed: 0, errors: 0`, is a
 * genuine, reportable no-op, not an absence of information. `errors` counts a file-level problem
 * (`migrations.yaml` missing, malformed, or order-inconsistent) that stopped the run before any entry
 * was attempted; `failed` counts an entry that WAS attempted and did not apply cleanly (an unmet
 * dependency, a missing script, a script that failed or timed out). */
export interface MigrateRunResult {
  readonly phase: MigratePhase;
  readonly applied: readonly string[];
  readonly failed: number;
  readonly errors: number;
  readonly problems?: readonly string[];
}

/** A usage-error signal `migrateRun` raises by returning it rather than throwing: `bin.ts`'s own
 * dispatch is what turns an unresolvable `--migration <id>` into a thrown `ForgeError('USR-006', ...)`
 * (exit 2) — this function stays a plain, throw-free library call like every other command's own
 * `<verb>Run` core (`loop/test/run.ts`'s `testRun`), so a caller that is not the CLI (a future gate
 * check, a test) can read the same signal as data. */
export type MigrateRunOutcome =
  | { readonly kind: 'ok'; readonly result: MigrateRunResult }
  | { readonly kind: 'unknown-migration' };

function dependenciesOf(entry: MigrationEntry): readonly string[] {
  return entry.expands === undefined
    ? (entry.after ?? [])
    : [...(entry.after ?? []), entry.expands];
}

/**
 * The real `forge migrate run` library call. `ctx.paths`/`ctx.kbRoot` locate `migrations.yaml`;
 * `projectRoot` is where each entry's own script actually runs (its own `cwd`, matching every other
 * project-owned command this codebase shells out to). `clock` defaults to the real wall clock
 * (`QUALITY-BAR.md` R10); a test injects its own. `scriptTimeoutMs`/`lockWaitMs` default to
 * `DEFAULT_SCRIPT_TIMEOUT_MS`/`./lock.ts`'s own default and are not reachable from the CLI (`bin.ts`
 * never passes either) — their only real caller is this function's own test suite, proving a
 * runaway script is genuinely killed, and a genuinely exhausted lock wait genuinely refuses, rather
 * than either hanging the command forever, without waiting out either real, generous default to do
 * it.
 *
 * `.forge/migrate/lock.json` (`./lock.ts`) is held from immediately before the ledger is first read
 * until immediately after the apply loop's last write, so the whole read-modify-write this
 * invocation performs is serialized against any other real, concurrent `forge migrate run` process
 * (this file's own header doc comment has the critic-reproduced defect this closes). The three
 * file-level refusals above (`migrations.yaml` invalid, an unresolvable `--migration`, an
 * order-inconsistent file) never touch the ledger at all and are deliberately outside the lock, so a
 * pure validation failure never waits on an unrelated holder.
 *
 * @see specs/03 §3.2.5
 * @see specs/12 F-DATA-6
 * @see specs/22 M17 P18
 */
export async function migrateRun(
  ctx: SpecCommandContext,
  projectRoot: string,
  options: MigrateRunOptions,
  clock: Clock = SYSTEM_CLOCK,
  scriptTimeoutMs: number = DEFAULT_SCRIPT_TIMEOUT_MS,
  lockWaitMs?: number,
): Promise<MigrateRunOutcome> {
  const { phase } = options;
  const read = await readMigrationEntries(ctx);
  if (read.kind === 'invalid') {
    return {
      kind: 'ok',
      result: {
        phase,
        applied: [],
        failed: 0,
        errors: 1,
        problems: read.violations.map((violation) => violation.message),
      },
    };
  }
  const { migrations } = read;

  if (options.migration !== undefined) {
    const named = migrations.find((entry) => entry.id === options.migration);
    if (named?.phase !== phase) {
      return { kind: 'unknown-migration' };
    }
  }

  const order = await validateMigrationOrder(ctx);
  if (order.violations.length > 0) {
    return {
      kind: 'ok',
      result: {
        phase,
        applied: [],
        failed: 0,
        errors: 1,
        problems: order.violations.map((violation) => violation.message),
      },
    };
  }

  const targets =
    options.migration === undefined
      ? migrations.filter((entry) => entry.phase === phase)
      : migrations.filter((entry) => entry.id === options.migration);

  // From here on this invocation reads and writes the shared ledger: held for the whole apply loop,
  // never released between entries, so no other real `forge migrate run` process can observe or
  // write a half-updated ledger (this file's own header doc comment has the full reasoning).
  await acquireMigrateLock(ctx.paths, clock, lockWaitMs);
  try {
    const { ledger: initialLedger, problem: ledgerProblem } = await readLedger(ctx.paths);
    const problems: string[] = ledgerProblem === undefined ? [] : [ledgerProblem];
    const applied: string[] = [];
    let failed = 0;
    let ledger = initialLedger;

    for (const entry of targets) {
      if (ledger.applied[entry.id] !== undefined) continue; // already applied: a genuine no-op.

      const unmet = dependenciesOf(entry).filter((dep) => ledger.applied[dep] === undefined);
      if (unmet.length > 0) {
        failed += 1;
        problems.push(
          `${entry.id}: cannot apply -- depends on ${unmet.join(', ')}, not yet applied. Run ` +
            `forge migrate run for the phase(s) that apply ${unmet.join(', ')} first.`,
        );
        continue;
      }

      const scriptRelativePath = `${SCRIPTS_DIR}/${entry.id}.mjs`;
      const scriptPath = ctx.paths.resolveWithin(scriptRelativePath);
      if (!(await pathExists(scriptPath))) {
        failed += 1;
        problems.push(
          `${entry.id}: migration script not found at ${scriptRelativePath}. The expand/contract ` +
            'workflow step that builds it (per the migration plan ADR) must run before forge ' +
            'migrate run can apply this entry.',
        );
        continue;
      }

      const ran = await runMigrationScript(scriptPath, projectRoot, scriptTimeoutMs);
      if (!ran.ok) {
        failed += 1;
        problems.push(`${entry.id}: ${ran.message}`);
        continue;
      }

      ledger = {
        v: 1,
        applied: {
          ...ledger.applied,
          [entry.id]: { appliedAt: clock.now(), phase: entry.phase },
        },
      };
      // Write-time fencing (see `assertMigrateLockStillHeld`'s own doc comment, `./lock.ts`):
      // re-confirm, immediately before this commits, that this process still, genuinely, holds the
      // lock -- checked on EVERY iteration (the lock is held across this whole loop, potentially
      // many slow real script runs), not merely once before the loop starts. A lost fence here means
      // another process now provably holds this lock; this invocation must not write a ledger entry
      // it can no longer prove exclusive ownership of, even though the migration script itself
      // already ran and genuinely succeeded -- surfaced as a loud `RUN-157` failure rather than a
      // silent, unrecorded success, which is strictly safer than this file's own pre-fix behavior
      // (a silently lost ledger entry and a later re-run of the same script).
      await assertMigrateLockStillHeld(ctx.paths);
      await writeLedger(ctx.paths, ledger);
      applied.push(entry.id);
    }

    return {
      kind: 'ok',
      result: {
        phase,
        applied,
        failed,
        errors: 0,
        ...(problems.length > 0 ? { problems } : {}),
      },
    };
  } finally {
    await releaseMigrateLock(ctx.paths);
  }
}
