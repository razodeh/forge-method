/**
 * `verifyKb` — `08` §8.8's `forge kb verify`: its own two literal checks, "running every entry's
 * `Verification` command/check" and `review_by` staleness, both flagging `needs-review`.
 *
 * `runCheck` is injected, never invoked by this package itself (`PLAN-M3.md` P10's own Surface: "never
 * shells out itself — keeps this package's own dependency surface clean") — handed the entry's whole
 * `## Verification` section text verbatim, not a hand-extracted "the command," since how to run
 * arbitrary Verification prose (a single command, several, a manual step) is the caller's own decision
 * to make, not one this package can make correctly for every entry it will ever see.
 *
 * @see specs/08 §8.8
 * @see PLAN-M3.md P10
 */
import { readKbBodySection } from '../schema/body-sections.ts';
import type { KbTree } from '../schema/tree.ts';
import { kbEntriesOf } from './extract.ts';
import { sortFindings, type KbFinding } from './types.ts';

export async function verifyKb(
  tree: KbTree,
  runCheck: (command: string) => Promise<boolean>,
  now: Date,
): Promise<readonly KbFinding[]> {
  const findings: KbFinding[] = [];

  for (const entry of kbEntriesOf(tree)) {
    if (entry.confidence === 'verified') {
      const verification = readKbBodySection(entry.body, 'verification') ?? '';
      const passed = await runCheck(verification);
      if (!passed) {
        findings.push({
          ruleId: 'kb:needs-review',
          severity: 'warn',
          message: `${entry.id}'s own Verification check did not pass.`,
          entryId: entry.id,
        });
      }
    }

    if (new Date(entry.review_by).getTime() < now.getTime()) {
      findings.push({
        ruleId: 'kb:needs-review',
        severity: 'warn',
        message: `${entry.id} passed its review date of ${entry.review_by} and needs review.`,
        entryId: entry.id,
      });
    }
  }

  return sortFindings(findings);
}
