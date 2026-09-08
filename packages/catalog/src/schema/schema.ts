/**
 * `catalogEntrySchema` — `12` §12.2's own entry YAML shape, as a zod schema.
 *
 * @see specs/12 §12.2
 * @see PLAN-M6.md C1
 */
import { z } from 'zod';

const CATALOG_KINDS = [
  'language',
  'framework',
  'datastore',
  'queue',
  'stream',
  'cache',
  'search',
  'ci',
  'observability',
  'infra',
  'auth',
  'payments',
  'testing',
  'frontend',
  'mobile',
  'orm',
  'api-style',
  'cloud',
  'container',
  'iac',
  // Extension beyond 12 §12.2's own 20-member enum comment, required by that same section's "Catalog
  // scope" table -- see CatalogKind's own doc comment and SPEC-QUESTIONS.md Q87.
  'stack',
  'feature-flags',
  'secrets',
] as const;

const burdenLevelSchema = z.enum(['low', 'medium', 'high']);

export const catalogEntrySchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(CATALOG_KINDS),
    name: z.string().min(1),
    category: z.string().min(1),
    maturity: z.enum(['emerging', 'growing', 'mature', 'legacy', 'declining']),
    licence: z.string().min(1),
    managed_options: z.array(z.string().min(1)).optional(),
    strengths: z.array(z.string().min(1)).min(1),
    weaknesses: z.array(z.string().min(1)).min(1),
    fits_when: z.array(z.string().min(1)).min(1),
    avoid_when: z.array(z.string().min(1)).min(1),
    pairs_with: z.array(z.string().min(1)).optional(),
    alternatives: z.array(z.string().min(1)).optional(),
    operational_burden: burdenLevelSchema,
    team_familiarity_weight: burdenLevelSchema,
    exit_cost: burdenLevelSchema,
    agent_friendliness: burdenLevelSchema,
    notes_for_agents: z.array(z.string().min(1)).min(1),
  })
  .strict();
