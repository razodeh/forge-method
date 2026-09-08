/**
 * `parseGlobalFlags` — every row of `03` §3.2's global-flags table, parsed once and shared by every
 * command. Deliberately hand-written rather than pulled from a CLI-argument library: the set is
 * small, fixed, and shared by every command regardless of that command's own argument shape, which
 * a later `@forge/cli` piece defines — this function only ever consumes the flags it recognises and
 * leaves everything else in `positionals`.
 *
 * @see specs/03 §3.2
 */
import { ForgeError } from '@forge/core/errors';

import type { AutonomyLevel, GlobalFlags, ModelTier } from './types.ts';

const MODEL_TIERS: readonly ModelTier[] = ['frugal', 'balanced', 'max'];
const AUTONOMY_LEVELS: readonly AutonomyLevel[] = ['supervised', 'guided', 'autonomous'];

function isOneOf<T extends string>(candidates: readonly T[], value: string): value is T {
  return (candidates as readonly string[]).includes(value);
}

// `Number()` coerces `''` to `0` and accepts hex/exponential/whitespace forms no CLI int/float flag
// should — an explicit shape check first is what makes `--concurrency=` (the empty-value form of a
// forgotten argument, e.g. `--concurrency= --json`) a real USR-002 instead of a silent `concurrency: 0`.
const INT_SHAPE = /^-?\d+$/;
const FLOAT_SHAPE = /^-?\d+(\.\d+)?$/;

function parseIntFlag(flag: string, value: string): number {
  if (!INT_SHAPE.test(value)) {
    throw new ForgeError('USR-002', { flag, value });
  }
  return Number(value);
}

function parseFloatFlag(flag: string, value: string): number {
  if (!FLOAT_SHAPE.test(value)) {
    throw new ForgeError('USR-002', { flag, value });
  }
  return Number(value);
}

interface MutableFlags {
  project?: string;
  config?: string;
  profile: string;
  platform?: string;
  modelTier?: ModelTier;
  autonomy?: AutonomyLevel;
  concurrency?: number;
  budget?: number;
  dryRun: boolean;
  yes: boolean;
  json: boolean;
  noTui: boolean;
  verbosity: number;
  quiet: boolean;
  noColor?: boolean;
  seed?: number;
}

/** Every recognised spelling from `03` §3.2's global-flags table, long and short. */
const KNOWN_FLAGS = new Set([
  '--project',
  '-C',
  '--config',
  '--profile',
  '--platform',
  '--model-tier',
  '--autonomy',
  '--concurrency',
  '--budget',
  '--dry-run',
  '--yes',
  '-y',
  '--json',
  '--no-tui',
  '--verbose',
  '-v',
  '--quiet',
  '-q',
  '--no-color',
  '--seed',
]);

/** Whether `token` is shaped like a global flag (its `--flag=value` form included). */
function looksLikeFlag(token: string): boolean {
  const eq = splitEquals(token);
  const flag = eq ? eq.flag : token;
  return KNOWN_FLAGS.has(flag) || /^-vvv?$/.test(token);
}

/**
 * Splits a `--flag=value` token, or returns `undefined` if `token` carries no `=`.
 */
function splitEquals(token: string): { flag: string; value: string } | undefined {
  const eq = token.indexOf('=');
  if (eq === -1) return undefined;
  return { flag: token.slice(0, eq), value: token.slice(eq + 1) };
}

/**
 * Parses `03` §3.2's global-flags table out of `argv`, in any order and interleaved with a
 * subcommand and its own arguments — everything not recognised as a global flag or one of its
 * values is returned untouched, in order, as `positionals`.
 */
export function parseGlobalFlags(argv: readonly string[]): GlobalFlags {
  const flags: MutableFlags = {
    profile: 'default',
    dryRun: false,
    yes: false,
    json: false,
    noTui: false,
    verbosity: 0,
    quiet: false,
  };
  const positionals: string[] = [];

  // A queue rather than an index: `noUncheckedIndexedAccess` types `argv[i]` as possibly
  // `undefined` regardless of the loop bound, and `.shift()` gives back the same "no more
  // elements" case as a real, checkable `undefined` instead of an assertion.
  const remaining = [...argv];
  const next = (flag: string): string => {
    const value = remaining[0];
    // A string flag with a forgotten argument (`--project --verbose status`) must not silently
    // swallow the next real flag as its own value — `--verbose` would then never take effect, and
    // `flags.project` would hold `'--verbose'`, both wrong with no error raised at all.
    if (value === undefined || looksLikeFlag(value)) {
      throw new ForgeError('USR-002', { flag, value: '' });
    }
    remaining.shift();
    return value;
  };

  for (let token = remaining.shift(); token !== undefined; token = remaining.shift()) {
    const eq = splitEquals(token);
    const flag = eq ? eq.flag : token;

    const takeValue = (): string => (eq ? eq.value : next(flag));

    switch (flag) {
      case '--project':
      case '-C':
        flags.project = takeValue();
        break;
      case '--config':
        flags.config = takeValue();
        break;
      case '--profile':
        flags.profile = takeValue();
        break;
      case '--platform':
        flags.platform = takeValue();
        break;
      case '--model-tier': {
        const value = takeValue();
        if (!isOneOf(MODEL_TIERS, value)) throw new ForgeError('USR-002', { flag, value });
        flags.modelTier = value;
        break;
      }
      case '--autonomy': {
        const value = takeValue();
        if (!isOneOf(AUTONOMY_LEVELS, value)) throw new ForgeError('USR-002', { flag, value });
        flags.autonomy = value;
        break;
      }
      case '--concurrency':
        flags.concurrency = parseIntFlag(flag, takeValue());
        break;
      case '--budget':
        flags.budget = parseFloatFlag(flag, takeValue());
        break;
      case '--dry-run':
        flags.dryRun = true;
        break;
      case '--yes':
      case '-y':
        flags.yes = true;
        break;
      case '--json':
        flags.json = true;
        break;
      case '--no-tui':
        flags.noTui = true;
        break;
      case '--verbose':
      case '-v':
        flags.verbosity += 1;
        break;
      case '--quiet':
      case '-q':
        flags.quiet = true;
        break;
      case '--no-color':
        flags.noColor = true;
        break;
      case '--seed':
        flags.seed = parseIntFlag(flag, takeValue());
        break;
      default:
        if (/^-vvv?$/.test(token)) {
          flags.verbosity += token.length - 1;
          break;
        }
        positionals.push(token);
    }
  }

  return { ...flags, positionals };
}
