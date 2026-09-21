/**
 * `forge overlay explain <id>` / `forge overlay add <source>` — `03` §3.2.8.
 *
 * `overlayExplain` is a thin wrapper over `@forge/extensions/compile`'s own already-built
 * `explainOverlay` (M2). `overlayAdd` is `19` §19.5's full installation flow for the overlay channel
 * (`15` §15.11's own `overlay.yaml` shape) — the real counterpart of `module.ts`'s own `moduleAdd`,
 * sharing that file's fetch/consent/safety-scan/manifest pipeline rather than re-deriving it
 * (`PLAN-M11.md` P5's own recorded Surface note: this file is "new" for `overlayAdd` specifically,
 * not a fresh file — `overlayExplain` already lived here from M2).
 *
 * No full `overlay.yaml` schema exists anywhere in this codebase (`@forge/extensions/install/
 * consent.ts`'s own doc comment records this as a deliberate, disclosed gap for its own narrower
 * consent-screen purpose) — `parseOverlayManifestDocument` below is this command's own equally
 * minimal, equally disclosed validation, covering only the fields `19` §19.5 step 2 needs checked
 * (`id`/`name`/`version`/`forgeVersion`/`requiresModules`) before install. The consent screen itself
 * re-validates the full capability-relevant subset from the raw document directly (`@forge/extensions/
 * install`'s own `describeRequestedCapabilities`), not from this function's narrower parsed result.
 *
 * `overlayAdd` runs inside `module.ts`'s own `withManifestLock` (one project has one install lock,
 * shared with `moduleAdd`/`moduleRemove`/`moduleUpdate`, since all four mutate the same
 * `manifest.yaml`) and refuses an id already claimed by *either* an installed module or overlay
 * (`CFG-042`) — both critic-round fixes, see `module.ts`'s own top-of-file doc comment.
 *

 * @see specs/03 §3.2.8
 * @see specs/15 §15.11
 * @see specs/15 §15.12
 * @see specs/19 §19.5
 * @see PLAN-M11.md P5
 */
import path from 'node:path';

import * as YAML from 'yaml';

import { ForgeError, readTextFile, type ProjectPaths } from '@forge/core';
import { type AbsolutePath } from '@forge/core/fs';
import {
  explainOverlay,
  type CompileResult,
  type DocumentKind,
  type FieldProvenanceEntry,
} from '@forge/extensions/compile';
import {
  describeRequestedCapabilities,
  promptForConsent,
  scanBundleForSafety,
} from '@forge/extensions/install';
import { parseModuleVersionRange, satisfiesForgeVersionRange } from '@forge/extensions/module';

import {
  fetchInstallBundle,
  installBundleTree,
  readManifestDocument,
  withManifestLock,
  writeManifestDocument,
  type InstallChangeReport,
  type InstalledOverlayRow,
  type InstallOptions,
} from './module.ts';

/** Lower-kebab-case only, the identical shape `@forge/extensions/module`'s own `MODULE_ID_PATTERN`
 * enforces for a `module.yaml` id (that constant is not itself re-exported from this package's public
 * `./module` barrel, so this is a deliberate, matching duplicate rather than a cross-package import).
 * Enforced here — not merely implied by "must not collide with an existing id" — because a critic
 * round on this piece found nothing rejected a `/`-, `..`-, or absolute-path-shaped overlay `id`
 * before it was joined into `.forge/overlays/${id}` below: `ProjectPaths.resolveWithin` still refuses
 * a genuine escape, but a legal-looking-if-unusual id like `"a/b"` would silently create a nested
 * `.forge/overlays/a/b/` tree while the manifest records a flat-looking id, corrupting `19` §19.1's
 * own documented one-level `.forge/overlays/<id>/` layout. Checked as part of parsing — before the
 * consent screen or the safety scan ever run — so a malformed id fails with this file's own named
 * `CFG-046`, not a late, generic `CFG-003` after the user has already approved the capability screen. */
const OVERLAY_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

export function overlayExplain(
  result: CompileResult,
  kind: DocumentKind,
  id: string,
): readonly FieldProvenanceEntry[] {
  return explainOverlay(result, kind, id);
}

export interface OverlayCommandContext {
  readonly paths: ProjectPaths;
}

interface ParsedOverlayManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly forgeVersion: string;
  readonly requiresModules: readonly string[];
}

/** `15` §15.11's own worked example, validated just far enough to drive `19` §19.5 step 2's own
 * `forgeVersion`/`requires` check — see this file's own top-of-file doc comment for why this is
 * deliberately not a full `overlay.yaml` schema.
 *
 * @throws {ForgeError} `CFG-046` if `raw` is missing, or has the wrong type for, any of the fields
 * this install pipeline actually needs.
 */
