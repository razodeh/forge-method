/**
 * `validatePreset` — `15` §15.9: "a preset is just a bundle of the above" (§15.2–§15.8's own
 * schemas), never a shape of its own that could drift from the rest.
 *
 * @see specs/15 §15.9
 * @see PLAN-M2.md P7
 */
import { ARTIFACT_SCHEMAS, type ArtifactTypeId } from '@forge/schemas';

import { checkTemplateRequiredFields } from '../workflows/index.ts';
import { KIND_SCHEMAS, presetSchema } from './schema.ts';
import type {
  PresetDefinition,
  PresetValidationFinding,
  PresetValidationOutcome,
} from './types.ts';

function isKnownArtifactType(value: unknown): value is ArtifactTypeId {
  return typeof value === 'string' && Object.hasOwn(ARTIFACT_SCHEMAS, value);
}

/**
 * A `templateOverlay` file's `data` is a front-matter document, and every front-matter document
 * already carries its own `type` (`18` §18.6) — reused here as the artifact type to check against,
 * rather than a second, separate field this piece would have to add.
 *
 * `KIND_SCHEMAS['templateOverlay']` (`templateOverlaySchema`) only checks that `data` is a plain
 * object — it has no per-type field shape to check against, since which type applies is itself a
 * field inside `data`. `checkTemplateRequiredFields` alone only checks field *names* are present, not
 * that their *values* are actually valid for the type — so this also runs `data` through the type's
 * own real `@forge/schemas` zod schema, the same one `checkTemplateRequiredFields` reads its required
 * field list from, to catch a preset that names every required field but gives one a garbage value
 * (exactly the "never silently producing an artifact that fails validation later" `15` §15.7 names).
 */
function checkTemplateOverlay(
  path: string,
  data: Readonly<Record<string, unknown>>,
): readonly PresetValidationFinding[] {
  const type = data['type'];
  if (!isKnownArtifactType(type)) {
    return [
      {
        severity: 'error',
        path,
        message: 'type: a template overlay must name a real, registered artifact type.',
      },
    ];
  }

  const findings: PresetValidationFinding[] = checkTemplateRequiredFields(type, data).map(
    (finding) => ({ severity: 'error', path, message: finding.message }),
  );

  const result = ARTIFACT_SCHEMAS[type].schema.safeParse(data);
  if (!result.success) {
    for (const issue of result.error.issues) {
      findings.push({
        severity: 'error',
        path,
        message: `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      });
    }
  }
  return findings;
}

/**
 * Validates `preset`'s own bundle shape (`presetSchema` — a non-empty `files` array, each entry a
 * real `path`/`kind`/`data` triple) plus every file's content against its own `kind`'s real schema,
 * never throwing — the same "boundary input produces a typed outcome" precedent every prior piece in
 * this milestone reused. A preset with even one invalid file, or an invalid bundle shape itself
 * (e.g. no files at all), is `valid: false` in full: `applyPreset` refuses the whole bundle rather
 * than writing some files and not others (`15` §15.9: "applied atomically").
 */
export function validatePreset(preset: PresetDefinition): PresetValidationOutcome {
  const findings: PresetValidationFinding[] = [];

  const shapeResult = presetSchema.safeParse(preset);
  if (!shapeResult.success) {
    for (const issue of shapeResult.error.issues) {
      findings.push({
        severity: 'error',
        path: `preset:${preset.id}`,
        message: `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      });
    }
    return { valid: false, findings };
  }

  for (const file of preset.files) {
    const schema = KIND_SCHEMAS[file.kind];
    const result = schema.safeParse(file.data);
    if (!result.success) {
      for (const issue of result.error.issues) {
        findings.push({
          severity: 'error',
          path: file.path,
          message: `${issue.path.join('.') || '(root)'}: ${issue.message}`,
        });
      }
      continue;
    }
    if (file.kind === 'templateOverlay') {
      findings.push(...checkTemplateOverlay(file.path, file.data));
    }
  }
  return { valid: findings.length === 0, findings };
}
