/**
 * `kbEntrySchema` — `08` §8.3's generic KB entry format: the one schema that does not already exist
 * anywhere in `@forge/schemas`'s 21-type registry (`SPEC-QUESTIONS.md` Q18 — a KB entry uses its own
 * `KB-{SECTION}-####` id shape, not the registry's `^[A-Z]+-\d{3,4}(-\d+)?$` pattern, and is not one
 * of the 21 registered types).
 *
 * Unlike every sibling schema in `@forge/schemas/artifacts` (which validate front matter alone),
 * this schema's input also carries `body` (`PLAN-M3.md` P6's own Surface: "a `superRefine` requiring
 * Verification body content whenever `confidence: 'verified'`") — a KB entry's body structure is
 * itself part of what `08` §8.3 normatively requires, not a separate later-phase check the way `18`
 * §18.6's `requiredSections` mechanism treats the 21 registry types.
 *
 * @see specs/08 §8.3
 * @see SPEC-QUESTIONS.md Q18
 * @see SPEC-QUESTIONS.md Q51
 * @see PLAN-M3.md P6
 */
import { z } from 'zod';

import { KB_SECTIONS, sectionIdToken } from './sections.ts';

/** `08` §8.3's own `type:` enum comment, verbatim. In practice, `parseKbTree` only ever validates a
 * `knowledge` or `glossary` entry against this schema — `adr`/`risk`/`assumption`/`open-question`
 * name how a generic entry *could* refer to itself, but each of those four already has its own
 * dedicated `@forge/schemas` schema and its own id/file convention, and `parseKbTree` routes a file
 * to that dedicated schema by path, never to this one, before this type value would matter. */
export const KB_ENTRY_TYPES = [
  'knowledge',
  'adr',
  'risk',
  'assumption',
  'open-question',
  'glossary',
] as const;
export type KbEntryType = (typeof KB_ENTRY_TYPES)[number];

const KB_ENTRY_STATUSES = ['draft', 'active', 'superseded', 'deprecated'] as const;
const KB_ENTRY_CONFIDENCE = ['low', 'medium', 'high', 'verified'] as const;
const KB_ENTRY_SOURCE_KINDS = ['decision', 'human', 'code'] as const;

const KB_ENTRY_ID_PATTERN = /^KB-([A-Z]+)-\d{4}(-\d+)?$/;

const kbEntrySourceSchema = z
  .object({
    kind: z.enum(KB_ENTRY_SOURCE_KINDS),
    ref: z.string().min(1),
  })
  .strict();

// CommonMark permits up to three leading spaces on an ATX heading without changing how it renders —
// a gauntlet critic found the original patterns anchored at column 0 exactly, silently treating a
// validly-indented `  ## Verification` as if no such heading existed at all.
const VERIFICATION_HEADING_PATTERN = /^ {0,3}##\s+Verification\s*$/;
const NEXT_HEADING_PATTERN = /^ {0,3}##\s+/;

/** A `## Verification` heading (any heading level `##`, matching every other body heading `08` §8.3's
 * worked example uses) followed by at least one non-blank, non-HTML-comment line before the next `##`
 * heading or EOF — "how an agent can check this is still true," not merely the bare heading with
 * nothing (or only an invisible placeholder comment) under it. A gauntlet critic found the original
 * version satisfied by a lone HTML comment (an author's own reminder-to-self, left in place), since
 * GitHub/GitLab render such a comment as nothing at all — this strips comments (a single- or
 * multi-line `<!-- ... -->` span) before checking for real content, so a comment-only section is
 * correctly treated as empty. */
function hasVerificationContent(body: string): boolean {
  const lines = body.split(/\r\n|\r|\n/);
  const startIndex = lines.findIndex((line) => VERIFICATION_HEADING_PATTERN.test(line));
  if (startIndex === -1) return false;

  const sectionLines: string[] = [];
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (NEXT_HEADING_PATTERN.test(line)) break;
    sectionLines.push(line);
  }

  const withoutComments = sectionLines.join('\n').replace(/<!--[\s\S]*?-->/g, '');
  return withoutComments.split('\n').some((line) => line.trim() !== '');
}

export const kbEntrySchema = z
  .object({
    id: z.string().regex(KB_ENTRY_ID_PATTERN),
    type: z.enum(KB_ENTRY_TYPES),
    section: z.enum(KB_SECTIONS),
    title: z.string().min(1),
    status: z.enum(KB_ENTRY_STATUSES),
    confidence: z.enum(KB_ENTRY_CONFIDENCE),
    owner: z.string().min(1),
    sources: z.array(kbEntrySourceSchema).min(1),
    created: z.string().date(),
    updated: z.string().date(),
    verified: z.string().date().optional(),
    review_by: z.string().date(),
    supersedes: z.array(z.string().min(1)),
    superseded_by: z.string().min(1).nullable(),
    related: z.array(z.string().min(1)),
    diagrams: z.array(z.string().min(1)),
    tags: z.array(z.string().min(1)),
    applies_to: z.array(z.string().min(1)),
    body: z.string(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const match = KB_ENTRY_ID_PATTERN.exec(data.id);
    const token = match?.[1];
    if (token !== undefined && token !== sectionIdToken(data.section)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['id'],
        message: `id ${JSON.stringify(data.id)} names section token ${JSON.stringify(token)}, which does not match section: ${JSON.stringify(data.section)}.`,
      });
    }
  })
  .superRefine((data, ctx) => {
    // Mirrors adrSchema's own status/superseded_by consistency check (M1) — the same field pair, the
    // same two-directional rule, applied to the sibling schema that also has both fields.
    if (data.status === 'superseded' && data.superseded_by === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['superseded_by'],
        message: 'a KB entry with status "superseded" must name the entry that superseded it.',
      });
    }
    if (data.status !== 'superseded' && data.superseded_by !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['status'],
        message: 'a KB entry with superseded_by set must have status "superseded".',
      });
    }
  })
  .superRefine((data, ctx) => {
    // "Verification is required for confidence: verified entries and is what makes drift detection
    // possible" (08 §8.3) — checked against the body, not the front matter, since Verification is a
    // body section, not a field.
    if (data.confidence === 'verified' && !hasVerificationContent(data.body)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['confidence'],
        message: 'confidence: "verified" requires a "## Verification" body section with real content.',
      });
    }
  });

export type KbEntry = z.infer<typeof kbEntrySchema>;
