/**
 * `parseInitFlags` — `03` §3.3's own worked non-interactive flag line, parsed into `InitOptions`.
 *
 * `args` is everything after the `init` subcommand name and its own `[dir]` positional has already
 * been separated by the caller — a future command-dispatch piece's own job, matching `@forge/cli/entry`'s
 * `parseGlobalFlags` precedent of consuming only the flags it recognises. `--yes` itself is a *global*
 * flag (`03` §3.2's own table): `parseGlobalFlags` already strips it out of `positionals` before this
 * function ever sees them, so it is passed in separately rather than re-parsed here.
 *
 * @see specs/03 §3.3
 */
import { ForgeError } from '@forge/core/errors';

import type { InitOptions } from './types.ts';

interface MutableInitOptions {
  name?: string;
  slug?: string;
  description?: string;
  repoUrl?: string;
  ideaFile?: string;
  mode?: 'guided' | 'express';
  level?: 'L0' | 'L1' | 'L2' | 'L3' | 'L4';
  platform?: string;
  fallbackPlatform?: string;
  autonomy?: 'supervised' | 'guided' | 'autonomous';
  budget?: number;
  modules?: readonly string[];
  preset?: string;
  overlay?: readonly string[];
  kbRoot?: string;
  gitInit?: boolean;
  allowCommits?: boolean;
}

const MODES = new Set(['guided', 'express']);
const LEVELS = new Set(['L0', 'L1', 'L2', 'L3', 'L4']);
const AUTONOMY_LEVELS = new Set(['supervised', 'guided', 'autonomous']);

export interface ParsedInit {
  readonly dir: string;
  readonly options: InitOptions;
}

export function parseInitFlags(args: readonly string[], yes: boolean): ParsedInit {
  const options: MutableInitOptions = {};
  let dir = '.';
  let dirSeen = false;

  const remaining = [...args];
  const next = (flag: string): string => {
    const value = remaining.shift();
    if (value === undefined || value.startsWith('--')) {
      throw new ForgeError('USR-002', { flag, value: '' });
    }
    return value;
  };

  for (let token = remaining.shift(); token !== undefined; token = remaining.shift()) {
    switch (token) {
      case '--name':
        options.name = next(token);
        break;
      case '--slug':
        options.slug = next(token);
        break;
      case '--description':
        options.description = next(token);
        break;
      case '--repo-url':
        options.repoUrl = next(token);
        break;
      case '--idea-file':
        options.ideaFile = next(token);
        break;
      case '--mode': {
        const value = next(token);
        if (!MODES.has(value)) throw new ForgeError('USR-002', { flag: token, value });
        options.mode = value as 'guided' | 'express';
        break;
      }
      case '--level': {
        const value = next(token);
        if (!LEVELS.has(value)) throw new ForgeError('USR-002', { flag: token, value });
        options.level = value as 'L0' | 'L1' | 'L2' | 'L3' | 'L4';
        break;
      }
      case '--platform':
        options.platform = next(token);
        break;
      case '--fallback-platform':
        options.fallbackPlatform = next(token);
        break;
      case '--autonomy': {
        const value = next(token);
        if (!AUTONOMY_LEVELS.has(value)) throw new ForgeError('USR-002', { flag: token, value });
        options.autonomy = value as 'supervised' | 'guided' | 'autonomous';
        break;
      }
      case '--budget': {
        const value = next(token);
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) throw new ForgeError('USR-002', { flag: token, value });
        options.budget = parsed;
        break;
      }
      case '--modules':
        options.modules = next(token)
          .split(',')
          .map((id) => id.trim())
          .filter((id) => id.length > 0);
        break;
      case '--preset':
        options.preset = next(token);
        break;
      case '--overlay':
        options.overlay = [...(options.overlay ?? []), next(token)];
        break;
      case '--kb-root':
        options.kbRoot = next(token);
        break;
      case '--git-init':
        options.gitInit = true;
        break;
      case '--allow-commits':
        options.allowCommits = true;
        break;
      default:
        if (token.startsWith('--')) {
          throw new ForgeError('USR-002', { flag: token, value: '' });
        }
        if (dirSeen) {
          throw new ForgeError('USR-002', { flag: '[dir]', value: token });
        }
        dir = token;
        dirSeen = true;
    }
  }

  if (options.name === undefined) {
    throw new ForgeError('USR-002', { flag: '--name', value: '' });
  }

  return { dir, options: { ...options, name: options.name, yes } };
}
