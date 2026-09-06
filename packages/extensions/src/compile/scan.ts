/**
 * `scanTargetsFor` — every string leaf of a resolved entity's own value, as a `ScanTarget` for
 * `@forge/extensions/invariants`' I8/I9 (secret-literal and injection-content) checks.
 *
 * @see PLAN-M2.md P9
 * @see SPEC-QUESTIONS.md Q42
 */
import type { ScanTarget } from '../invariants/index.ts';

/**
 * Walks `value` recursively, collecting one `ScanTarget` per string leaf, `location`-tagged with the
 * dotted path from `basePath` to that leaf (array indices included) — deterministic since object keys
 * are visited in `Object.keys`'s own insertion order, itself fixed by `applyOverlay`'s own merge
 * (never re-sorted), and arrays are walked in their existing order.
 */
export function scanTargetsFor(basePath: string, value: unknown): readonly ScanTarget[] {
  const targets: ScanTarget[] = [];
  walk(basePath, value, targets);
  return targets;
}

function walk(path: string, value: unknown, targets: ScanTarget[]): void {
  if (typeof value === 'string') {
    targets.push({ location: path, text: value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      walk(`${path}[${String(index)}]`, item, targets);
    });
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      walk(`${path}.${key}`, entry, targets);
    }
  }
}
