/**
 * `forge doctor`'s own secret-reference check — `03` §3.7's "unresolved `${secret:…}` references
 * (existence verified without printing values)" bullet.
 *
 * `@forge/extensions/mcp`'s own `SECRET_REFERENCE_PATTERN` matches a *whole string* that names one
 * secret reference (an MCP server config field's own value, validated in isolation) — real, but not
 * directly reusable for scanning arbitrary file *content* for every embedded occurrence, which needs
 * the identical syntax without the `^`/`$` anchors and with the global flag. Rebuilt locally from the
 * same real pattern rather than silently relying on an anchored regex's own `.source` behaving
 * correctly unanchored (untested, unintended usage of another package's own internal detail).
 *
 * @see specs/03 §3.7
 */
import { listDirEntriesSorted, pathExists, readTextFile, type ProjectPaths } from '@forge/core/fs';

import type { CheckSeverity, DoctorCheck } from './types.ts';

function check(
  id: string,
  ok: boolean,
  severity: CheckSeverity,
  message: string,
  fix?: string,
): DoctorCheck {
  return fix === undefined ? { id, ok, severity, message } : { id, ok, severity, message, fix };
}

const SECRET_REFERENCE_SEARCH_PATTERN = /\$\{secret:([A-Za-z0-9_.-]+)\}/g;
const SCAN_ROOTS = ['.forge', 'docs/forge'];
const TEXT_EXTENSIONS = new Set(['.yaml', '.yml', '.md', '.json']);

async function walkTextFiles(paths: ProjectPaths, root: string): Promise<readonly string[]> {
  if (!(await pathExists(paths.resolveWithin(root)))) return [];
  const files: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) break;
    const entries = await listDirEntriesSorted(paths.resolveWithin(dir));
    for (const entry of entries) {
      const relPath = `${dir}/${entry.name}`;
      if (entry.isDirectory) {
        if (relPath === '.forge/state') continue; // event logs, locks — never real config content.
        stack.push(relPath);
      } else if (TEXT_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf('.')))) {
        files.push(relPath);
      }
    }
  }
  return files;
}

export interface SecretReferenceScan {
  /** Names referenced at least once, sorted. */
  readonly resolved: readonly string[];
  /** Names referenced with no matching environment variable (or, with `requireValue`, an empty one), sorted. */
  readonly unresolved: readonly string[];
  /** How many references (with repeats) were found, resolved or not. */
  readonly referenceCount: number;
}

/** Every real `${secret:NAME}` reference across `.forge/**`/`docs/forge/**`'s text content, cross-checked only for
 * whether a same-named environment variable *exists* — `03` §3.7's own explicit "existence verified without
 * printing values" contract, so `env`'s values never appear in a result, only secret *names*.
 *
 * `requireValue` (the `secrets-resolved` gate rule, `PLAN-M13.md` P25): a variable that is set to an empty or
 * whitespace-only string does not resolve a secret, so it counts as unresolved. The `forge doctor` warning keeps
 * the looser existence test it always had. */
export async function scanSecretReferences(
  paths: ProjectPaths,
  env: Readonly<Record<string, string>>,
  requireValue = false,
): Promise<SecretReferenceScan> {
  const files = (await Promise.all(SCAN_ROOTS.map((root) => walkTextFiles(paths, root)))).flat();

  const unresolved = new Set<string>();
  const resolved = new Set<string>();
  let referenceCount = 0;
  for (const file of files) {
    const text = await readTextFile(paths.resolveWithin(file));
    for (const match of text.matchAll(SECRET_REFERENCE_SEARCH_PATTERN)) {
      const name = match[1];
      if (name === undefined) continue;
      referenceCount += 1;
      const value = Object.hasOwn(env, name) ? env[name] : undefined;
      const present = value !== undefined && (!requireValue || value.trim() !== '');
      if (present) resolved.add(name);
      else unresolved.add(name);
    }
  }
  const sorted = (names: ReadonlySet<string>): readonly string[] =>
    [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { resolved: sorted(resolved), unresolved: sorted(unresolved), referenceCount };
}

export async function checkSecretReferences(
  paths: ProjectPaths,
  env: Readonly<Record<string, string>>,
): Promise<DoctorCheck> {
  const scan = await scanSecretReferences(paths, env);
  const ok = scan.unresolved.length === 0;
  return check(
    'secret-references',
    ok,
    'warning',
    ok
      ? `${String(scan.referenceCount)} real \${secret:...} reference(s), all resolvable.`
      : `${String(scan.unresolved.length)} unresolved \${secret:...} reference(s): ${scan.unresolved.join(', ')}.`,
    ok ? undefined : 'Set each named environment variable, then retry.',
  );
}
