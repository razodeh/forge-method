/**
 * `systemCacheDirRoot` — the one real source of "the platform's own cache directory"
 * `worktreeRoot.ts`'s `worktreesRootFor` needs to place lane/integration worktrees outside the
 * project tree (`06` §6.4, `18` §18.3's "Worktree location" paragraph, post-v1.0 `specs/22` M17).
 *
 * `QUALITY-BAR.md` R10 forbids reading `process.env`/`os.homedir()` directly in decision logic (a call
 * site's own behaviour would depend on which machine/account happened to run it, not on an explicit,
 * replayable input) — every real consumer takes this as an injected value/function instead, the same
 * `Clock`/`SYSTEM_CLOCK` split `@forge/core/clock.ts` establishes for "now", and the identical
 * `createSystemTempPath` split `@forge/cli`'s own `system-temp.ts` already establishes for "an OS temp
 * path". This file is the one place in `@forge/vcs` allowed to read them, narrowly exempted by name in
 * `eslint.config.js`, not by directory, for the same reason those two files are.
 *
 * @see QUALITY-BAR.md R10
 * @see specs/18 §18.3
 * @see PLAN-M17.md P8
 */
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * `$XDG_CACHE_HOME` when set to a non-empty value, else the platform's own real cache-directory
 * default per the XDG Base Directory spec's own fallback rule (`18` §18.3, confirmed against each
 * platform's own documented convention, not assumed): `~/Library/Caches` on macOS,
 * `%LOCALAPPDATA%` (falling back to `~/AppData/Local` if that is itself unset) on Windows, and
 * `~/.cache` on Linux and every other POSIX platform.
 *
 * Every real (non-test) caller gets this as the default of `worktreesRootFor`'s own `cacheDirRoot`
 * parameter; a test supplies its own fixed string instead (or, for the whole suite at once,
 * `test/global-setup.ts` pins the real `XDG_CACHE_HOME` env var itself to a disposable per-run
 * directory, so even a test that never imports this file at all cannot reach the real one).
 */
export function systemCacheDirRoot(): string {
  const xdgCacheHome = process.env['XDG_CACHE_HOME'];
  if (xdgCacheHome !== undefined && xdgCacheHome.trim() !== '') return xdgCacheHome;

  const home = homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Caches');
  if (process.platform === 'win32') {
    const localAppData = process.env['LOCALAPPDATA'];
    return localAppData !== undefined && localAppData.trim() !== ''
      ? localAppData
      : path.join(home, 'AppData', 'Local');
  }
  return path.join(home, '.cache');
}
