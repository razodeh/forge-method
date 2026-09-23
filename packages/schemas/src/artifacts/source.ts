/**
 * `artifactSourceSchema` — one provenance entry ("`sources`", `08` §8.3's worked example: "provenance is
 * mandatory"), shared by `kbEntrySchema` (`@forge/kb`, where it stays required, `min(1)`) and the six
 * KB-located registry schemas this piece (`PLAN-M14.md` P11) gives an OPTIONAL `sources` field: `adr.ts`,
 * `runbook.ts`, `risk.ts`, `assumption.ts`, `open-question.ts`, `environment.ts`. The shape is exactly
 * `@forge/kb`'s own former private `kbEntrySourceSchema` (`packages/kb/src/schema/kb-entry.ts`), moved
 * here so both sides validate one real schema instead of two independently-typed copies that could
 * silently drift apart; `@forge/kb/schema` re-exports this schema (and `kbEntrySchema` itself now
 * imports and uses it directly) rather than keeping its own duplicate.
 *
 * @see specs/08 §8.3
 * @see specs/08 §8.6
 * @see PLAN-M14.md P11
 * @see SPEC-QUESTIONS.md Q18
 */
import { z } from 'zod';

const ARTIFACT_SOURCE_KINDS = ['decision', 'human', 'code'] as const;

export const artifactSourceSchema = z
  .object({
    kind: z.enum(ARTIFACT_SOURCE_KINDS),
    ref: z.string().min(1),
  })
  .strict();

export type ArtifactSource = z.infer<typeof artifactSourceSchema>;
