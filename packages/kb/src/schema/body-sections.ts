/**
 * `08` §8.3's four fixed KB entry body sections, and reading one's content out of a raw body string.
 *
 * Originally private to `@forge/kb/write`'s `KbWriter` (P7, for `propose()`'s own rebase check); moved
 * here once P8's index build needed the identical extraction (`terms`: FTS5 over statement + rationale
 * + title) rather than duplicate the heading-matching regex a second time.
 *
 * @see specs/08 §8.3
 * @see SPEC-QUESTIONS.md Q53
 * @see PLAN-M3.md P7
 * @see PLAN-M3.md P8
 */

export const KB_BODY_SECTIONS = ['statement', 'rationale', 'implications', 'verification'] as const;
export type KbBodySection = (typeof KB_BODY_SECTIONS)[number];

const SECTION_HEADINGS: Record<KbBodySection, string> = {
  statement: 'Statement',
  rationale: 'Rationale',
  implications: 'Implications',
  verification: 'Verification',
};

const NEXT_HEADING_PATTERN = /^ {0,3}##\s+/;

function headingPatternFor(section: KbBodySection): RegExp {
  return new RegExp(`^ {0,3}##\\s+${SECTION_HEADINGS[section]}\\s*$`);
}

/** The `[contentStart, contentEnd)` line-index range of `section`'s own content (excluding its
 * heading line and the next heading, if any) within `lines` — `undefined` if `body` has no such
 * section at all (a legitimate KB entry need not carry all four — `kbEntrySchema` only requires
 * `## Verification` when `confidence: 'verified'`). */
export function sectionLineRange(
  lines: readonly string[],
  section: KbBodySection,
): { readonly contentStart: number; readonly contentEnd: number } | undefined {
  const headingIndex = lines.findIndex((line) => headingPatternFor(section).test(line));
  if (headingIndex === -1) return undefined;

  // `.findIndex` on the sliced remainder, not a manual indexed loop: its own callback receives each
  // line directly, with no `noUncheckedIndexedAccess` fallback to defend against an index that is
  // always in range by construction.
  const rest = lines.slice(headingIndex + 1);
  const nextHeadingOffset = rest.findIndex((line) => NEXT_HEADING_PATTERN.test(line));
  const contentEnd = nextHeadingOffset === -1 ? lines.length : headingIndex + 1 + nextHeadingOffset;
  return { contentStart: headingIndex + 1, contentEnd };
}

/** `section`'s own content within `body`, trimmed — `undefined` if `body` has no such section. */
export function readKbBodySection(body: string, section: KbBodySection): string | undefined {
  const lines = body.split(/\r\n|\r|\n/);
  const range = sectionLineRange(lines, section);
  if (range === undefined) return undefined;
  return lines.slice(range.contentStart, range.contentEnd).join('\n').trim();
}
