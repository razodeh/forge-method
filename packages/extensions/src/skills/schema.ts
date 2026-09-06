/**
 * `skillFrontMatterSchema` — `15` §15.4.2's `SKILL.md` front matter shape.
 *
 * @see specs/15 §15.4.2
 * @see PLAN-M2.md P4
 */
import { z } from 'zod';

const appliesToSchema = z
  .object({
    agents: z.array(z.string().min(1)).optional(),
    languages: z.array(z.string().min(1)).optional(),
    paths: z.array(z.string().min(1)).optional(),
  })
  .strict();

/** `grant` is a closed set — `15` §15.4.2's own example is the only value the spec pack ever shows. */
const scriptSchema = z
  .object({
    id: z.string().min(1),
    run: z.string().min(1),
    grant: z.enum(['exec']),
  })
  .strict();

const providedCheckSchema = z
  .object({
    id: z.string().min(1),
    run: z.string().min(1),
    failOn: z.string().min(1),
  })
  .strict();

export const skillFrontMatterSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    version: z.string().min(1),
    description: z.string().min(1),
    when_to_use: z.string().min(1),
    applies_to: appliesToSchema.optional(),
    activation: z.enum(['auto', 'explicit', 'always']).default('auto'),
    budget_tokens: z.number().int().positive(),
    requires_tools: z.array(z.string().min(1)).optional(),
    scripts: z.array(scriptSchema).optional(),
    provides_checks: z.array(providedCheckSchema).optional(),
    forge_version: z.string().min(1).optional(),
  })
  .strict();

export type SkillFrontMatter = z.infer<typeof skillFrontMatterSchema>;
export type SkillScript = z.infer<typeof scriptSchema>;
export type SkillProvidedCheck = z.infer<typeof providedCheckSchema>;
