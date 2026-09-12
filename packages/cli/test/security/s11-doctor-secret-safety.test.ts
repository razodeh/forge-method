/**
 * `20` §20.10 S11 — "`forge doctor`'s own secrets check never leaks a resolved secret value in
 * console text, `--json` output, or any written report file, even when a real secret value is
 * deliberately present in the test environment."
 *
 * **A real premise check first, per this piece's own mandate to re-investigate rather than trust the
 * plan's characterization**: `forge doctor` is not, in fact, a wired CLI subcommand anywhere in this
 * codebase today. `packages/cli/src/bin.ts`'s own top doc comment lists `doctor` explicitly among every
 * command that "exists only as a real, already-tested plain function taking a hand-built
 * `*CommandContext`... no real argv dispatcher existed... before this file" and which this dispatcher
 * deliberately does not wire up — confirmed directly by grepping `packages/cli/src` for a `'doctor'`
 * case/dispatch arm (there is none) and for any `--json`-flag handling or report-file-writing code path
 * for doctor anywhere in this package (there is none either; `runDoctor` today has exactly one real
 * caller, `upgrade/run-upgrade.ts`, which only reads the returned `DoctorReport` object, never renders
 * or writes it anywhere itself).
 *
 * This does not make S11 untestable or the mandate's premise false, though: `DoctorReport` (`{ v, ok,
 * checks: DoctorCheck[] }`, `packages/cli/src/commands/doctor/types.ts`) is a plain, fully-serializable
 * data envelope with no other formatting layer between it and any of the three hypothetical renderings
 * S11 names — there is no separate "console-only" field and no separate "file-only" field for a future
 * renderer to select between. `JSON.stringify(report)` *is* exactly what a `--json` flag or a written
 * report file would emit (there is nothing else in the object to leave out or add), and the
 * concatenation of every check's own `message`/`fix` strings *is* exactly what a plain-text console
 * renderer would print (those are the only two human-readable fields `DoctorCheck` carries — see
 * `types.ts`). So this test exercises the real, whole `DoctorReport` object `runDoctor` produces end to
 * end — including a JSON round-trip through a real temp file to stand in for "a written report file" —
 * rather than fabricating a CLI dispatcher/`--json` flag/report-writer this codebase does not yet have.
 * `SPEC-QUESTIONS.md` has the fuller record of this finding.
 *
 * @see specs/20 §20.10
 * @see specs/03 §3.7
 * @see PLAN-M11.md P12
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
// `*.test.ts` files are exempt from `no-restricted-imports` (see `eslint.config.js`'s own test-files
// override), the identical stance `packages/cli/test/commands/helpers.ts` already relies on for its own
// `tmpdir` import.
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runDoctor } from '../../src/commands/doctor/run-doctor.ts';
import { cleanupAll, createTestProject } from '../commands/doctor/helpers.ts';

/** A real, distinctive secret value — never a placeholder like `"secret"` or `"value"` that could
 * coincidentally already appear somewhere in ordinary report scaffolding (an id, a field name, a
 * `Doctor` word) and produce a false-negative "it wasn't leaked" result for the wrong reason. */
const REAL_SECRET_VALUE = 'sk-adversarial-9f3d2b1c-77aa-4e21-9c0e-forge-s11-real-secret-value';
/** A second, distinct secret this fixture never references from any file at all — proving the check
 * only ever reports on names it actually found a `${secret:...}` reference for, never the full
 * injected `env` object wholesale (a check that accidentally serialized `env` verbatim into a
 * `DoctorCheck` field would leak this too). */
const UNREFERENCED_SECRET_VALUE = 'sk-unreferenced-should-never-appear-anywhere-either';

let tempReportDir: string | undefined;

afterEach(async () => {
  await cleanupAll();
  if (tempReportDir !== undefined) {
    await rm(tempReportDir, { recursive: true, force: true });
    tempReportDir = undefined;
  }
});

/** Every human-readable string `DoctorCheck` can possibly carry — the real, complete content any
 * plain-text console renderer would ever have to print, per this file's own top doc comment. */
function consoleTextFor(report: {
  readonly checks: readonly { message: string; fix?: string }[];
}): string {
  return report.checks.map((c) => `${c.message} ${c.fix ?? ''}`).join('\n');
}

