/**
 * `presetSchema` — `15` §15.9's "signed bundle" manifest shape, plus the per-`PresetOverlayKind`
 * schema dispatch table `validatePreset` (in `./validate.ts`) uses.
 *
 * @see specs/15 §15.9
 * @see PLAN-M2.md P7
 */
import { agentOverlaySchema } from '../agents/index.ts';
import { mcpConfigSchema } from '../mcp/index.ts';
import { styleProfileSchema } from '../style/index.ts';
import {
  frameworkOverlaySchema,
  gateCheckSchema,
  templateOverlaySchema,
  workflowOverlaySchema,
} from '../workflows/index.ts';
import { z } from 'zod';

import type { PresetOverlayKind } from './types.ts';

const presetOverlayFileSchema = z
  .object({
    path: z.string().min(1),
    kind: z.enum([
      'agentOverlay',
      'mcpConfig',
      'workflowOverlay',
      'gateCheck',
      'frameworkOverlay',
      'templateOverlay',
      'styleProfile',
    ]),
    data: z.record(z.string(), z.unknown()),
  })
  .strict();

/** A preset bundle's own manifest shape — "a named bundle referencing overlay documents." */
export const presetSchema = z
  .object({
    id: z.string().min(1),
    posture: z.string().min(1),
    files: z.array(presetOverlayFileSchema).min(1),
  })
  .strict();

export type PresetSchema = z.infer<typeof presetSchema>;

/** Every `PresetOverlayKind`'s real schema, from this milestone's own already-committed pieces. */
export const KIND_SCHEMAS: Record<PresetOverlayKind, z.ZodTypeAny> = {
  agentOverlay: agentOverlaySchema,
  mcpConfig: mcpConfigSchema,
  workflowOverlay: workflowOverlaySchema,
  gateCheck: gateCheckSchema,
  frameworkOverlay: frameworkOverlaySchema,
  templateOverlay: templateOverlaySchema,
  styleProfile: styleProfileSchema,
};
