/**
 * `03` §3.1 step 1: the Node version floor. A pure string check, deliberately: the process-level
 * `exit(5)` this feeds is a thin caller's job (see `test/entry/node-version.subprocess.test.ts`,
 * which spawns a real `node` child process to observe that exit code — the one thing a pure
 * function cannot itself be tested for).
 *
 * @see specs/03 §3.1
 */

/** The floor `03` §3.1 states verbatim: "< 20.10 → print required version and abort (exit 5)". */
export const MIN_NODE_VERSION = '20.10.0';

/** One `[major, minor, patch]` triple parsed from a `process.version`-shaped string (`"v20.10.0"`). */
function parseVersion(version: string): readonly [number, number, number] | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) return undefined;
  const [, major, minor, patch] = match;
  return [Number(major), Number(minor), Number(patch)];
}

/** Whether `a` is greater than or equal to `b`, comparing major then minor then patch. */
function versionGte(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): boolean {
  if (a[0] !== b[0]) return a[0] > b[0];
  if (a[1] !== b[1]) return a[1] > b[1];
  return a[2] >= b[2];
}

/**
 * Whether `version` (a `process.version`-shaped string, e.g. `"v20.10.0"`) satisfies `03` §3.1's
 * floor. An unparseable string is treated as unsupported — a version this project cannot even read
 * is not one it can vouch for.
 */
export function isSupportedNodeVersion(version: string): boolean {
  const parsed = parseVersion(version);
  const floor = parseVersion(MIN_NODE_VERSION);
  if (!parsed || !floor) return false;
  return versionGte(parsed, floor);
}
