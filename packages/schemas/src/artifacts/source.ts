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
 * `'external'` (`PLAN-M14.md` P30) is a fourth, later addition: an entry whose content came from outside
 * the project -- an MCP server or a fetched page (`20` §20.5 point 3, `15` §15.5.4) -- names it with
 * `ref` holding the `mcp:<server>[/<tool>]` or `fetch:<https-url>` reference itself (the same scheme
 * strings a workflow step's own `inputs:` may declare, `@forge/engine/plan`'s `isExternalSchemeInputReference`),
 * not an ADR id, an elicitation note, or a source file path the way the other three kinds do. The CLI
 * collects the ids of every KB entry/ADR/Runbook carrying one (`@forge/cli`'s own
 * `collectExternalKbIds`) so plan compilation can taint a step that declares one of those ids as an
 * input (`plan/compile.ts`'s own `externalKbIds` option) -- a fact this schema alone cannot establish
 * (a KB entry does not know which steps reference it), only *record*.
 *
 * @see specs/08 §8.3
 * @see specs/08 §8.6
 * @see specs/20 §20.5 point 3
 * @see specs/15 §15.5.4
 * @see PLAN-M14.md P11
 * @see PLAN-M14.md P30
 * @see SPEC-QUESTIONS.md Q18
 */
import { z } from 'zod';

const ARTIFACT_SOURCE_KINDS = ['decision', 'human', 'code', 'external'] as const;

export const artifactSourceSchema = z
  .object({
    kind: z.enum(ARTIFACT_SOURCE_KINDS),
    ref: z.string().min(1),
  })
  .strict();

export type ArtifactSource = z.infer<typeof artifactSourceSchema>;
