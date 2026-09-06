/**
 * `@forge/extensions` — customization layering: overlays, skills, MCP, presets, per `15`.
 *
 * `02` §2.2 places this package below the engine and above only `schemas`, `core` and `templates`.
 *
 * @see specs/15
 * @see specs/02 §2.2
 */
export * from './agents/index.ts';
export * from './mcp/index.ts';
export * from './merge/index.ts';
export * from './resolve/index.ts';
export * from './skills/index.ts';
export * from './workflows/index.ts';