describe('S11 — forge doctor secret safety (adversarial)', () => {
  it('a real, resolved secret value never appears in the report object, its JSON serialization, or a written report file — only its resolution status does', async () => {
    const project = await createTestProject();
    await mkdir(path.join(project.dir, '.forge/checks'), { recursive: true });
    // Two references: one resolvable (API_TOKEN, present in env below), one deliberately not
    // (MISSING_TOKEN) — a real project mixes both, and this test confirms neither ever leaks a value
    // (the second has none to leak, but must still only ever report its *name*, never any decoy value
    // an attacker-controlled file might place instead of a proper `${secret:...}` reference).
    await writeFile(
      path.join(project.dir, '.forge/checks/example.gate.yaml'),
      [
        'id: G-Example',
        'apiToken: ${secret:API_TOKEN}',
        'missing: ${secret:MISSING_TOKEN}',
        // An attacker-controlled file directly embedding what looks like a secret value (not a
        // reference) — checkSecretReferences must never echo *this* back either; it only ever reports
        // on `${secret:NAME}` syntax, never scans for or reports literal-looking content (that is a
        // different, already-real invariant -- I8/`checkNoSecretLiterals` -- not this check's job).
        `decoy: "${REAL_SECRET_VALUE}-but-not-via-secret-syntax"`,
      ].join('\n'),
    );

    const report = await runDoctor({
      paths: project.paths,
      projectRoot: project.dir,
      config: project.config,
      env: {
        API_TOKEN: REAL_SECRET_VALUE,
        UNRELATED_SECRET: UNREFERENCED_SECRET_VALUE,
      },
      processVersion: process.version,
    });

    const secretsCheck = report.checks.find((c) => c.id === 'secret-references');
    expect(secretsCheck).toBeDefined();
    // Real, honest status: one resolved, one genuinely unresolved -- not vacuously "nothing to check."
    expect(secretsCheck?.ok).toBe(false);
    expect(secretsCheck?.message).toContain('MISSING_TOKEN');
    // The check does name the referenced secret it resolved successfully by count, but never by name
    // paired with its value, and the unresolved one only by name.
    expect(secretsCheck?.message).not.toContain('API_TOKEN');

    // 1. The real, whole DoctorReport object itself (what any renderer would consume) -- checked field
    //    by field, not just the one check id, since a leak in an unrelated check (e.g. a check that
    //    dumps `env` for its own diagnostic purposes) would count just as much as one in this check.
    const reportText = JSON.stringify(report);
    expect(reportText).not.toContain(REAL_SECRET_VALUE);
    expect(reportText).not.toContain(UNREFERENCED_SECRET_VALUE);

    // 2. "--json output" -- textually identical to (1) since DoctorReport is the whole contract (see
    //    this file's own top doc comment), asserted again here as its own explicit, named surface.
    const jsonOutput = JSON.stringify(report, null, 2);
    expect(jsonOutput).not.toContain(REAL_SECRET_VALUE);
    expect(jsonOutput).not.toContain(UNREFERENCED_SECRET_VALUE);

    // 3. "any written report file" -- a real file on a real filesystem, round-tripped through a real
    //    write + read, not merely an in-memory string.
    tempReportDir = await mkdtemp(path.join(tmpdir(), 'forge-s11-report-'));
    const reportFilePath = path.join(tempReportDir, 'doctor-report.json');
    await writeFile(reportFilePath, jsonOutput);
    const writtenReportContent = await readFile(reportFilePath, 'utf8');
    expect(writtenReportContent).not.toContain(REAL_SECRET_VALUE);
    expect(writtenReportContent).not.toContain(UNREFERENCED_SECRET_VALUE);

    // 4. "console text" -- the concatenation of every real human-readable field this report carries.
    const consoleText = consoleTextFor(report);
    expect(consoleText).not.toContain(REAL_SECRET_VALUE);
    expect(consoleText).not.toContain(UNREFERENCED_SECRET_VALUE);
    // The literal decoy-with-secret-value written directly into the fixture file above is real file
    // content the check reads (to search for `${secret:...}` syntax within it) but must never
    // reproduce back out through its own report -- the most direct adversarial proof this check
    // actually discards resolved/scanned content rather than ever echoing any of it.
  });

  it('a hostile env genuinely containing many unrelated real-looking secrets never causes any of them to appear in the report, resolved or not', async () => {
    const project = await createTestProject();
    await mkdir(path.join(project.dir, '.forge/checks'), { recursive: true });
    await writeFile(
      path.join(project.dir, '.forge/checks/example.gate.yaml'),
      'id: G-Example\ntoken: ${secret:DB_PASSWORD}\n',
    );

    // A hostile/compromised environment: dozens of real-looking secret values, most entirely
    // unreferenced by any file, one genuinely referenced. A check that stringifies the whole `env`
    // record anywhere (an easy mistake for a "helpful" debug log) would leak every one of these.
    const hostileEnv: Record<string, string> = { DB_PASSWORD: 'super-secret-db-password-value' };
    for (let i = 0; i < 25; i += 1) {
      hostileEnv[`DECOY_SECRET_${String(i)}`] = `decoy-value-${String(i)}-should-never-leak`;
    }

    const report = await runDoctor({
      paths: project.paths,
      projectRoot: project.dir,
      config: project.config,
      env: hostileEnv,
      processVersion: process.version,
    });

    const reportText = JSON.stringify(report);
    expect(reportText).not.toContain('super-secret-db-password-value');
    for (let i = 0; i < 25; i += 1) {
      expect(reportText).not.toContain(`decoy-value-${String(i)}-should-never-leak`);
    }
    const secretsCheck = report.checks.find((c) => c.id === 'secret-references');
    expect(secretsCheck?.ok).toBe(true);
  });
});
