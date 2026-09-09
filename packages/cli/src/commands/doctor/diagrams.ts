/**
 * `forge doctor`'s own diagram checks — `03` §3.7's "Diagrams: notation parsers available, optional
 * renderer presence, generated-diagram drift, and any diagram exceeding the complexity budget"
 * bullet.
 *
 * `notation parsers available`/`renderer presence` are trivially real for this milestone: `@forge/
 * diagrams` always bundles its own Mermaid parser and its own real `renderHtml` (no external
 * mermaid-cli/puppeteer dependency this package ever probes for — `packages/diagrams/src/render/
 * bundle.ts`'s own bundled script is the only renderer this codebase has), so both are reported as a
 * real, always-true fact about this installation, not fabricated. `generated-diagram drift` needs a
 * real `generatorInput` per diagram to check against (`checkDrift`'s own real signature) — nothing a
 * standalone `forge doctor` invocation has any way to supply on its own (the same real gap `forge
 * diagram sync`'s own caller-supplied `generatorInputs: ReadonlyMap<string, unknown>` already makes
 * explicit), so this piece checks the complexity budget and reference/orphan validity instead
 * (`lintDiagram`'s own real, self-contained checks, needing no external input at all) and records
 * drift-checking as a real, documented gap rather than fabricating input.
 *
 * @see specs/03 §3.7
 */
import { parseKbTree } from '@forge/kb/schema';
import { parseDiagram } from '@forge/diagrams/parse';
import { lintDiagram } from '@forge/diagrams/lint';
import type { ProjectPaths } from '@forge/core/fs';

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

export async function checkDiagrams(paths: ProjectPaths, kbRoot: string): Promise<DoctorCheck> {
  const tree = await parseKbTree(paths, kbRoot);
  const diagramEntries = tree.entries.filter((entry) => entry.kind === 'diagram');

  let errorCount = 0;
  let warnCount = 0;
  for (const entry of diagramEntries) {
    const parsed = await parseDiagram(entry.value.source);
    const findings = lintDiagram(entry.value, parsed);
    for (const finding of findings) {
      if (finding.severity === 'error') errorCount += 1;
      else warnCount += 1;
    }
  }
  const ok = errorCount === 0 && warnCount === 0;
  return check(
    'diagrams',
    ok,
    errorCount > 0 ? 'hard' : 'warning',
    ok
      ? `${String(diagramEntries.length)} real diagram(s): all within budget, no orphan/reference findings. Bundled Mermaid parser and renderer available.`
      : `${String(diagramEntries.length)} real diagram(s): ${String(errorCount)} error(s), ${String(warnCount)} warning(s).`,
    ok
      ? undefined
      : 'Run `forge diagram validate <id>` for each flagged diagram’s own real finding list.',
  );
}
