/**
 * Shared types for `@forge/extensions/presets` — `15` §15.9's signed, atomically-applied bundles.
 *
 * @see specs/15 §15.9
 * @see PLAN-M2.md P7
 * @see SPEC-QUESTIONS.md Q38
 * @see SPEC-QUESTIONS.md Q39
 */

/**
 * Which of this milestone's own overlay-able document kinds a preset file's `data` should validate
 * against. Scoped to exactly the kinds this milestone's own schemas cover that are real
 * `.forge/overrides/**` *files* — `roster` is deliberately excluded: `15` §15.3.3's own worked example
 * places it in `.forge/config.yaml` itself, not a separate overlay file, and `SPEC-QUESTIONS.md` Q38
 * already excludes config.yaml-level fields from what a preset writes.
 */
export type PresetOverlayKind =
  | 'agentOverlay'
  | 'mcpConfig'
  | 'workflowOverlay'
  | 'gateCheck'
  | 'frameworkOverlay'
  | 'templateOverlay'
  | 'styleProfile';

/**
 * One file a preset contributes. `path` is relative to a project root (always under
 * `.forge/overrides/`, the project customization layer `15` §15.2 places user-facing overlays in).
 * `data` is the plain-object (already-YAML-parsed-equivalent) content — validated directly against
 * `kind`'s schema, and serialized to YAML text only at `applyPreset`/`ejectPreset` time.
 */
export interface PresetOverlayFile {
  readonly path: string;
  readonly kind: PresetOverlayKind;
  readonly data: Readonly<Record<string, unknown>>;
}

/** `15` §15.9's own table: an id and its documented posture, plus the real overlays expressing it. */
export interface PresetDefinition {
  readonly id: string;
  readonly posture: string;
  readonly files: readonly PresetOverlayFile[];
}

export type PresetFindingSeverity = 'error';

export interface PresetValidationFinding {
  readonly severity: PresetFindingSeverity;
  readonly path: string;
  readonly message: string;
}

export interface PresetValidationOutcome {
  readonly valid: boolean;
  readonly findings: readonly PresetValidationFinding[];
}

/** A preset's file, serialized to real YAML text — what `ejectPreset` returns and `applyPreset` writes. */
export interface OverlayFile {
  readonly path: string;
  readonly content: string;
}

export interface AppliedPreset {
  readonly id: string;
  readonly files: readonly OverlayFile[];
}
