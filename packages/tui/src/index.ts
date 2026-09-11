/**
 * `@forge/tui` — `04`'s own Ink application: a view + command emitter over `@forge/engine`, holding no
 * domain state of its own beyond UI state.
 *
 * @see specs/04
 * @see PLAN-M9.md
 */
export { detectRenderMode, type RenderMode } from './env.ts';
export { LinearView, describeEvent, type LinearViewProps } from './linear.tsx';
export * from './state/index.ts';
