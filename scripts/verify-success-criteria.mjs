/**
 * `scripts/verify-success-criteria.mjs` -- the real SC1-SC11 evidence pass (`01` §1.8).
 *
 * Runs the real command(s) that constitute each criterion's own literal proof and reports a real,
 * per-criterion PASS/FAIL/DISCLOSED verdict with real command output as evidence -- never "the suite
 * is green" as a stand-in. Definitions and the pure evaluator live in `lib/success-criteria.mjs`
 * (unit-tested directly with an injected fake `exec` in `verify-success-criteria.test.ts`); this file
 * is the thin real-subprocess wrapper, the same split every other check script in this directory uses.
 *
 * Usage:
 *   node scripts/verify-success-criteria.mjs               # full report, all 11 criteria
 *   node scripts/verify-success-criteria.mjs --only SC3,SC7 # a subset, for a fast local check
 *   node scripts/verify-success-criteria.mjs --json <path>  # also write the full report as JSON
 *
 * Exit code: 0 iff no `automated` criterion FAILed. A `DISCLOSED` verdict never fails the run -- it is
 * an honest report of a structural limitation (a live adapter session, a real external repo with a
 * real human maintainer), not a defect this script can fix by running something else.
 *
 * @see specs/01 §1.8
 * @see PLAN-M12.md P9
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluateAll, formatReport, SUCCESS_CRITERIA } from './lib/success-criteria.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Runs one real command as a real subprocess and reports its real ok/exitCode/output — exported so
 * `verify-success-criteria.test.ts` can prove this specific real-subprocess mapping (not just the
 * pure evaluator with an injected fake) correctly turns a real, non-zero-exit command into `ok: false`
 * with the real exit code and real captured output, and a real signal-terminated command into
 * `ok: false, exitCode: null`.
 *
 * @type {(argv: readonly string[]) => { ok: boolean; exitCode: number|null; output: string }}
 */
export function realExec(argv) {
  const [rawCommand, ...args] = argv;
  if (rawCommand === undefined) {
    return { ok: false, exitCode: 1, output: 'realExec: empty argv' };
  }
  const command = rawCommand === 'node' ? process.execPath : rawCommand;
  try {
    const output = execFileSync(command, args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
    return { ok: true, exitCode: 0, output };
  } catch (error) {
    const failure =
      /** @type {{ status?: number|null; signal?: string|null; stdout?: string; stderr?: string }} */ (
        error
      );
    const output = `${failure.stdout ?? ''}${failure.stderr ?? ''}`;
    return {
      ok: false,
      exitCode: failure.signal ? null : (failure.status ?? 1),
      output: failure.signal ? `${output}\n(terminated by signal ${failure.signal})` : output,
    };
  }
}

/** @param {readonly string[]} argv */
function parseArgs(argv) {
  /** @type {Set<string>|null} */
  let only = null;
  /** @type {string|null} */
  let jsonPath = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--only') {
      only = new Set((argv[i + 1] ?? '').split(',').filter(Boolean));
      i += 1;
    } else if (argv[i] === '--json') {
      jsonPath = argv[i + 1] ?? null;
      i += 1;
    }
  }
  return { only, jsonPath };
}

function main() {
  const { only, jsonPath } = parseArgs(process.argv.slice(2));
  const definitions = only
    ? SUCCESS_CRITERIA.filter((definition) => only.has(definition.id))
    : SUCCESS_CRITERIA;

  if (only) {
    const missing = [...only].filter((id) => !SUCCESS_CRITERIA.some((d) => d.id === id));
    if (missing.length > 0) {
      console.error(`Unknown --only id(s): ${missing.join(', ')}`);
      process.exit(2);
    }
  }

  console.log(
    `Verifying ${String(definitions.length)} FORGE v1.0 success criteria (specs/01 §1.8)...\n`,
  );

  const { results, exitCode, failed } = evaluateAll(definitions, realExec);

  console.log(formatReport(results));

  const passCount = results.filter((r) => r.verdict === 'PASS').length;
  const disclosedCount = results.filter((r) => r.verdict === 'DISCLOSED').length;
  console.log(
    `Summary: ${String(passCount)} PASS, ${String(failed.length)} FAIL, ${String(disclosedCount)} DISCLOSED ` +
      `(of ${String(results.length)}).`,
  );
  if (failed.length > 0) {
    console.log(`\nFAILED: ${failed.map((r) => r.id).join(', ')}`);
  }

  if (jsonPath) {
    writeFileSync(jsonPath, JSON.stringify({ results, exitCode }, null, 2));
    console.log(`\nFull evidence written to ${jsonPath}`);
  }

  process.exitCode = exitCode;
}

// Guarded so `realExec` can be imported directly (e.g. by `verify-success-criteria.test.ts`) without
// the whole real SC1-SC11 pass running as an import side effect — only a direct `node
// verify-success-criteria.mjs` invocation runs `main()`.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
