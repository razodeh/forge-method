/**
 * `renderHtml` — `08` §8.11.8 rendering pipeline, path (b): "emit self-contained HTML that renders
 * client-side with a bundled Mermaid script — this is the default fallback and requires no extra
 * install and no network at render time."
 *
 * @see specs/08 §8.11.8
 * @see SPEC-QUESTIONS.md Q48
 * @see PLAN-M3.md P5
 */
import { getBundledMermaidScript } from './bundle.ts';
import type { RenderOptions } from './types.ts';

const DEFAULT_THEME = { light: 'default', dark: 'dark' } as const;

/** Safe for placement inside HTML element content (never inside an attribute or a `<script>` block —
 * those have their own escaping needs, handled separately). */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** `</script` inside the text of an inline `<script>` element closes it early regardless of the
 * surrounding JS syntax — the HTML parser matches the closing tag before any JS parsing happens at
 * all. Escaping the slash keeps any JS string value byte-identical (`\/` is a redundant-but-valid
 * escape inside a JS string/template literal) while stopping the HTML parser from ever seeing a
 * closing tag. The bundled script does not currently contain this sequence (checked against the
 * pinned build), but a future dependency bump could reintroduce it, so this guard is not optional. */
function escapeScriptClose(script: string): string {
  return script.replace(/<\/script/gi, '<\\/script');
}

/** `JSON.stringify` alone leaves a `</script` substring inside the string value untouched — safe for
 * a well-formed Mermaid theme name, but this keeps every value interpolated into an inline
 * `<script>` block held to the same rule as the bundled script, rather than trusting the
 * caller's `theme` strings to never need it. */
function scriptStringLiteral(value: string): string {
  return escapeScriptClose(JSON.stringify(value));
}

/** `08` §8.11.8: "Shape semantics are declared in `diagrams.legend` and a legend is auto-appended to
 * standalone views." Keys are sorted (not left in the caller's own object-insertion order, and never
 * via `localeCompare`, per R10) so the same logical legend always renders identically regardless of
 * how the caller happened to construct it. */
function renderLegend(legend: Readonly<Record<string, string>>): string {
  // `Object.entries` (rather than `Object.keys` plus an indexed re-lookup) gives each value's real
  // type directly, with no `| undefined` to defensively fall back from — the key always came from
  // this exact object, so a re-lookup could only ever "fail" in a way that never actually happens.
  const entries = Object.entries(legend).sort(([a], [b]) => (a < b ? -1 : 1));
  if (entries.length === 0) return '';
  const items = entries
    .map(
      ([key, value]) => `      <li><strong>${escapeHtml(key)}</strong>: ${escapeHtml(value)}</li>`,
    )
    .join('\n');
  return `\n    <ul class="forge-diagram-legend">\n${items}\n    </ul>`;
}

/**
 * One self-contained HTML document rendering `source` (raw Mermaid diagram text): the pinned Mermaid
 * build inlined as a `<script>` block (never `<script src=`), `source` inlined as escaped text in a
 * `<pre class="mermaid">`, and an optional legend. Zero network calls, zero external references of
 * any kind — opening the file with no network connectivity renders identically to opening it with
 * one. A pure function of its inputs plus the build-time bundled-script constant (R10).
 */
export function renderHtml(source: string, options: RenderOptions = {}): string {
  const theme = options.theme ?? DEFAULT_THEME;
  const legendHtml = options.legend !== undefined ? renderLegend(options.legend) : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>FORGE diagram</title>
<style>
  body { margin: 2rem; font-family: system-ui, sans-serif; }
  .forge-diagram-legend { list-style: none; padding: 0; font-size: 0.875rem; color: #555; }
</style>
</head>
<body>
  <pre class="mermaid">${escapeHtml(source)}</pre>${legendHtml}
  <script>${escapeScriptClose(getBundledMermaidScript())}</script>
  <script>
    (function () {
      var isDark = typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-color-scheme: dark)').matches;
      mermaid.initialize({ startOnLoad: false, theme: isDark ? ${scriptStringLiteral(theme.dark)} : ${scriptStringLiteral(theme.light)} });
      mermaid.run().then(function () {
        document.body.setAttribute('data-forge-render', 'ok');
      }, function (error) {
        document.body.setAttribute('data-forge-render', 'error');
        document.body.setAttribute('data-forge-render-message', String((error && error.message) || error));
      });
    })();
  </script>
</body>
</html>
`;
}
