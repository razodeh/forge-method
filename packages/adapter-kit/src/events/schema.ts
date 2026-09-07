/**
 * `adapterEventSchema` — a Zod mirror of `AdapterEvent` (`07` §7.2), one variant per `type`, used by
 * `normalizeAdapterEvent` to validate a raw, adapter-produced object before it becomes a typed
 * `AdapterEvent` the rest of FORGE can trust.
 *
 * @see specs/07 §7.2
 * @see PLAN-M4.md P1
 */
import { z } from 'zod';

import { FORGE_CONTROL_TOKENS } from '../types/control-tokens.ts';

const sessionStartedSchema = z
  .object({
    type: z.literal('session.started'),
    sessionId: z.string().min(1),
    model: z.string().min(1),
    tools: z.array(z.string()),
    meta: z.record(z.string(), z.unknown()),
  })
  .strict();

const textSchema = z
  .object({
    type: z.literal('text'),
    text: z.string(),
    partial: z.boolean(),
    agentPath: z.array(z.string()).optional(),
  })
  .strict();

const thinkingSchema = z
  .object({
    type: z.literal('thinking'),
    text: z.string(),
  })
  .strict();

const toolCallSchema = z
  .object({
    type: z.literal('tool.call'),
    id: z.string().min(1),
    name: z.string().min(1),
    input: z.unknown(),
    agentPath: z.array(z.string()).optional(),
  })
  .strict();

const toolResultSchema = z
  .object({
    type: z.literal('tool.result'),
    id: z.string().min(1),
    ok: z.boolean(),
    summary: z.string(),
    // `.int()`, matching `retry.attempt`/`maxRetries` below — a byte count is exactly as integral as
    // a retry count, and `.int()` also excludes `Infinity` (`Number.isInteger(Infinity) === false`),
    // which `.nonnegative()` alone does not.
    bytes: z.number().int().nonnegative().optional(),
  })
  .strict();

const fileChangedSchema = z
  .object({
    type: z.literal('file.changed'),
    path: z.string().min(1),
    change: z.enum(['created', 'modified', 'deleted']),
  })
  .strict();

const controlSchema = z
  .object({
    type: z.literal('control'),
    token: z.enum(FORGE_CONTROL_TOKENS),
    payload: z.unknown(),
  })
  .strict();

const retrySchema = z
  .object({
    type: z.literal('retry'),
    attempt: z.number().int().nonnegative(),
    maxRetries: z.number().int().nonnegative(),
    reason: z.string(),
    // `.int()` — a delay in milliseconds is exactly as integral as `attempt`/`maxRetries` above; a
    // gauntlet critic found the original `.nonnegative()`-only constraint let `Infinity` through as a
    // "valid" delay.
    delayMs: z.number().int().nonnegative(),
  })
  .strict();

const usageSchema = z
  .object({
    type: z.literal('usage'),
    // `.int()`: a token count is exactly as integral as `retry.attempt`/`maxRetries` — the original
    // `.nonnegative()`-only constraint let `Infinity` through as a "valid" token count (a gauntlet
    // critic's own finding).
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cacheReadTokens: z.number().int().nonnegative().optional(),
    // Not `.int()` — a dollar cost is genuinely fractional — but `.finite()` still excludes `Infinity`
    // explicitly, since nothing else here does for a non-integer field.
    costUsd: z.number().nonnegative().finite().optional(),
  })
  .strict();

const errorSchema = z
  .object({
    type: z.literal('error'),
    code: z.string().min(1),
    message: z.string(),
    retryable: z.boolean(),
  })
  .strict();

const sessionEndedSchema = z
  .object({
    type: z.literal('session.ended'),
    reason: z.enum(['complete', 'aborted', 'error', 'limit']),
  })
  .strict();

/** `07` §7.2's own `AdapterEvent` union, mirrored exactly — one Zod object per `type` variant. */
export const adapterEventSchema = z.discriminatedUnion('type', [
  sessionStartedSchema,
  textSchema,
  thinkingSchema,
  toolCallSchema,
  toolResultSchema,
  fileChangedSchema,
  controlSchema,
  retrySchema,
  usageSchema,
  errorSchema,
  sessionEndedSchema,
]);
