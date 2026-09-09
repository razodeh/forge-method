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

/** Every real `${secret:NAME}` reference found across `.forge/**`/`docs/forge/**`'s own real text
 * content, cross-checked only for whether a same-named environment variable *exists* — `03` §3.7's
 * own explicit "existence verified without printing values" contract, so `env`'s own real values
 * never appear anywhere in a returned `DoctorCheck`, only the secret *names* that are missing. */
export async function checkSecretReferences(
  paths: ProjectPaths,
  env: Readonly<Record<string, string>>,
): Promise<DoctorCheck> {
  const files = (await Promise.all(SCAN_ROOTS.map((root) => walkTextFiles(paths, root)))).flat();

  const unresolved = new Set<string>();
  const resolvedCount = { value: 0 };
  for (const file of files) {
    const text = await readTextFile(paths.resolveWithin(file));
    for (const match of text.matchAll(SECRET_REFERENCE_SEARCH_PATTERN)) {
      const name = match[1];
      if (name === undefined) continue;
      if (Object.hasOwn(env, name)) resolvedCount.value += 1;
      else unresolved.add(name);
    }
  }

  const ok = unresolved.size === 0;
  return check(
    'secret-references',
    ok,
    'warning',
    ok
      ? `${String(resolvedCount.value)} real \${secret:...} reference(s), all resolvable.`
      : `${String(unresolved.size)} unresolved \${secret:...} reference(s): ${[...unresolved].join(', ')}.`,
    ok ? undefined : 'Set each named environment variable, then retry.',
  );
}
