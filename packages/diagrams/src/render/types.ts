/**
 * `renderHtml`'s own input surface — `08` §8.11.8's theming paragraph (light/dark pair, shape
 * legend).
 *
 * @see specs/08 §8.11.8
 * @see PLAN-M3.md P5
 */

/** `legend`: `diagrams.legend`-shaped semantic-name -> description pairs (`08` §8.11.8's own
 * "auto-appended to standalone views"), rendered as a list under the diagram. `theme`: two Mermaid
 * theme names (already resolved — see below) to switch between client-side, matching the viewer's
 * own `prefers-color-scheme` — defaults to Mermaid's own `default`/`dark` themes when omitted.
 *
 * `08` §8.11.9's own worked config also names a third theming field, `palette: colorblind-safe`
 * (alongside `light`/`dark`) — deliberately not part of this type. No spec document gives concrete
 * colours to implement a real colour-blind-safe palette against (`SPEC-QUESTIONS.md` Q49), and
 * resolving a project's style profile into one is customization surface **C16** (`15` §15.1)'s job,
 * not this rendering primitive's — `theme` here takes an already-resolved pair of theme names (or,
 * once C16 exists, could just as well take a resolved `themeVariables` override object) rather than
 * a raw project-config `palette` setting it has no way to interpret on its own. */
export interface RenderOptions {
  readonly legend?: Readonly<Record<string, string>>;
  readonly theme?: { readonly light: string; readonly dark: string };
}
