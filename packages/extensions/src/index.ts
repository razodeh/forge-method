/**
 * `@forge/extensions` — customization layering: overlays, skills, MCP, presets, per `15`.
 *
 * `02` §2.2 places this package below the engine and above `schemas`, `core`, `templates` and, since
 * `PLAN-M11.md` P1's own recorded Surface deviation, `vcs` (the real git-channel overlay/module
 * fetch).
 *
 * @see specs/15
 * @see specs/02 §2.2
 */
export * from './agents/index.ts';
export * from './compile/index.ts';
export * from './install/index.ts';
export * from './invariants/index.ts';
export * from './mcp/index.ts';
export * from './merge/index.ts';
export * from './module/index.ts';
export * from './presets/index.ts';
export * from './resolve/index.ts';
export * from './skills/index.ts';
export * from './style/index.ts';
export * from './workflows/index.ts';
