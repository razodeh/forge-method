/**
 * `createAdapter` — the real `AdapterFactory` (`@forge/adapter-kit/registry`) this module exports so a
 * caller above `adapter-kit` (`@forge/cli`'s own real dispatcher, `PLAN-M12.md` P1) can construct a
 * real `ClaudeCodeAdapter` through `loadAdapterFactory`'s own dynamic `import()` — never through a
 * literal `import { ClaudeCodeAdapter } from '@forge/adapter-claude-code'` in that caller's own source,
 * which `forge-boundaries/no-platform-concept` forbids outside `packages/adapter-*`.
 *
 * @see specs/07 §7.1
 * @see specs/07 §7.3
 */
import type { AdapterFactory } from '@forge/adapter-kit/registry';

import { ClaudeCodeAdapter } from './adapter.ts';
import { claudeCodeAdapterConfigSchema } from './config.ts';

export const createAdapter: AdapterFactory = (options) => {
  const config = claudeCodeAdapterConfigSchema.parse(options.config ?? {});
  return new ClaudeCodeAdapter({ config, env: options.env, now: options.now });
};
