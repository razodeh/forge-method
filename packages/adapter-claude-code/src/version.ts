/**
 * `probeCliVersion` — `07` §7.3's own normative mandate: "Do not rely on the presence of any specific
 * CLI flag without probing: `preflight()` MUST run `claude --version`, parse it, and compare against a
 * `minimumVersion` constant; unknown/older versions degrade capabilities rather than crashing."
 *
 * @see specs/07 §7.3
 * @see SPEC-QUESTIONS.md Q113
 * @see PLAN-M7.md P1
 */
import { realClaudeCliRunner, type ClaudeCliRunner } from './process.ts';

/**
 * No exact minimum is given anywhere in the spec pack. Chosen as the largest round major-version floor
 * beneath the real version this milestone was built and probed against (`2.1.266`, confirmed live in
 * this environment) — the actual criterion the spec cares about (real support for `--bare`,
 * `--output-format stream-json --verbose --include-partial-messages`, `--permission-mode`,
 * `--resume`) is a real compatibility question this milestone has no historical changelog access to
 * answer precisely, so a conservative full-major floor is the honest choice rather than a fabricated
 * precise cutoff. Recorded in `SPEC-QUESTIONS.md` Q113; revisit if a real older-CLI incompatibility is
 * ever found.
 */
export const MINIMUM_CLAUDE_CLI_VERSION = '2.0.0';

export interface CliVersionProbe {
  readonly ok: boolean;
  /** Present whenever a version string was successfully parsed, even one below the minimum — so a
   * caller building a precise remedy message (`preflight`, P4) can name the real version found. */
  readonly version?: string;
}

const VERSION_PATTERN = /(\d+)\.(\d+)\.(\d+)/;

function parseVersionParts(version: string): readonly [number, number, number] | undefined {
  const match = VERSION_PATTERN.exec(version);
  if (match === null) return undefined;
  const [, major, minor, patch] = match;
  return [Number(major), Number(minor), Number(patch)];
}

/** `1` when `a` is newer than `b`, `-1` when older, `0` when equal — three-part dotted versions only
 * (every real Claude Code CLI version observed is this shape); no dependency on a full semver range
 * parser for a comparison this simple. Destructured rather than indexed in a loop: a fixed 3-tuple
 * has exactly three components to compare, each a plain named value, not an indexed access this
 * project's own `noUncheckedIndexedAccess` setting would otherwise widen to `number | undefined`. */
function compareVersions(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  const [aMajor, aMinor, aPatch] = a;
  const [bMajor, bMinor, bPatch] = b;
  if (aMajor !== bMajor) return aMajor > bMajor ? 1 : -1;
  if (aMinor !== bMinor) return aMinor > bMinor ? 1 : -1;
  if (aPatch !== bPatch) return aPatch > bPatch ? 1 : -1;
  return 0;
}

/**
 * Runs `claude --version` and compares the parsed version against `MINIMUM_CLAUDE_CLI_VERSION`. Never
 * throws: a missing binary, a non-zero exit, or unparseable output all resolve to `{ ok: false }`
 * (with `version` present when parsing at least succeeded) — `preflight` (P4) is what turns this into
 * a real, typed `PreflightIssue`; this function's own job is only the probe.
 */
export async function probeCliVersion(
  env: Readonly<Record<string, string>>,
  runner: ClaudeCliRunner = realClaudeCliRunner,
): Promise<CliVersionProbe> {
  const result = await runner(['--version'], env);
  if (result.exitCode !== 0) return { ok: false };

  const match = VERSION_PATTERN.exec(result.stdout);
  if (match === null) return { ok: false };
  const version = match[0];
  const parsed = parseVersionParts(version);
  const minimum = parseVersionParts(MINIMUM_CLAUDE_CLI_VERSION);
  if (parsed === undefined || minimum === undefined) return { ok: false, version };
  return { ok: compareVersions(parsed, minimum) >= 0, version };
}
