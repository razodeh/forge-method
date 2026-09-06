/**
 * `mcpServerSchema`, `mcpGrantsSchema`, `secretReferenceSchema` — `15` §15.5.1's document shapes.
 *
 * @see specs/15 §15.5.1
 * @see PLAN-M2.md P5
 * @see SPEC-QUESTIONS.md Q34
 */
import { z } from 'zod';

/** `${secret:<name>}` syntax only — resolving what it points to is a runtime concern (`15` §15.5.3). */
export const SECRET_REFERENCE_PATTERN = /^\$\{secret:[A-Za-z0-9_.-]+\}$/;

export const secretReferenceSchema = z.string().regex(SECRET_REFERENCE_PATTERN);

const commonServerFields = {
  id: z.string().min(1),
  timeoutMs: z.number().int().positive().optional(),
  trust: z.enum(['internal', 'vendor', 'community', 'untrusted']),
  readOnly: z.boolean(),
  environments: z.array(z.string().min(1)).optional(),
};

const stdioServerSchema = z
  .object({
    ...commonServerFields,
    transport: z.literal('stdio'),
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
  })
  .strict();

const httpServerSchema = z
  .object({
    ...commonServerFields,
    transport: z.literal('http'),
    url: z.string().min(1),
  })
  .strict();

const sseServerSchema = z
  .object({
    ...commonServerFields,
    transport: z.literal('sse'),
    url: z.string().min(1),
  })
  .strict();

/** `15` §15.5.1's server entry — `stdio` carries `command`/`args`/`env`, `http`/`sse` carry `url`. */
export const mcpServerSchema = z.discriminatedUnion('transport', [
  stdioServerSchema,
  httpServerSchema,
  sseServerSchema,
]);

/**
 * A specific tool name in a tool-level grant array. `'*'` is excluded here — it is the *server-wide*
 * grant sentinel (`SPEC-QUESTIONS.md` Q34), not a real tool name, so `['*']` (or `['search_issues',
 * '*']`) is rejected as malformed rather than silently accepted as an ordinary, useless tool grant
 * that bypasses `grantMode`'s server-wide gate (`15` §15.5.2 rule 2) — the only place a server-wide
 * intent can be expressed is the bare `'*'` value itself.
 */
const toolNameSchema = z
  .string()
  .min(1)
  .refine((value) => value !== '*', {
    message:
      '"*" is the server-wide grant sentinel and must be the whole grant value, not an entry in a tool-name array.',
  });

/**
 * A grant's tool list — `readonly string[]` for a tool-level grant (the default), or the literal
 * `'*'` for a server-wide grant. `15` §15.5.1's own worked example never shows the server-wide shape;
 * `'*'` is this piece's own minimal-invention encoding for it (`SPEC-QUESTIONS.md` Q34).
 */
const toolGrantValueSchema = z.union([z.array(toolNameSchema), z.literal('*')]);

/**
 * The central `grants`/`defaults` block — `role -> server id -> tool grant`. `injectionPosture` is
 * left as a free-form string rather than a closed enum: `15` §15.5.4 names `untrusted-content` as the
 * only value in the worked example but never enumerates the full set, and inventing a closed set with
 * one member would wrongly reject a value a future spec revision adds (`SPEC-QUESTIONS.md` Q18/Q20's
 * "no spec source, don't invent one" precedent).
 */
const grantsFields = {
  grants: z.record(z.string(), z.record(z.string(), toolGrantValueSchema)).optional(),
  defaults: z
    .object({
      grantMode: z.enum(['explicit', 'server-wide']).default('explicit'),
      injectionPosture: z.string().min(1).default('untrusted-content'),
    })
    .strict()
    .optional(),
};

export const mcpGrantsSchema = z.object(grantsFields).strict();

/** The full `mcp:` document — `servers` plus the central `grants`/`defaults` block, together. */
export const mcpConfigSchema = z
  .object({
    servers: z.array(mcpServerSchema),
    ...grantsFields,
  })
  .strict();

export type McpServer = z.infer<typeof mcpServerSchema>;
export type McpGrants = z.infer<typeof mcpGrantsSchema>;
export type McpConfigShape = z.infer<typeof mcpConfigSchema>;
export type ToolGrantValue = z.infer<typeof toolGrantValueSchema>;
