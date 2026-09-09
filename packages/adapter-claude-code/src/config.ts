/**
 * `claudeCodeAdapterConfigSchema` — this adapter's own config shape, read from the opaque
 * `platform.adapterConfig['claude-code']` blob `@forge/schemas/config` hands off unexamined
 * (`SPEC-QUESTIONS.md` Q16/Q25: `@forge/schemas` cannot know a platform-keyed config's shape without
 * importing the adapter, which the boundary graph forbids — this package is the one place that shape
 * is actually defined and validated).
 *
 * @see specs/07 §7.3
 * @see SPEC-QUESTIONS.md Q16
 * @see SPEC-QUESTIONS.md Q25
 * @see PLAN-M7.md P1
 */
import { z } from 'zod';

export const claudeCodeAdapterConfigSchema = z
  .object({
    /** `undefined` = auto-select (P4's own job: prefer `sdk`, fall back to `cli` when the SDK
     * package fails to resolve). An explicit value pins one transport unconditionally. */
    transport: z.enum(['sdk', 'cli']).optional(),
    /** `07` §7.3's own normative default: `true`. Bare mode never reads OAuth/keychain credentials
     * (confirmed directly against the real `claude --help` text this milestone was built against) —
     * reproducible across machines, but strictly requires `ANTHROPIC_API_KEY` (or a Bedrock/Vertex/
     * Foundry credential). `false` lets the project's own config/hooks/CLAUDE.md apply, at the cost
     * of machine-dependent runs (`07` §7.3: "warn that runs become machine-dependent"). */
    bare: z.boolean().optional().default(true),
    /** `15` §15.5.2's own named opt-out: adopt the user's own ambient `.mcp.json` instead of only the
     * step's own granted subset. Defaults to `false` — the safe, isolated-by-default reading. */
    mcp: z
      .object({ adoptHostServers: z.boolean().optional().default(false) })
      .strict()
      .optional()
      .default({ adoptHostServers: false }),
  })
  .strict();

export type ClaudeCodeAdapterConfig = z.infer<typeof claudeCodeAdapterConfigSchema>;
