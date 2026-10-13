/**
 * `systemCacheDirRoot` — every branch of the real platform-cache-directory lookup
 * `worktreesRootFor`'s own default parameter relies on (`specs/22 M17 P8`).
 *
 * `process.platform` is fakeable only the one way this codebase's own discipline allows a mock at
 * all ("failure injection the OS will not give you on demand" — `observe.test.ts`'s own identical
 * `withFakePlatform` precedent), restored in a `finally` so no other test ever sees the fake value.
 * `process.env` entries are saved and restored the same way, around each test, so this file's own
 * real `XDG_CACHE_HOME` (pinned once, suite-wide, by `test/global-setup.ts`/`test/setup.ts`) is never
 * permanently altered for a test that runs after it.
 *
 * @see specs/18 §18.3
 * @see PLAN-M17.md P8
 */
import { homedir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { systemCacheDirRoot } from '../src/system-cache-dir.ts';

async function withFakePlatform<T>(platform: string, fn: () => T | Promise<T>): Promise<T> {
  const real = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  try {
    return await fn();
  } finally {
    if (real !== undefined) Object.defineProperty(process, 'platform', real);
  }
}

type SavedEnvKey = 'XDG_CACHE_HOME' | 'LOCALAPPDATA';
const savedEnv = new Map<SavedEnvKey, string | undefined>();

function setEnv(key: SavedEnvKey, value: string | undefined): void {
  if (!savedEnv.has(key)) savedEnv.set(key, process.env[key]);
  if (value === undefined) {
    Reflect.deleteProperty(process.env, key);
  } else {
    process.env[key] = value;
  }
}

afterEach(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) {
      Reflect.deleteProperty(process.env, key);
    } else {
      process.env[key] = value;
    }
  }
  savedEnv.clear();
});

describe('systemCacheDirRoot (specs/22 M17 P8)', () => {
  it('returns a real, non-empty $XDG_CACHE_HOME verbatim, regardless of platform', async () => {
    setEnv('XDG_CACHE_HOME', '/a/real/cache/dir');
    await withFakePlatform('linux', () => {
      expect(systemCacheDirRoot()).toBe('/a/real/cache/dir');
    });
    await withFakePlatform('darwin', () => {
      expect(systemCacheDirRoot()).toBe('/a/real/cache/dir');
    });
    await withFakePlatform('win32', () => {
      expect(systemCacheDirRoot()).toBe('/a/real/cache/dir');
    });
  });

  it('treats an empty-string $XDG_CACHE_HOME the same as unset, falling through to the platform default', async () => {
    setEnv('XDG_CACHE_HOME', '');
    await withFakePlatform('linux', () => {
      expect(systemCacheDirRoot()).toBe(path.join(homedir(), '.cache'));
    });
  });

  it('falls back to ~/Library/Caches on darwin when $XDG_CACHE_HOME is unset', async () => {
    setEnv('XDG_CACHE_HOME', undefined);
    await withFakePlatform('darwin', () => {
      expect(systemCacheDirRoot()).toBe(path.join(homedir(), 'Library', 'Caches'));
    });
  });

  it('falls back to ~/.cache on linux (and every other non-darwin, non-win32 platform) when $XDG_CACHE_HOME is unset', async () => {
    setEnv('XDG_CACHE_HOME', undefined);
    await withFakePlatform('linux', () => {
      expect(systemCacheDirRoot()).toBe(path.join(homedir(), '.cache'));
    });
    await withFakePlatform('freebsd', () => {
      expect(systemCacheDirRoot()).toBe(path.join(homedir(), '.cache'));
    });
  });

  it('returns a real, non-empty %LOCALAPPDATA% verbatim on win32 when $XDG_CACHE_HOME is unset', async () => {
    setEnv('XDG_CACHE_HOME', undefined);
    setEnv('LOCALAPPDATA', 'C:\\Users\\test\\AppData\\Local');
    await withFakePlatform('win32', () => {
      expect(systemCacheDirRoot()).toBe('C:\\Users\\test\\AppData\\Local');
    });
  });

  it('falls back to ~/AppData/Local on win32 when both $XDG_CACHE_HOME and %LOCALAPPDATA% are unset', async () => {
    setEnv('XDG_CACHE_HOME', undefined);
    setEnv('LOCALAPPDATA', undefined);
    await withFakePlatform('win32', () => {
      expect(systemCacheDirRoot()).toBe(path.join(homedir(), 'AppData', 'Local'));
    });
  });

  it('treats an empty-string %LOCALAPPDATA% the same as unset on win32', async () => {
    setEnv('XDG_CACHE_HOME', undefined);
    setEnv('LOCALAPPDATA', '');
    await withFakePlatform('win32', () => {
      expect(systemCacheDirRoot()).toBe(path.join(homedir(), 'AppData', 'Local'));
    });
  });
});
