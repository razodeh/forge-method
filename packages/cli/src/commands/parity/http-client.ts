/**
 * The `http` surface's own loopback client (`specs/22` M16 P8, `13` F-TEST-9, Q294 Decision 7): makes
 * ONE real request against the server `http-server.ts` started, and refuses any host but loopback.
 *
 * **The refusal is real, enforced code, not merely "nothing else is ever passed in".** Q294 Decision
 * 7's own sentence is "a client that refuses any other host" — a property of THIS function, checked
 * directly against its own `host` argument before anything else runs, never an argument this module
 * simply never happens to receive a bad value for. `observe-http.ts`'s own caller always passes
 * `http-server.ts`'s own {@link LOOPBACK_HOST}, so the refusal is not reachable through a real
 * declaration today — but it is reachable, and tested, by calling this function directly with a
 * non-loopback `host` (this piece's own report explains why that directness is the point).
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/plans/PLAN-M16.md P8
 * @see process/SPEC-QUESTIONS.md Q294 Decision 7
 */
import http from 'node:http';

import { ForgeError } from '@forge/core/errors';

import type { HttpRequestSpec } from './declaration-types.ts';
import type { RawHttpObservation } from './observe-types.ts';
import { LOOPBACK_HOST } from './http-server.ts';

/** The ONLY hosts this client will ever contact — exactly loopback, under any of its three ordinary
 * spellings ({@link LOOPBACK_HOST} itself plus the two others that name the identical interface, so
 * a case whose declaration somehow carried one of those is not maliciously "a different host",
 * merely a spelling this client still honours). */
const ALLOWED_HOSTS: ReadonlySet<string> = new Set([LOOPBACK_HOST, 'localhost', '::1']);

/** Both limits are REQUIRED, deliberately, with no default of this module's own: `observe-http.ts`
 * (this client's one real caller) resolves a case's own `timeoutMs`/`outputCapBytes` against
 * `STORED_COMMAND_LIMITS`, the identical fallback `observeOneCase` already uses for a
 * `process`/`library` case's own pair — one source of truth for "what a case gets when it declares
 * no limit of its own", not a second, independently-chosen number this module would own. */
export interface SendHttpRequestOptions {
  readonly host: string;
  readonly port: number;
  readonly request: HttpRequestSpec;
  readonly timeoutMs: number;
  readonly capBytes: number;
}

/**
 * Sends exactly one real HTTP request and returns its normalised-shape raw observation.
 *
 * @throws {ForgeError} `RUN-151` if `options.host` is not loopback — checked FIRST, before any
 * socket is ever opened.
 * @throws {ForgeError} `RUN-150` if the request cannot complete (a connection error, the request's
 * own timeout, or a response over its own cap) — a typed, distinct failure, never a truncated
 * observation silently returned as complete.
 */
export async function sendHttpRequest(
  options: SendHttpRequestOptions,
): Promise<RawHttpObservation> {
  if (!ALLOWED_HOSTS.has(options.host)) {
    throw new ForgeError('RUN-151', { host: options.host });
  }

  const { timeoutMs, capBytes } = options;
  const { method, path, headers, body } = options.request;

  return new Promise<RawHttpObservation>((resolve, reject) => {
    const fail = (detail: string): void => {
      reject(new ForgeError('RUN-150', { method, path, detail }));
    };

    // `http.request`'s own `ClientRequest` constructor validates the method, every header name/
    // value, and the path internally (`validateHeaderName`/`validateHeaderValue`/its own
    // "unescaped characters" request-line check) and throws a SYNCHRONOUS, unwrapped `TypeError`
    // for anything it refuses -- confirmed by direct experiment (this piece's own report): a header
    // name containing a colon, or a path containing a literal space, both throw this way, even
    // though NEITHER carries an ASCII control character `declaration.ts`'s own load-time checks
    // were ever asked to catch for every possible case (that module's own header-name token check,
    // added alongside this fix, closes the specific colon-shaped case; this `try`/`catch` is what
    // keeps ANY other shape Node itself refuses from doing the same). Node's `Promise` constructor
    // would otherwise catch this synchronous throw itself and reject with the RAW `TypeError` --
    // which `observe-http.ts`'s own `observeOneHttpCase` cannot recognise as `isForgeError`, so it
    // re-throws instead of reporting one case's own scoped failure, crashing this surface's entire
    // cases loop. Caught here and converted to the IDENTICAL typed `RUN-150` every other per-request
    // failure already becomes, so an unanticipated future Node-level validation gap fails ONE case
    // cleanly rather than the whole surface.
    let request: http.ClientRequest;
    try {
      request = http.request(
        {
          host: options.host,
          port: options.port,
          path,
          method,
          headers,
          timeout: timeoutMs,
        },
        (response) => {
          const chunks: Buffer[] = [];
          let received = 0;
          let overCap = false;
          response.on('data', (chunk: Buffer) => {
            if (overCap) return;
            received += chunk.length;
            if (received > capBytes) {
              overCap = true;
              request.destroy();
              fail(`the response body exceeded its ${String(capBytes)}-byte cap and was cut off`);
              return;
            }
            chunks.push(chunk);
          });
          response.on('end', () => {
            if (overCap) return; // already failed via the cap branch above.
            const bytes = new Uint8Array(Buffer.concat(chunks));
            const selected: Record<string, string> = {};
            for (const name of options.request.responseHeaders ?? []) {
              const value = response.headers[name];
              if (value === undefined) continue;
              selected[name] = Array.isArray(value) ? value.join(', ') : value;
            }
            const status = response.statusCode;
            if (status === undefined) {
              fail('the response carried no status code');
              return;
            }
            resolve({
              surface: 'http',
              status,
              headers: selected,
              body: { bytes, text: Buffer.from(bytes).toString('utf8') },
            });
          });
          response.on('error', (cause) => {
            fail(`reading the response failed: ${cause.message}`);
          });
        },
      );
    } catch (cause) {
      fail(
        `the request could not be constructed (${cause instanceof Error ? cause.message : String(cause)})`,
      );
      return;
    }
    // `request.destroy()` with NO error argument emits no `error` event at all (only `close`) --
    // confirmed by direct experiment, not assumed: without passing one explicitly here, a genuine
    // request timeout would neither resolve nor reject this promise, hanging forever. Passing an
    // `Error` routes a timeout through the identical `error` handler below, so there is exactly one
    // place that turns a dead request into a settled promise, not two that could drift apart.
    request.on('timeout', () => {
      request.destroy(new Error(`timed out after ${String(timeoutMs)}ms`));
    });
    request.on('error', (cause) => {
      fail(`the request failed: ${cause.message}`);
    });
    if (body !== undefined) request.write(body);
    request.end();
  });
}
