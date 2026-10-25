/**
 * `formatZodIssues`/`formatZodIssue`/`formatZodIssueMessage` — the shared rendering of a
 * `z.ZodError`'s `issues` into human-readable text, for a `ForgeError` detail (or an equivalent
 * per-issue record) built from a schema failure.
 *
 * `${issue.path.join('.') || '(root)'}: ${issue.message}`, one line per issue, joined `'; '` — this
 * exact shape is, independently, `extensions/src/module/parse.ts`'s and `extensions/src/install/
 * consent.ts`'s own local `formatZodIssues`, `CFG-008`'s inline version in `artifacts/validate.ts`,
 * and roughly a dozen further call sites across the codebase (`SPEC-QUESTIONS.md` Q325) — the same
 * convention arrived at independently everywhere, never imported from one place. This file is now
 * that one place for the call sites migrated to it here: `CFG-021`'s `parseModule`, `CFG-036`'s
 * `describeRequestedCapabilities`, and `@forge/extensions/presets`'s `validatePreset` (its own
 * `KIND_SCHEMAS` dispatch loop only — `checkTemplateOverlay`'s separate inline duplicate, and
 * `validatePreset`'s own top-level `presetSchema.safeParse`, are both confirmed union-free and left
 * alone) — all three via `formatZodIssue`/`formatZodIssues`, a single joined line — plus four more
 * confirmed-live sites Q325's own research missed, each of which keeps `path` and `message` as two
 * separate record fields rather than one joined line, so they use the finer-grained
 * `formatZodIssue`/`formatZodIssueMessage` exports instead: `@forge/methods`'s `loadDodProfile`
 * (`dodCheckSchema`), `@forge/agents`'s `loadAgentDefinition` (`inputRefSchema`, `tools.network`),
 * `@forge/engine`'s `parseWorkflow` (`produces`), and `@forge/extensions`'s `validateMcpConfig`
 * (`toolGrantValueSchema`). `validatePreset`'s own `KIND_SCHEMAS` dispatch reaches a union through a
 * *composed* schema a shared helper builds (`@forge/extensions/merge`'s own `overlayArrayField`,
 * used by both `agentOverlaySchema.limits` and `frameworkOverlaySchema`'s `criteria`/`options`/
 * `rules`, plus `workflowOverlaySchema`'s own `workflowStepsFieldSchema` and `mcpConfigSchema`'s own
 * `toolGrantValueSchema`) rather than a literal `z.union` written in `presets/schema.ts` itself —
 * exactly the shape a plain text-grep of the file under review would miss, and did miss once already
 * (round 2's audit of this same file wrongly concluded "no union at all" from that grep). The
 * remaining pre-existing inline occurrences elsewhere are unchanged — see this fix's own commit
 * messages for which of those were actually traced through every import/composition (confirmed
 * `z.discriminatedUnion`, confirmed not a union at all) versus genuinely left unaudited, rather than
 * repeating Q325's own mistake of an unverified blanket "currently unreachable" claim.
 *
 * **The `z.union` branch (`SPEC-QUESTIONS.md` Q325).** Before this branch, a `ZodInvalidUnionIssue`
 * fell through to the generic `${path}: ${message}` line like any other issue — but zod's own
 * `message` for `invalid_union` is a fixed, generic `"Invalid input"` (confirmed directly against
 * the real installed zod `3.25.76`), naming neither which shapes were allowed nor why the value
 * satisfied none of them. (`z.discriminatedUnion` does not need this branch: a bad discriminator
 * value renders zod's own distinct, already-specific `invalid_union_discriminator` message, and a
 * matched-discriminator branch's own field errors surface directly, never wrapped in
 * `invalid_union` at all.) Q325 disclosed the `z.union` gap as latent rather than fixing it,
 * reasoning no schema feeding this convention used `z.union` yet — but `consent.ts`'s own
 * `overlayCapabilityEntrySchema` already is a live `z.union` in this exact convention (missed by
 * Q325's own research): a `requestsCapabilities` entry with an unrecognised key, e.g. `{ bogus: 1 }`,
 * already rendered the unhelpful `"requestsCapabilities.0: Invalid input"` through the unfixed
 * convention, a real gap, not merely a hypothetical one. A round-2 review confirmed four further
 * live (not merely hypothetical) `z.union` sites feeding this same convention — listed above —
 * closing the identical real gap at each.
 *
 * Fixed by naming every union member's own failure, never guessing which member the author "meant"
 * — picking a single "closest" member would be exactly the kind of classifier `SPEC-QUESTIONS.md`
 * Q325's own DECISION 2 (the `uncovered` hunk reason) rejects elsewhere: claiming to discern
 * something nothing at this point in the pipeline can actually discern. Every candidate's own
 * sub-issues are rendered through this same function (recursively), so a union nested inside
 * another union still names each leaf failure, rather than collapsing to "Invalid input" at either
 * level.
 *
 * **Two known, deliberate roughnesses, left as-is rather than over-engineered against an
 * unreached case (round-2 review):**
 *
 * 1. A sub-issue that happens to read identically across two or more candidates (e.g. three
 *    `.strict()` object branches that all reject the same unrecognised key, only the branch-specific
 *    required-field complaint differing) is still repeated once per candidate, not factored out.
 *    Detecting and collapsing a *shared* sub-issue across *some* (not necessarily all) candidates
 *    without ever asserting more agreement between branches than genuinely exists is a real design
 *    problem, not a one-line fix — safer left as literal repetition than solved with a heuristic that
 *    could misstate which branches actually agree.
 * 2. Nesting reuses the identical `--`/`; ` delimiters at every depth (an inner union's own
 *    "did not match any of N allowed shapes -- ..." nests inside an outer candidate's parentheses
 *    unchanged), which departs from `codes.ts`'s own precedent of using `--` only once, flat, never
 *    nested. No schema anywhere in this codebase nests a union inside a union today (confirmed by a
 *    round-2 audit of every `z.union`/`z.discriminatedUnion` site), so this is acknowledged rather
 *    than fixed: the delimiters are prose for a human reader, not a parseable structure, and reusing
 *    them at depth is merely inelegant, not misleading, for the one case (this file's own test suite)
 *    that currently exercises it.
 *
 * @see SPEC-QUESTIONS.md Q325
 */
