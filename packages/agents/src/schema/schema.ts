/**
 * `agentDefinitionSchema` — `05` §5.3's own agent-definition YAML shape, as a zod schema.
 *
 * @see specs/05 §5.3
 * @see PLAN-M6.md A1
 */
import { z } from 'zod';

const inputRefSchema = z
  .union([
    z.object({ artifact: z.string().min(1) }).strict(),
    z.object({ kb: z.string().min(1) }).strict(),
  ])
  .describe('exactly one of artifact or kb');

const inputsSchema = z
  .object({
    required: z.array(inputRefSchema),
    optional: z.array(inputRefSchema).optional(),
  })
  .strict();

const outputSchema = z
  .object({
    type: z.string().min(1),
    schema: z.string().min(1),
    path: z.string().min(1),
    cardinality: z.enum(['single', 'many']).optional(),
  })
  .strict();

const personaSchema = z
  .object({
    voice: z.string().min(1),
    stance: z.string().min(1),
    disagreement_style: z.string().min(1),
  })
  .strict();

const toolsSchema = z
  .object({
    read: z.boolean(),
    write: z.boolean(),
    exec: z.array(z.string().min(1)).optional(),
    network: z.union([z.boolean(), z.enum(['none', 'allowlist', 'full'])]),
    git_commit: z.enum(['none', 'docs-only', 'lane', 'full']),
    deploy: z.boolean(),
  })
  .strict();

const modelSchema = z
  .object({
    tier: z.enum(['frugal', 'balanced', 'max']),
    thinking: z.enum(['none', 'low', 'medium', 'high']),
  })
  .strict();

const limitsSchema = z
  .object({
    max_turns: z.number().int().positive(),
    wall_clock_ms: z.number().int().positive(),
    max_cost_usd: z.number().nonnegative(),
  })
  .strict();

const parallelSafetySchema = z
  .object({
    file_ownership: z.array(z.string().min(1)),
    exclusive: z.boolean(),
  })
  .strict();

const gatesSchema = z
  .object({
    produces_evidence_for: z.array(z.string().min(1)),
    may_approve: z.array(z.string().min(1)),
  })
  .strict();

const mcpGrantSchema = z
  .object({
    server: z.string().min(1),
    tools: z.array(z.string().min(1)),
  })
  .strict();

// `@forge/extensions/agents`'s own `ToolGrant` shape (15 §15.3.2), reused directly for `ceiling.tools`
// -- a ceiling *is* that same tool-grant concept, not a new one this schema should redeclare.
const toolGrantSchema = z
  .object({
    write: z.boolean().optional(),
    exec: z.array(z.string().min(1)).optional(),
    network: z.enum(['none', 'allowlist', 'full']).optional(),
    deploy: z.boolean().optional(),
    allowlistHosts: z.array(z.string().min(1)).optional(),
  })
  .strict();

const ceilingSchema = z
  .object({
    tools: toolGrantSchema,
  })
  .strict();

const promptSchema = z
  .object({
    system: z.string().min(1),
    briefs: z.record(z.string(), z.string().min(1)).optional(),
  })
  .strict();

export const agentDefinitionSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    version: z.string().min(1),
    tier: z.string().min(1),
    extends: z.string().min(1).optional(),
    mandate: z.string().min(1),
    decisions_owned: z.array(z.string().min(1)),
    persona: personaSchema,
    inputs: inputsSchema,
    outputs: z.array(outputSchema).min(1),
    kb_write: z.array(z.string().min(1)),
    kb_propose: z.array(z.string().min(1)).optional(),
    tools: toolsSchema,
    model: modelSchema,
    limits: limitsSchema,
    parallel_safety: parallelSafetySchema,
    gates: gatesSchema,
    frameworks: z.array(z.string().min(1)).optional(),
    skills: z.array(z.string().min(1)).optional(),
    mcp: z.array(mcpGrantSchema).optional(),
    ceiling: ceilingSchema.optional(),
    prompt: promptSchema,
  })
  .strict();
