/**
 * `adapterYamlConfigSchema` — `07` §7.5's own fully-specified `adapter.yaml` shape, matched exactly
 * against its worked example: `id`/`displayName`/`binary`/`minimumVersion`/`versionRegex`/
 * `capabilities`/`invoke.args`+`when`/`events.format`+`map`/`result`/`files.changeDetection`.
 *
 * Two deliberate, disclosed extensions beyond the worked example's own three `events.map` entries
 * (`message`/`tool_call`/`done`): a config author may add further entries mapping any other source
 * shape onto any other real `AdapterEvent` variant (e.g. `error`, `usage`) — `07` §7.5's own wording
 * for this field ("map source fields onto AdapterEvent") is a general mechanism, not a closed
 * three-entry list; the worked example only shows the minimum needed to illustrate it. See
 * `SPEC-QUESTIONS.md` for the full record of `events.format: 'text'`'s own genuinely under-specified
 * shape (07 §7.5 gives it one line — "regex-based extraction (lossy)" — with no field-level schema
 * anywhere in the spec pack) and this package's own honest, disclosed non-support for it.
 *
 * @see specs/07 §7.5
 * @see PLAN-M11.md P7
 */
import { z } from 'zod';

const capabilitiesSchema = z
  .object({
    streaming: z.boolean(),
    sessionResume: z.boolean(),
    structuredOutput: z.boolean(),
    toolAllowlist: z.boolean(),
    cwdIsolation: z.boolean(),
    costReporting: z.enum(['none', 'per-session', 'per-turn']),
  })
  .strict();

const whenRuleSchema = z
  .object({
    if: z.string().min(1),
    args: z.array(z.string()),
  })
  .strict();

const invokeSchema = z
  .object({
    args: z.array(z.string()),
    when: z.array(whenRuleSchema).optional(),
    stdin: z.enum(['none', 'prompt']),
    env: z.record(z.string(), z.string()).optional(),
  })
  .strict();

/** `match` is deliberately `z.record(z.string(), z.unknown())`, not a fixed shape: the worked
 * example's own three entries each match on a different, ad hoc subset of fields
 * (`{type:"message",role:"assistant"}`, `{type:"tool_call"}`, `{type:"done"}`) — `07` §7.5 gives no
 * closed field list a real external tool's own NDJSON vocabulary must draw from. `emit` is likewise a
 * free-form record: its own `type` selects which real `AdapterEvent` variant a matched line becomes,
 * and every other field is a template string (or nested value) resolved against the matched source
 * line — validated structurally once resolved, by `@forge/adapter-kit/events`'s own
 * `normalizeAdapterEvent`, not by this schema. */
const mapEntrySchema = z
  .object({
    match: z.record(z.string(), z.unknown()),
    emit: z.record(z.string(), z.unknown()),
  })
  .strict();

const eventsSchema = z
  .object({
    format: z.enum(['ndjson', 'text']),
    map: z.array(mapEntrySchema),
  })
  .strict();

const resultSchema = z
  .object({
    successExitCodes: z.array(z.number().int()),
    finalTextFrom: z.string().min(1),
  })
  .strict();

const filesSchema = z
  .object({
    changeDetection: z.enum(['git-status', 'fs-watch']),
  })
  .strict();

export const adapterYamlConfigSchema = z
  .object({
    id: z.string().min(1),
    displayName: z.string().min(1),
    binary: z.string().min(1),
    minimumVersion: z.string().min(1),
    versionCommand: z.array(z.string()).optional(),
    versionRegex: z.string().min(1),
    capabilities: capabilitiesSchema,
    invoke: invokeSchema,
    events: eventsSchema,
    result: resultSchema,
    files: filesSchema,
  })
  .strict();

export type AdapterYamlConfig = z.infer<typeof adapterYamlConfigSchema>;
