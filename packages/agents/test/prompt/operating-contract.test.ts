/**
 * `OPERATING_CONTRACT` — `05` §5.5's own eleven-point text, checked verbatim against the spec file
 * itself (a literal content-fidelity test, not merely "eleven items exist"), per A5's own Checks text.
 *
 * @see specs/05 §5.5
 * @see PLAN-M6.md A5
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { OPERATING_CONTRACT } from '../../src/prompt/operating-contract.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** Extracts `05` §5.5's own verbatim block directly from the spec file: everything between the
 * "Normative content" line and the next `## ` heading, minus the leading sentence -- so this test
 * fails the moment the shipped constant and the spec text actually diverge, not merely when someone
 * remembers to update both by hand in lockstep. */
function extractSpecOperatingContract(): string {
  const specText = readFileSync(path.join(repoRoot, 'specs', '05-agent-system.md'), 'utf-8');
  const startMarker = 'Normative content — every agent receives this verbatim:\n\n';
  const startIndex = specText.indexOf(startMarker);
  if (startIndex === -1) throw new Error('could not find the §5.5 normative-content marker in specs/05');
  const bodyStart = startIndex + startMarker.length;
  const nextHeadingIndex = specText.indexOf('\n## ', bodyStart);
  if (nextHeadingIndex === -1) throw new Error('could not find the next heading after §5.5');
  return specText.slice(bodyStart, nextHeadingIndex).trimEnd();
}

describe('OPERATING_CONTRACT', () => {
  it("matches specs/05 §5.5's own eleven-point text exactly, word for word", () => {
    expect(OPERATING_CONTRACT).toBe(extractSpecOperatingContract());
  });

  it('contains all eleven numbered points', () => {
    for (let n = 1; n <= 11; n += 1) {
      expect(OPERATING_CONTRACT).toMatch(new RegExp(`(^|\\n)${String(n)}\\. `));
    }
  });
});
