/**
 * `moduleSchema` — `19` §19.1's `module.yaml` document shape.
 *
 * @see specs/19 §19.1
 * @see PLAN-M10.md P2
 */
import { z } from 'zod';

import { PROJECT_LEVEL_ORDER } from '../agents/index.ts';
import { parseModuleVersionRange } from './version-range.ts';
import { MODULE_PROVIDES_KINDS } from './types.ts';

/** Lower-kebab-case only — no `.`, `/`, or path-separator-shaped character can ever match, which is
 * exactly what makes this pattern double as `resolveInstalledModules`'s own containment check on a
 * caller-supplied module id before it is ever joined into a filesystem path (see that function's own
 * doc comment: a critic round found the original version built `modulesDir/<id>/module.yaml` with no
 * check on `<id>` at all, a real path-traversal hole for an id like `"../../etc"`). */
export const MODULE_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

const moduleIdSchema = z
  .string()
  .min(1)
  .regex(MODULE_ID_PATTERN, 'must be lower-kebab-case (e.g. "fm-service")');

/**
 * `ceilings.<role>`'s own grant shape — deliberately **not** `@forge/extensions/agents`'
 * `toolGrantSchema`, even though the two describe the identical `ToolGrant` fields: that schema's
 * `exec`/`allowlistHosts` go through `overlayArrayField`, which also accepts an overlay
 * array-operator directive (`{ $append: [...] }`, `{ $set: [...] }`, ...) — the right shape for an
 * *overlay* document (`15` §15.3), wrong for a ceiling. `19` §19.1 is explicit that "ceilings are
 * declared by the module" as a flat literal grant, never a merge target a later layer appends to; a
 * critic round found the shared schema silently accepted `exec: { $append: ['curl *'] }` in a
 * `ceilings` block, parsing to a non-array `ModuleDefinition.ceilings[role].exec` that would reach
 * `@forge/extensions/agents`' own `checkToolCeiling` (which calls `.filter`/`.includes` on it
 * directly) and throw a raw, un-typed `TypeError` instead of failing this schema with a named error.
 */
const moduleCeilingGrantSchema = z
  .object({
    write: z.boolean().optional(),
    exec: z.array(z.string().min(1)).optional(),
    network: z.enum(['none', 'allowlist', 'full']).optional(),
    deploy: z.boolean().optional(),
    allowlistHosts: z.array(z.string().min(1)).optional(),
  })
  .strict();

/** `19` §19.1's own worked example: `version: 1.3.0` — a real, three-part semver, not a range. */
const semverSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, 'must be a real major.minor.patch version (e.g. "1.3.0")');

/** `19` §19.1's own worked example: `forgeVersion: ">=1.0 <2"`. Validated for real parseability here
 * — not merely "any non-empty string" — so an unparseable range fails at parse time with a named
 * reason, rather than silently always failing `satisfiesForgeVersionRange`'s own fail-closed check
 * later with no clue why. */
const forgeVersionRangeSchema = z
  .string()
  .min(1)
  .superRefine((value, ctx) => {
    if (parseModuleVersionRange(value) === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `"${value}" is not a valid forgeVersion range (e.g. ">=1.0 <2").`,
      });
    }
  });

/** `19` §19.1's own `provides:` block — every kind is optional (a module may provide none of a
 * given kind), and every entry is a bare id string, matching the worked example's own
 * `agents: [ domain-modeler, integration-architect ]` shape. */
const providesSchema = z
  .object(
    Object.fromEntries(
      MODULE_PROVIDES_KINDS.map((kind) => [kind, z.array(z.string().min(1)).optional()]),
    ) as Record<(typeof MODULE_PROVIDES_KINDS)[number], z.ZodOptional<z.ZodArray<z.ZodString>>>,
  )
  .strict();

export const moduleSchema = z
  .object({
    id: moduleIdSchema,
    name: z.string().min(1),
    version: semverSchema,
    forgeVersion: forgeVersionRangeSchema,
    requires: z.array(moduleIdSchema).default([]),
    conflicts: z.array(moduleIdSchema).default([]),
    levels: z.array(z.enum(PROJECT_LEVEL_ORDER)).min(1),
    ceilings: z.record(z.string().min(1), moduleCeilingGrantSchema).default({}),
    provides: providesSchema,
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.requires.includes(data.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['requires'],
        message: `Module "${data.id}" cannot require itself.`,
      });
    }
    if (data.conflicts.includes(data.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['conflicts'],
        message: `Module "${data.id}" cannot conflict with itself.`,
      });
    }
    const overlap = data.requires.filter((id) => data.conflicts.includes(id));
    if (overlap.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['conflicts'],
        message: `Module "${data.id}" both requires and conflicts with: ${overlap.join(', ')}.`,
      });
    }
  });
