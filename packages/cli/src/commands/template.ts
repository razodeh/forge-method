/**
 * `forge template <list|validate>` — `PLAN-M6.md` C9's own real, acknowledged gap: not named as its
 * own subcommand anywhere in `03` §3.2 (confirmed directly), but `specs/22`'s own M6 exit-test line
 * (`pnpm forge agent validate --all && pnpm forge workflow validate --all && pnpm forge template
 * validate --all`) names it as a real, required peer of `forge agent validate`/`forge workflow
 * validate` — this piece adds the small, new `forge template <validate|list>` group the plan's own
 * text names as the most natural home for it.
 *
 * Validates `@forge/templates`' own real, shipped artifact-template scaffolds
 * (`templates/artifacts/<Type>.md` — the identical content `forge init` copies into a real project's
 * own `.forge/templates/`) through the identical real, already-built two-phase check every other real
 * artifact document in this codebase goes through: `ArtifactDocument.parse` (front-matter shape) then
 * `validateArtifact` (per-type schema + required sections), reused directly rather than a second,
 * template-specific validator. A template's own placeholder field values (`id: STORY-001`, `title:
 * '<the story name>'`) are real, valid strings against every real per-type schema's own field types —
 * confirmed directly that every real, shipped *full-document* template needs no special-casing to pass
 * this cleanly.
 *
 * Six real, shipped templates (`Risk`/`Assumption`/`OpenQuestion`/`Waiver`/`Environment`/
 * `HandoffRecord`) are a genuinely different real shape, by design, not a defect: each is a real
 * "one-off entry stub" meant to be copied into a real collection register file (`kb/risks.md`,
 * `reports/waivers.md`, ...), confirmed directly against every one of their own real body text
 * ("this type has no whole-document body — the register is the front matter itself") — none of them
 * carries a `type` field at all, since `18` §18.6's own per-document front-matter shape (`type`,
 * `schemaVersion`, `status`, ...) genuinely does not apply to a bare register-entry snippet.
 * `validateArtifact` would report every one of these real, correctly-authored stubs as schema-invalid
 * ("type: undefined is not a registered artifact type") for a difference this piece did not introduce
 * and should not paper over as a false failure — real stubs are recognized by the real absence of a
 * `type` field and reported as a distinct, honest `'stub'` kind rather than run through a schema check
 * that was never meant to apply to them. See `SPEC-QUESTIONS.md`.
 *
 * @see specs/22 M6
 * @see PLAN-M6.md C9
 */
import { ArtifactDocument, validateArtifact } from '@forge/core/artifacts';
import { ProjectPaths, readTextFile } from '@forge/core/fs';
import { TEMPLATE_INDEX, type TemplateArtifactTypeId } from '@forge/templates';

import { resolvePackageRoot } from '../init/package-root.ts';

const templatesPaths = new ProjectPaths(resolvePackageRoot('@forge/templates'));

/** `list` — every real, shipped artifact-template type id. */
export function templateList(): readonly TemplateArtifactTypeId[] {
  return Object.keys(TEMPLATE_INDEX) as TemplateArtifactTypeId[];
}

export interface TemplateValidationResult {
  readonly type: TemplateArtifactTypeId;
  /** `'full'` — a real `18` §18.6-shaped document, checked through `validateArtifact`. `'stub'` — a
   * real collection-entry snippet with no `type` field of its own, by design; not run through
   * `validateArtifact` at all, since that check was never meant to apply to it. */
  readonly kind: 'full' | 'stub';
  readonly valid: boolean;
  readonly errors: readonly string[];
}

async function validateOne(type: TemplateArtifactTypeId): Promise<TemplateValidationResult> {
  const relPath = TEMPLATE_INDEX[type];
  const source = await readTextFile(templatesPaths.resolveWithin(relPath));
  const doc = ArtifactDocument.parse(source, relPath);

  const frontMatter = doc.frontMatter as Readonly<Record<string, unknown>>;
  if (frontMatter['type'] === undefined) {
    return { type, kind: 'stub', valid: true, errors: [] };
  }

  // `validateArtifact` reads `type` from the document's own real front matter (already the correct,
  // real `type: <Type>` field every real, full-document template carries) rather than taking it as a
  // parameter -- no cast or second type parameter needed.
  const outcome = validateArtifact(doc);
  return outcome.valid
    ? { type, kind: 'full', valid: true, errors: [] }
    : { type, kind: 'full', valid: false, errors: outcome.errors.map((error) => error.message) };
}

/** `validate --all` — every real, shipped template, each validated independently (the same per-item
 * isolation `forge agent validate --all`/`forge workflow validate --all` already establish: one
 * template's own real failure never hides another's). */
export async function templateValidateAll(): Promise<readonly TemplateValidationResult[]> {
  const types = templateList();
  const results: TemplateValidationResult[] = [];
  for (const type of types) {
    results.push(await validateOne(type));
  }
  return results;
}
