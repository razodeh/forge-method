/**
 * The minimal `jsdom`-backed DOM surface `mermaid` requires to parse at all — see
 * `SPEC-QUESTIONS.md` Q45 for why a real browser-oriented Mermaid parser is used (over `08`
 * §8.11.3's own kinds, which `@mermaid-js/parser`'s DOM-free grammars do not yet cover) and why
 * `jsdom` — a pure-JS DOM emulation library with no rendering engine, no network access and no
 * external process — is not the "browser" `02` §2.1 and `08` §8.11.2 rule 3 are guarding against.
 *
 * Installed once per process, at module load, not per call: `mermaid` reads these globals lazily on
 * first use, and redefining `globalThis.navigator` a second time throws (it is a getter-only
 * property on some Node versions) — `installDomShim` guards against exactly that. Also skips
 * installing at all when `globalThis.document` already exists for any reason (a host process that is
 * itself a browser or already-DOM'd environment, a test runner's own jsdom environment, or a second
 * copy of this module in a bundle that split it) — this module supplies a DOM only when one is
 * genuinely absent, never overwrites one that is already there.
 *
 * @see SPEC-QUESTIONS.md Q45
 * @see PLAN-M3.md P1
 */
import { JSDOM } from 'jsdom';

let installed = false;

/** Idempotent: safe to call from every module that needs the shim, any number of times, and safe to
 * call in a process that already has its own `document` for an unrelated reason. */
export function installDomShim(): void {
  if (installed) return;
  installed = true;
  if (typeof globalThis.document !== 'undefined') return;

  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const { window } = dom;

  globalThis.window = window as unknown as Window & typeof globalThis;
  globalThis.document = window.document;
  globalThis.SVGElement = window.SVGElement;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;

  // `navigator` is a getter-only property of the global object on modern Node — a plain assignment
  // throws `TypeError: Cannot set property navigator of #<Object> which has only a getter`.
  Object.defineProperty(globalThis, 'navigator', {
    value: window.navigator,
    configurable: true,
  });
}

installDomShim();
