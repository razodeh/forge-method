/**
 * `renderHtml` — `08` §8.11.8's HTML fallback rendering path, checked against a real `jsdom` Window
 * (`runScripts: 'dangerously'`) actually executing the emitted document's own scripts, not just
 * against static assertions about the HTML string.
 *
 * jsdom has no real layout engine, so two real-browser SVG geometry methods it never implements
 * (`SVGElement.getBBox`, `getComputedTextLength`) are polyfilled here in the *test* only — verified
 * empirically (a throwaway script run outside vitest) to be exactly what a plain, un-polyfilled jsdom
 * Window is missing for Mermaid's own post-layout SVG sizing step; a real browser, the only realistic
 * place this self-contained file is opened, implements both natively and needs no such polyfill.
 * `renderHtml` itself ships no polyfill of any kind — this is a test-environment concession only.
 *
 * @see specs/08 §8.11.8
 * @see SPEC-QUESTIONS.md Q48
 * @see PLAN-M3.md P5
 */
import http from 'node:http';
import https from 'node:https';

import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { BUNDLED_MERMAID_VERSION, DIAGRAM_KINDS, renderHtml } from '../../src/index.ts';

const WORKED_EXAMPLES: Record<(typeof DIAGRAM_KINDS)[number], string> = {
  flowchart: `flowchart TB
  A[Start] --> B{Decision}
  B -->|yes| C[End]
  B -->|no| A`,
  sequenceDiagram: `sequenceDiagram
  Alice->>Bob: Hello
  Bob-->>Alice: Hi`,
  'stateDiagram-v2': `stateDiagram-v2
  [*] --> Idle
  Idle --> Running
  Running --> [*]`,
  erDiagram: `erDiagram
  CUSTOMER ||--o{ ORDER : places`,
  gantt: `gantt
  title A Gantt
  section S1
  Task1: 2024-01-01, 3d`,
  C4Context: `C4Context
  Person(customer, "Customer")
  System(sys, "System")
  Rel(customer, sys, "uses")`,
  C4Container: `C4Container
  Container(api, "API")
  Container(web, "Web")
  Rel(web, api, "calls")`,
  C4Component: `C4Component
  Component(handler, "Handler")
  Component(store, "Store")
  Rel(handler, store, "reads")`,
  C4Deployment: `C4Deployment
  Deployment_Node(node1, "Node") {
    Container(api, "API")
    Container(worker, "Worker")
    Rel(api, worker, "enqueues")
  }`,
  quadrantChart: `quadrantChart
  title Reach vs influence
  x-axis Low --> High
  y-axis Low --> High
  Campaign A: [0.3, 0.6]`,
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Loads `html` into a real `jsdom` Window, executes its own inline scripts, polyfills the two
 * jsdom-never-implements SVG geometry methods Mermaid's post-render layout step needs, spies on
 * `XMLHttpRequest.prototype.send`, and waits for the bootstrap script's own completion signal
 * (`document.body.dataset.forgeRender`, set by `renderHtml`'s own bootstrap — see `render.ts`). */
async function runRenderedHtml(
  html: string,
): Promise<{ readonly window: InstanceType<typeof JSDOM>['window']; readonly xhrSendCalls: number }> {
  const dom = new JSDOM(html, { runScripts: 'dangerously' });

  // jsdom implements no real SVG layout engine, so it never implements these two real-browser SVG
  // geometry methods, which Mermaid's own post-render sizing step calls — a throwaway script run
  // outside vitest confirmed this is exactly (and only) what an un-polyfilled jsdom Window is
  // missing here; `renderHtml` itself ships no such polyfill and needs none in a real browser.
  const svgProto = dom.window.SVGElement.prototype as unknown as {
    getBBox: () => DOMRect;
    getComputedTextLength: () => number;
  };
  svgProto.getBBox = () => ({ x: 0, y: 0, width: 100, height: 20 }) as DOMRect;
  svgProto.getComputedTextLength = () => 50;

  let xhrSendCalls = 0;
  const xhrProto = dom.window.XMLHttpRequest.prototype as unknown as { send: () => void };
  xhrProto.send = () => {
    xhrSendCalls += 1;
  };

  for (let i = 0; i < 100; i += 1) {
    if (dom.window.document.body.getAttribute('data-forge-render') !== null) {
      return { window: dom.window, xhrSendCalls };
    }
    await wait(20);
  }
  throw new Error('renderHtml output never signalled render completion within the test timeout');
}

describe('renderHtml', () => {
  it.each(DIAGRAM_KINDS)('renders a real SVG for a worked %s example with no thrown error', async (kind) => {
    const html = renderHtml(WORKED_EXAMPLES[kind]);
    const { window } = await runRenderedHtml(html);
    expect(window.document.body.getAttribute('data-forge-render')).toBe('ok');
    const svg = window.document.querySelector('.mermaid svg');
    expect(svg).not.toBeNull();
    expect(svg?.outerHTML.length).toBeGreaterThan(0);
  });

  it.each(DIAGRAM_KINDS)(
    'performs no network I/O at the Node process level while rendering a worked %s example',
    async (kind) => {
      // Stronger than checking the jsdom Window alone (a gauntlet critic found the previous version
      // of this test only proved jsdom itself has no `fetch`, which is true regardless of what the
      // code under test does): this guards the real process-level `http`/`https`/global `fetch` a
      // dependency could reach for even outside the jsdom sandbox, and fails loudly (throws) rather
      // than silently recording a call, so a real network attempt cannot be missed.
      const networkAttempts: string[] = [];
      const originalHttpRequest = http.request;
      const originalHttpsRequest = https.request;
      const originalFetch = globalThis.fetch;
      http.request = () => {
        networkAttempts.push('http.request');
        throw new Error('unexpected http.request call during renderHtml render pass');
      };
      https.request = () => {
        networkAttempts.push('https.request');
        throw new Error('unexpected https.request call during renderHtml render pass');
      };
      globalThis.fetch = () => {
        networkAttempts.push('fetch');
        throw new Error('unexpected fetch call during renderHtml render pass');
      };

      try {
        const html = renderHtml(WORKED_EXAMPLES[kind]);
        const { xhrSendCalls } = await runRenderedHtml(html);
        expect(xhrSendCalls).toBe(0);
        expect(networkAttempts).toEqual([]);
      } finally {
        http.request = originalHttpRequest;
        https.request = originalHttpsRequest;
        globalThis.fetch = originalFetch;
      }
    },
  );

  it('contains no `<script src=` and no external URL in the HTML it authors, outside the vendored bundle', () => {
    const html = renderHtml(WORKED_EXAMPLES.flowchart);
    // The vendored Mermaid bundle legitimately contains `http://`/`https://` substrings (SVG/XML
    // namespace URIs, license comments, doc links in error messages — SPEC-QUESTIONS.md Q48) — the
    // meaningful check is scoped to the wrapper this function itself authors, found by locating the
    // two script boundaries this template always emits.
    const bundleStart = html.indexOf('<script>"use strict"');
    const bundleEnd = html.indexOf('</script>', bundleStart);
    expect(bundleStart).toBeGreaterThan(-1);
    const wrapperOnly = html.slice(0, bundleStart) + html.slice(bundleEnd);
    expect(wrapperOnly).not.toContain('<script src=');
    expect(wrapperOnly).not.toMatch(/https?:\/\//);
  });

  it('appends a legend when one is supplied', () => {
    const html = renderHtml(WORKED_EXAMPLES.flowchart, {
      legend: { service: 'rectangle', datastore: 'cylinder' },
    });
    expect(html).toContain('forge-diagram-legend');
    expect(html).toContain('rectangle');
    expect(html).toContain('cylinder');
  });

  it('omits the legend element entirely when none is supplied', () => {
    // The static `<style>` block always declares the `.forge-diagram-legend` rule (harmless with no
    // matching element) — the real check is that no such *element* is emitted.
    const html = renderHtml(WORKED_EXAMPLES.flowchart);
    expect(html).not.toContain('<ul class="forge-diagram-legend">');
  });

  it('omits the legend element when an empty legend object is explicitly supplied', () => {
    const html = renderHtml(WORKED_EXAMPLES.flowchart, { legend: {} });
    expect(html).not.toContain('<ul class="forge-diagram-legend">');
  });

  it('sorts legend entries deterministically regardless of the caller-supplied key order', () => {
    const first = renderHtml(WORKED_EXAMPLES.flowchart, { legend: { zebra: 'z', apple: 'a' } });
    const second = renderHtml(WORKED_EXAMPLES.flowchart, { legend: { apple: 'a', zebra: 'z' } });
    expect(first).toBe(second);
  });

  it('escapes `<`, `>` and `&` in the diagram source so it cannot break out of the `<pre>` element', () => {
    const html = renderHtml('flowchart TB\n  A["<img onerror=x> & </pre> stuff"] --> B');
    expect(html).not.toContain('<img onerror=x>');
    expect(html).not.toContain('</pre> stuff');
    expect(html).toContain('&lt;img onerror=x&gt;');
    expect(html).toContain('&amp;');
  });

  it('never lets an adversarial `</script>`-shaped source or theme value close the inline script early', () => {
    const hostile = '</script><script>window.pwned = true;</script>';
    const html = renderHtml(hostile, { theme: { light: hostile, dark: 'dark' } });
    // Exactly the two real closing tags this template itself always emits (one for the vendored
    // bundle, one for the bootstrap) — any more would mean an adversarial value broke out.
    expect(html.split('</script>').length - 1).toBe(2);
  });

  it('uses the built-in `default`/`dark` Mermaid themes when no `theme` option is given', () => {
    const html = renderHtml(WORKED_EXAMPLES.flowchart);
    expect(html).toContain('"default"');
    expect(html).toContain('"dark"');
  });

  it('is a pure function of its inputs: identical calls produce byte-identical output', () => {
    const first = renderHtml(WORKED_EXAMPLES.flowchart, { legend: { a: 'b' } });
    const second = renderHtml(WORKED_EXAMPLES.flowchart, { legend: { a: 'b' } });
    expect(second).toBe(first);
  });

  it('exports the real, installed Mermaid package version', () => {
    expect(BUNDLED_MERMAID_VERSION).toBe('11.17.2');
  });
});