function parseOverlayManifestDocument(raw: unknown, source: string): ParsedOverlayManifest {
  if (typeof raw !== 'object' || raw === null) {
    throw new ForgeError('CFG-046', { source, detail: 'overlay.yaml is not a YAML mapping' });
  }
  const record = raw as Record<string, unknown>;
  const { id, name, version, forgeVersion } = record;
  if (typeof id !== 'string' || id.length === 0) {
    throw new ForgeError('CFG-046', { source, detail: 'missing or empty "id"' });
  }
  if (!OVERLAY_ID_PATTERN.test(id)) {
    throw new ForgeError('CFG-046', {
      source,
      detail: `"id" must be lower-kebab-case (e.g. "acme-standards"), got ${JSON.stringify(id)}`,
    });
  }
  if (typeof name !== 'string' || name.length === 0) {
    throw new ForgeError('CFG-046', { source, detail: 'missing or empty "name"' });
  }
  if (typeof version !== 'string' || version.length === 0) {
    throw new ForgeError('CFG-046', { source, detail: 'missing or empty "version"' });
  }
  if (typeof forgeVersion !== 'string' || parseModuleVersionRange(forgeVersion) === undefined) {
    throw new ForgeError('CFG-046', {
      source,
      detail: `"forgeVersion" is not a valid range: ${JSON.stringify(forgeVersion ?? null)}`,
    });
  }
  const requiresModulesRaw = record['requiresModules'];
  let requiresModules: readonly string[] = [];
  if (requiresModulesRaw !== undefined) {
    if (
      !Array.isArray(requiresModulesRaw) ||
      !requiresModulesRaw.every((entry) => typeof entry === 'string')
    ) {
      throw new ForgeError('CFG-046', {
        source,
        detail: '"requiresModules" must be an array of strings',
      });
    }
    requiresModules = requiresModulesRaw;
  }
  return { id, name, version, forgeVersion, requiresModules };
}

/** `add <source>` — `19` §19.5's full installation flow for the overlay channel, sharing `module.ts`'s
 * own fetch/copy/manifest pipeline. Unlike `moduleAdd`, the installed id comes from the bundle's own
 * `overlay.yaml`, never a caller-supplied argument — `15` §15.11's own command table (`forge overlay
 * add <path|npm:|git+…>`) takes no separate id. */
export async function overlayAdd(
  ctx: OverlayCommandContext,
  source: string,
  options: InstallOptions,
): Promise<InstallChangeReport> {
  return withManifestLock(ctx.paths, () => overlayAddLocked(ctx, source, options));
}

async function overlayAddLocked(
  ctx: OverlayCommandContext,
  source: string,
  options: InstallOptions,
): Promise<InstallChangeReport> {
  const doc = await readManifestDocument(ctx.paths);

  const bundle = await fetchInstallBundle(source, options);
  try {
    if (bundle.manifestKind !== 'overlay') {
      throw new ForgeError('CFG-043', {
        source,
        expectedKind: 'overlay',
        actualKind: bundle.manifestKind,
      });
    }
    // `bundle.path` is a fetched-but-not-yet-installed bundle's own temp directory (or, for the local
    // channel, the user's own source directory) -- outside the project entirely, never a value
    // `ProjectPaths.resolveWithin` could have produced, and never treated as a write target itself;
    // `module.ts`'s own `moduleYamlAbsPath` doc comment records the identical reasoning for the
    // module-channel equivalent of this exact cast.
    const rawDocument: unknown = YAML.parse(
      await readTextFile(path.join(bundle.path, 'overlay.yaml') as AbsolutePath),
    );
    const parsed = parseOverlayManifestDocument(rawDocument, source);

    if (
      doc.overlays.some((overlay) => overlay.id === parsed.id) ||
      doc.modules.some((module) => module.id === parsed.id)
    ) {
      throw new ForgeError('CFG-042', { id: parsed.id, kind: 'overlay' });
    }
    if (!satisfiesForgeVersionRange(options.forgeVersion, parsed.forgeVersion)) {
      throw new ForgeError('CFG-024', {
        moduleId: parsed.id,
        forgeVersion: options.forgeVersion,
        required: parsed.forgeVersion,
      });
    }
    const installedModuleIds = new Set(doc.modules.map((module) => module.id));
    for (const required of parsed.requiresModules) {
      if (!installedModuleIds.has(required)) {
        throw new ForgeError('CFG-022', { moduleId: parsed.id, requires: required });
      }
    }

    const description = describeRequestedCapabilities({ kind: 'overlay', document: rawDocument });
    const granted = await promptForConsent(description.text, options.consent);
    if (!granted) {
      throw new ForgeError('CFG-040', { id: parsed.id });
    }

    await scanBundleForSafety(bundle.path);

    const destAbs = ctx.paths.resolveWithin(`.forge/overlays/${parsed.id}`);
    await installBundleTree(destAbs, bundle.path);

    const record: InstalledOverlayRow = {
      id: parsed.id,
      version: parsed.version,
      checksum: bundle.checksum,
      source,
    };
    await writeManifestDocument(ctx.paths, {
      version: 1,
      modules: doc.modules,
      overlays: [...doc.overlays, record],
    });

    return {
      id: parsed.id,
      action: 'installed',
      version: parsed.version,
      resolvedSetDelta: { added: [parsed.id], removed: [] },
      newGrants: description.entries.map((entry) => entry.text),
      warnings: bundle.warnings,
    };
  } finally {
    await bundle.cleanup();
  }
}