import type { ZodIssue } from 'zod';

/**
 * `issue.message`, except for an `invalid_union` issue, where it names every union member's own
 * failure instead of zod's fixed, generic `"Invalid input"`. Exposed on its own for a caller that
 * keeps `path` and `message` as two separate record fields rather than joining them into one line —
 * `@forge/methods`'s own `DodIssue`, `@forge/agents`'s own `AgentIssue`, both of which already
 * compute `path` themselves (`issue.path.join('.') || '(root)'`, unchanged) and only ever needed a
 * clearer `message`.
 */
export function formatZodIssueMessage(issue: ZodIssue): string {
  if (issue.code !== 'invalid_union') return issue.message;
  const shapes = issue.unionErrors
    .map((error, index) => `shape ${String(index + 1)} (${formatZodIssues(error.issues)})`)
    .join('; ');
  const shapeCount = String(issue.unionErrors.length);
  return `value did not match any of the ${shapeCount} allowed shapes -- ${shapes}`;
}

/** One issue, as `"<path>: <message>"`. Exposed on its own for a caller that renders a single
 * `ZodIssue` into one combined line rather than an array of them — `@forge/engine`'s own
 * `zodIssueToParseIssue`, `@forge/extensions`'s own `validateMcpConfig`, both of which previously
 * duplicated this exact `${issue.path.join('.') || '(root)'}: ${issue.message}` expression inline. */
export function formatZodIssue(issue: ZodIssue): string {
  const where = issue.path.join('.') || '(root)';
  return `${where}: ${formatZodIssueMessage(issue)}`;
}

/** Renders `issues` (a `z.ZodError`'s own `.issues`) into one line, suitable for a `ForgeError`
 * detail. Never throws, and never produces an empty string for a non-empty `issues` array. */
export function formatZodIssues(issues: readonly ZodIssue[]): string {
  return issues.map(formatZodIssue).join('; ');
}
