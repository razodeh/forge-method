/**
 * `agentOverlaySchema`, `rosterConfigSchema` — `15` §15.3's document shapes.
 *
 * Fields with a concrete shape somewhere in `15`'s own worked examples (`model`, `tools`, `limits`,
 * `briefs`) are typed precisely; fields §15.3.1's table names but never shows a shape for (`persona`,
 * `prompt.system`, `decisions_owned`, `inputs`/`outputs`, `kb_write`/`kb_propose`,
 * `parallel_safety.file_ownership`) are left as loosely-typed passthroughs rather than an invented
 * shape with no spec source — matching `SPEC-QUESTIONS.md` Q18/Q20's precedent from M1.
 *
 * @see specs/15 §15.3
 * @see PLAN-M2.md P3
 */
import { overlayArrayField } from '../merge/schema.ts';
import { z } from 'zod';

const IMMUTABLE_KEYS = ['gates', 'tier', 'id'] as const;

/** Every field `agentOverlaySchema` recognises, kept in sync with its own `.object({...})` shape. */
const KNOWN_OVERLAY_KEYS = [
  'persona',
  'mandate',
  'decisions_owned',
  'prompt',
  'briefs',
  'model',
  'limits',
  'skills',
  'mcp',
  'frameworks',
  'inputs',
  'outputs',
  'kb_write',
  'kb_propose',
  'tools',
  'parallel_safety',
] as const;

const toolGrantSchema = z
  .object({
    write: z.boolean().optional(),
    exec: overlayArrayField(z.string()).optional(),
    network: z.enum(['none', 'allowlist', 'full']).optional(),
    deploy: z.boolean().optional(),
    allowlistHosts: overlayArrayField(z.string()).optional(),
  })
  .strict();

const modelSchema = z
  .object({
    tier: z.string().min(1).optional(),
    thinking: z.boolean().optional(),
  })
  .strict();

const limitsSchema = z.record(z.string(), z.union([z.number(), z.string(), z.boolean()]));

const briefsSchema = z.record(z.string(), z.string().min(1));

const mcpGrantSchema = z
  .object({
    server: z.string().min(1),
    tools: z.array(z.string().min(1)),
  })
  .strict();

/**
 * The agent-overlay document shape, before `@forge/extensions/resolve` reads and strips `$extends`/
 * `$description` — this schema validates everything *else* an overlay may carry.
 *
 * `.strict()` alone would reject `gates`/`tier`/`id` as "unrecognised key," which is true but not the
 * point: these are real base-agent fields an overlay specifically must not touch (`15` §15.3.1's ❌
 * row), so `superRefine` names them by their actual reason instead.
 */
export const agentOverlaySchema = z
  .object({
    persona: z.record(z.string(), z.unknown()).optional(),
    mandate: z.string().min(1).optional(),
    decisions_owned: overlayArrayField(z.string()).optional(),
    prompt: z
      .object({
        system: z.string().min(1).optional(),
        briefs: briefsSchema.optional(),
      })
      .strict()
      .optional(),
    briefs: briefsSchema.optional(),
    model: modelSchema.optional(),
    limits: limitsSchema.optional(),
    skills: overlayArrayField(z.string()).optional(),
    mcp: overlayArrayField(mcpGrantSchema).optional(),
    frameworks: overlayArrayField(z.string()).optional(),
    inputs: overlayArrayField(z.string()).optional(),
    outputs: overlayArrayField(z.string()).optional(),
    kb_write: overlayArrayField(z.string()).optional(),
    kb_propose: overlayArrayField(z.string()).optional(),
    tools: toolGrantSchema.optional(),
    parallel_safety: z
      .object({
        file_ownership: overlayArrayField(z.string()).optional(),
      })
      .strict()
      .optional(),
  })
  .catchall(z.unknown())
  .superRefine((data, ctx) => {
    for (const key of IMMUTABLE_KEYS) {
      if (key in data) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `"${key}" cannot be set by an overlay — ${
            key === 'gates'
              ? 'separation of duties is not user-editable.'
              : 'create a new agent instead.'
          }`,
        });
      }
    }
    // `.catchall(z.unknown())` above exists only to let the immutable keys through to the check
    // above with their own message, instead of zod's generic "unrecognised key" — it must not also
    // silently accept a genuine typo in every *other* field name.
    const known = new Set<string>([...KNOWN_OVERLAY_KEYS, ...IMMUTABLE_KEYS]);
    for (const key of Object.keys(data)) {
      if (!known.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `Unrecognised field "${key}".`,
        });
      }
    }
  });

export type AgentOverlay = z.infer<typeof agentOverlaySchema>;
export type ToolGrantInput = z.infer<typeof toolGrantSchema>;

const splitSiblingSchema = z
  .object({
    id: z.string().min(1),
    skills: z.array(z.string().min(1)).optional(),
    file_ownership: z.array(z.string().min(1)).optional(),
  })
  .strict();

const customAgentSchema = z
  .object({
    id: z.string().min(1),
    decisions_owned: z.array(z.string().min(1)).optional(),
    outputs: z.array(z.string().min(1)).optional(),
    file_ownership: z.array(z.string().min(1)).optional(),
    tools: toolGrantSchema.optional(),
  })
  .strict();

/** `15` §15.3.3's `roster:` config shape. */
export const rosterConfigSchema = z
  .object({
    preset: z.string().min(1).optional(),
    enable: z.array(z.string().min(1)).optional(),
    disable: z.array(z.string().min(1)).optional(),
    alias: z.record(z.string(), z.string().min(1)).optional(),
    add: z.array(customAgentSchema).optional(),
    split: z.record(z.string(), z.array(splitSiblingSchema)).optional(),
  })
  .strict();

export type RosterConfig = z.infer<typeof rosterConfigSchema>;
export type CustomAgent = z.infer<typeof customAgentSchema>;
export type SplitSibling = z.infer<typeof splitSiblingSchema>;
