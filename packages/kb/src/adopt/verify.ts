/**
 * `extractVerificationCommand` — `17` §17.4 point 6 / §17.5 / §17.6's own `forge kb verify` ("run
 * stored verification commands"): reads the one, real, machine-runnable command out of a KB entry's
 * own free-text `## Verification` body section, when that section names one.
 *
 * `08` §8.3's own `## Verification` section is free-text prose ("how an agent can check this is still
 * true: a command, a file, a test") — `SPEC-QUESTIONS.md` Q159 already found, while building P17, that
 * no structured `verificationCommand` front-matter field exists or was ever added, and that extracting
 * an arbitrary shell command out of arbitrary human/LLM prose has no general solution. This function
 * does not attempt one: it recognises exactly one, narrow, already-real convention this same
 * milestone's own RECONSTRUCTION piece (`reconstruction.ts`, `PLAN-M10.md` P18) already writes for
 * every build/test check it records — a line reading `` Command: `<the command>` `` — and returns
 * `undefined` for anything else, honestly, rather than guessing at a looser pattern. A `## Verification`
 * section written by a human in ordinary prose (no such line) is not "broken" — it is simply not
 * machine-runnable, and `forge kb verify` treats it as skipped, never as a failure.
 *
 * Mirrors `kb-entry.ts`'s own private `hasVerificationContent` section-scanning approach (find the
 * `## Verification` heading, collect lines until the next `##` heading or end of body) — not shared,
 * since that function only ever needs to detect *whether* the section has content, never to extract
 * text from it, and is not exported for reuse outside schema validation.
 *
 * @see specs/17 §17.4
 * @see specs/17 §17.6
 * @see SPEC-QUESTIONS.md Q159
 * @see PLAN-M10.md P20
 */

// CommonMark permits up to three leading spaces on an ATX heading without changing how it renders —
// the identical tolerance `kb-entry.ts`'s own pattern already applies, kept consistent here so a
// section either schema considers "the Verification section" is the same section both places see.
const VERIFICATION_HEADING_PATTERN = /^ {0,3}##\s+Verification\s*$/;
const NEXT_HEADING_PATTERN = /^ {0,3}##\s+/;
const COMMAND_LINE_PATTERN = /^Command:\s*`([^`]+)`\s*$/;

/**
 * Returns the real command named by the last `` Command: `<cmd>` `` line inside `body`'s own
 * `## Verification` section, or `undefined` when the section is absent, empty, or names no such line.
 * "Last," not "first": `reconstruction.ts` never writes more than one, but a hand-edited entry that
 * appends a corrected command below an older one should have the newer line win, matching how a
 * human editing the file top-to-bottom would expect their own latest edit to take effect.
 */
export function extractVerificationCommand(body: string): string | undefined {
  const lines = body.split(/\r\n|\r|\n/);
  const startIndex = lines.findIndex((line) => VERIFICATION_HEADING_PATTERN.test(line));
  if (startIndex === -1) return undefined;

  let found: string | undefined;
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined || NEXT_HEADING_PATTERN.test(line)) break;
    const match = COMMAND_LINE_PATTERN.exec(line.trim());
    const command = match?.[1]?.trim();
    if (command !== undefined && command !== '') found = command;
  }
  return found;
}
