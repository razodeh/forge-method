/**
 * `forge doctor`'s own project checks — `03` §3.7's "Project: config validity, manifest checksum
 * drift, KB lint, spec graph validity, index freshness" bullet.
 *
 * @see specs/03 §3.7
 */
import { pathExists, readTextFile, type ProjectPaths } from '@forge/core/fs';
import { configSchema } from '@forge/schemas/config';
import * as YAML from 'yaml';

import { kbLint, type KbCommandContext } from '../kb.ts';
import { specValidate, type SpecCommandContext } from '../spec.ts';
import type { Manifest } from '../../init/manifest.ts';
import type { CheckSeverity, DoctorCheck } from './types.ts';

function check(
  id: string,
  ok: boolean,
  severity: CheckSeverity,
  message: string,
  fix?: string,
): DoctorCheck {
  return fix === undefined ? { id, ok, severity, message } : { id, ok, severity, message, fix };
}

/** `.forge/config.yaml` against `@forge/schemas`' own real `configSchema` — the identical validation
 * every other real config reader in this codebase would apply, run here explicitly rather than left
 * implicit in whatever happens to read the file next. */
export async function checkConfigValidity(paths: ProjectPaths): Promise<DoctorCheck> {
  const relative = '.forge/config.yaml';
  if (!(await pathExists(paths.resolveWithin(relative)))) {
    return check(
      'config-validity',
      false,
      'hard',
      'No .forge/config.yaml found.',
      'Run `forge init`.',
    );
  }
  let parsed: unknown;
  try {
    parsed = YAML.parse(await readTextFile(paths.resolveWithin(relative)));
  } catch (cause) {
    return check(
      'config-validity',
      false,
      'hard',
      `.forge/config.yaml is not valid YAML: ${cause instanceof Error ? cause.message : String(cause)}.`,
      'Fix the YAML syntax error, or restore from a real backup.',
    );
  }
  const result = configSchema.safeParse(parsed);
  return check(
    'config-validity',
    result.success,
    'hard',
    result.success
      ? '.forge/config.yaml is real and schema-valid.'
      : `.forge/config.yaml fails schema validation: ${result.error.issues[0]?.message ?? 'unknown error'}.`,
    result.success ? undefined : 'Run `forge config explain <key>` to find the offending value.',
  );
}

/** `.forge/manifest.yaml`'s own real structural shape (`version: 1`, `modules: [{id, version,
 * checksum}]`) — real, but deliberately *not* full checksum-drift detection: that needs recomputing
 * what the manifest *should* be right now from this FORGE installation's own current module/template
 * source content, which needs the identical real "locate my own source content at runtime" mechanism
 * `forge init`'s own `RunInitDeps.modulesDir` is itself caller-injected for (no concrete resolver
 * exists anywhere in this codebase yet, the same "no concrete adapter" shape of gap already documented
 * for `PlatformAdapter`). Recording the real, present, well-formed manifest as a real pass here is
 * honest; inventing a second, parallel modulesDir-resolution convention just for this one check would
 * not be — see `SPEC-QUESTIONS.md` for the full record. */
export async function checkManifest(paths: ProjectPaths): Promise<DoctorCheck> {
  const relative = '.forge/manifest.yaml';
  if (!(await pathExists(paths.resolveWithin(relative)))) {
    return check(
      'manifest-structure',
      false,
      'hard',
      'No .forge/manifest.yaml found.',
      'Run `forge init`.',
    );
  }
  let parsed: unknown;
  try {
    parsed = YAML.parse(await readTextFile(paths.resolveWithin(relative)));
  } catch (cause) {
    return check(
      'manifest-structure',
      false,
      'hard',
      `.forge/manifest.yaml is not valid YAML: ${cause instanceof Error ? cause.message : String(cause)}.`,
    );
  }
  const manifest = parsed as Partial<Manifest>;
  const modules = Array.isArray(manifest.modules) ? manifest.modules : [];
  const ok =
    manifest.version === 1 &&
    Array.isArray(manifest.modules) &&
    modules.every(
      (module) =>
        typeof module === 'object' &&
        module !== null &&
        typeof (module as { id?: unknown }).id === 'string' &&
        typeof (module as { version?: unknown }).version === 'string' &&
        typeof (module as { checksum?: unknown }).checksum === 'string',
    );
  return check(
    'manifest-structure',
    ok,
    'hard',
    ok
      ? `.forge/manifest.yaml is real and well-formed (${String(modules.length)} modules).`
      : '.forge/manifest.yaml is malformed.',
    ok ? undefined : 'Run `forge init` again, or restore .forge/manifest.yaml from a real backup.',
  );
}

/** `08` §8.7's own real KB lint (`@forge/kb`, M3), reused unchanged via `forge kb lint`'s own
 * already-built command wrapper — every `error`-severity finding is a real `hard` doctor failure,
 * every `warn` a real `warning`, both surfaced as one real, combined `DoctorCheck` rather than one
 * per finding (a project can have dozens of real findings; `03` §3.7's own checklist is a list of
 * *checks*, not a full lint report duplicated a second time). */
export async function checkKbLint(ctx: KbCommandContext): Promise<DoctorCheck> {
  const findings = await kbLint(ctx);
  const errors = findings.filter((finding) => finding.severity === 'error');
  const ok = findings.length === 0;
  return check(
    'kb-lint',
    ok,
    errors.length > 0 ? 'hard' : 'warning',
    ok
      ? 'KB lint: no findings.'
      : `KB lint: ${String(errors.length)} error(s), ${String(findings.length - errors.length)} warning(s).`,
    ok ? undefined : 'Run `forge kb lint` for the full, real finding list.',
  );
}

/** `09` §9.4's own real spec-graph validity (`@forge/core/graph`'s `SpecGraph`), reused unchanged via
 * `forge spec validate`'s own already-built command wrapper — a document-level schema error, a
 * missing required edge, or a real cycle are all real `hard` failures (`09` §9.4's own graph
 * invariants are structural, not advisory). */
export async function checkSpecGraph(ctx: SpecCommandContext): Promise<DoctorCheck> {
  const result = await specValidate(ctx);
  const invalidDocs = result.documents.filter((doc) => !doc.valid);
  const ok =
    invalidDocs.length === 0 &&
    result.missingRequiredEdges.length === 0 &&
    result.cycles.length === 0;
  return check(
    'spec-graph',
    ok,
    'hard',
    ok
      ? 'Spec graph: valid, no missing required edges, no cycles.'
      : `Spec graph: ${String(invalidDocs.length)} invalid document(s), ${String(result.missingRequiredEdges.length)} missing edge(s), ${String(result.cycles.length)} cycle(s).`,
    ok ? undefined : 'Run `forge spec validate` for the full, real finding list.',
  );
}
