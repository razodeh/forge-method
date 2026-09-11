/**
 * `detectRenderMode` — `04` §4.7's own degradation-mode precedence, made concrete: `NO_COLOR`/
 * `FORCE_COLOR`/`TERM=dumb`/`--ascii`/`--linear`/`COLUMNS`/`LINES`.
 *
 * Pure, takes `process.env`/`process.argv`/a real TTY check as explicit parameters rather than reading
 * them itself — this package's own equivalent of `@forge/adapter-claude-code/auth`'s already-established
 * `probeAuthAvailability` discipline: every ambient fact a caller (the real CLI entry point, or a test)
 * supplies explicitly, so this function is deterministic and testable without process mutation.
 * `isTty` mirrors the real, standard `supports-color`/`chalk` convention this milestone follows rather
 * than reinventing: colour auto-detects from whether output is a real interactive terminal at all,
 * `NO_COLOR` forces it off unconditionally, `FORCE_COLOR` forces it on even when `isTty` is false (the
 * real "I am piping this but still want colour" case), and a dumb terminal cannot render colour
 * regardless of what either variable asks for.
 *
 * @see specs/04 §4.7
 * @see PLAN-M9.md P1
 */
export interface RenderMode {
  readonly color: boolean;
  readonly ascii: boolean;
  readonly linear: boolean;
  readonly columns: number;
  readonly lines: number;
}

/** `80x24` — `04` §4.1's own "Minimum viable terminal" floor, used whenever a real size cannot be
 * determined (no `COLUMNS`/`LINES` set, or a non-numeric/non-positive value present). */
const DEFAULT_COLUMNS = 80;
const DEFAULT_LINES = 24;

/** Requires the *entire* string to be decimal digits before parsing -- `Number.parseInt` alone stops
 * at the first non-digit character rather than rejecting the rest, so a naive `parseInt(value, 10)`
 * silently accepts `"1e10"` as `1` and `"80px"` as `80` instead of falling back to the documented
 * 80x24 floor for anything genuinely non-numeric, a real bug a fresh critic round found and reproduced
 * directly. */
const DIGITS_ONLY = /^[0-9]+$/;

/** No real terminal has ever had anywhere near this many columns/rows -- a bound catches an absurd,
 * digit-only value (`COLUMNS="99999999999999999999"`, a real, if minor, gap a fresh critic round found
 * `DIGITS_ONLY` alone does not reject) without needing to guess at any real terminal's own true upper
 * limit. */
const MAX_REASONABLE_SIZE = 100_000;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || !DIGITS_ONLY.test(value)) return fallback;
  const parsed = Number.parseInt(value, 10);
  return parsed > 0 && parsed <= MAX_REASONABLE_SIZE ? parsed : fallback;
}

export function detectRenderMode(
  env: Readonly<Record<string, string | undefined>>,
  argv: readonly string[],
  isTty: boolean,
): RenderMode {
  const ascii = argv.includes('--ascii') || env['FORGE_ASCII'] === '1';
  const isDumbTerm = env['TERM'] === 'dumb';
  const linear = argv.includes('--linear') || isDumbTerm;

  const color = isDumbTerm
    ? false
    : env['NO_COLOR'] !== undefined
      ? false
      : env['FORCE_COLOR'] !== undefined
        ? true
        : isTty;

  return {
    color,
    ascii,
    linear,
    columns: parsePositiveInt(env['COLUMNS'], DEFAULT_COLUMNS),
    lines: parsePositiveInt(env['LINES'], DEFAULT_LINES),
  };
}
