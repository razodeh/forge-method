/**
 * `20` §20.10 S4 — "A step granted `network: none` cannot reach the network."
 *
 * `PLAN-M11.md` P9's own mandate: confirm no genuinely adversarial "attempt a real network call
 * under `network: none`" test exists anywhere (confirmed true — `packages/adapter-kit/test/grants/
 * network.test.ts` only ever asserts `isHostAllowed`'s own return value, never drives a real network
 * attempt against a real target), then build one against a real, local listener.
 *
 * **What this proves, and what it honestly cannot prove.** `isHostAllowed` (`../../src/grants/
 * network.ts`) is the one real, exported function in this codebase that decides whether a given host
 * may be reached under a `ToolGrant` — confirmed by direct inspection that it is the *only* such
 * function (`@forge/adapter-claude-code`'s own `mapToolGrantToAllowedTools` builds `WebFetch(domain:
 * ...)` rule strings directly, without ever calling it). Also confirmed, by grepping every `src/`
 * directory in the workspace: `isHostAllowed` has **zero production call sites** anywhere in FORGE
 * today. The actual, structural enforcement of `network: none` in a real, live session is entirely
 * delegated to the external Claude Code CLI/SDK process, which never emits a `WebFetch`/`WebSearch`
 * tool call outside its own allowed-tools list under `deny-unlisted` mode — already confirmed, via a
 * real `FORGE_LIVE=1` run, to genuinely refuse an unlisted tool (`filesystem.ts`'s own
 * `checkC3ToolRestriction` doc comment records that live confirmation for the identical mechanism).
 * That external process cannot be driven from this workspace's own automated suite without a live
 * API key, the exact reason M7's own live-run checkpoint was deferred and never re-run automatically.
 *
 * So this test proves the one thing achievable here without a live external process: the real,
 * exported gate function every future in-process network-issuing caller (a future adapter, an MCP
 * proxy, ...) is meant to consult genuinely distinguishes "reach this real listener" from "do not,"
 * against a *real* local TCP listener rather than a mocked one — with a negative control proving the
 * exact same harness would have detected a real connection had the gate not refused it, so the
 * "blocked" result is not merely "nothing was ever capable of reaching the listener at all." The
 * zero-production-callers fact above is disclosed here and in `SPEC-QUESTIONS.md` Q169 rather than
 * silently assumed away — wiring a real call site was judged out of this piece's own scope (no
 * existing FORGE component makes an in-process network call on an agent's behalf today; inventing one
 * only to have something to gate would be new, disproportionate runtime behaviour this piece's own
 * mandate explicitly warns against).
 *
 * **What this file is not, named explicitly so a future maintainer does not read this suite being
 * green as "S4 is fully covered end to end":** a real production-path regression for `network: 'none'`
 * — Claude Code's own `WebFetch`/`WebSearch` tools reappearing in the allowed-tools list — is *not*
 * caught by anything in this file. That regression already has real, automated coverage elsewhere:
 * `packages/adapter-claude-code/test/tool-grant.test.ts` asserts `mapToolGrantToAllowedTools` never
 * emits `WebFetch`/`WebSearch` for `network: 'none'`, against the one function that actually builds
 * the real, live `--allowedTools` value. This file and that one are deliberately two different tests
 * of two different mechanisms — this one adversarial-and-local (a real listener, network denied by a
 * currently-uncalled gate function), that one a direct assertion against the one function genuinely
 * wired into a live session — neither substitutes for the other, and this file's own name should not
 * be read as claiming the live-session mechanism's own coverage as well.
 *
 * @see specs/20 §20.1
 * @see specs/20 §20.10 S4
 * @see specs/21 §21 "Security (20)"
 * @see SPEC-QUESTIONS.md Q169
 * @see PLAN-M11.md P9
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { isHostAllowed } from '../../src/grants/network.ts';
import type { ToolGrant } from '../../src/types/tool-grant.ts';

function grant(overrides: Partial<ToolGrant> = {}): ToolGrant {
  return { read: true, write: true, exec: false, network: 'none', ...overrides };
}

interface RealListener {
  readonly host: string;
  readonly port: number;
  readonly hitCount: () => number;
  readonly close: () => Promise<void>;
}

/** A real, local, listening HTTP server on `127.0.0.1` — the "real, local test listener" `PLAN-M11.md`
 * P9 calls for, as opposed to a mock that could never actually be reached by anything. */
async function startRealListener(): Promise<RealListener> {
  let hits = 0;
  const server = createServer((_req, res) => {
    hits += 1;
    res.writeHead(200);
    res.end('reached');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return {
    host: '127.0.0.1',
    port: address.port,
    hitCount: () => hits,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
}

/**
 * The real, in-process network client every future FORGE caller of `isHostAllowed` would need to
 * write: check the gate first, and only make the real request if it permits the host. This function
 * is test-authored (see this file's own doc comment on why no such production caller exists yet), but
 * `isHostAllowed` itself is the real, unmodified, exported production function — the gate under test,
 * not a stand-in for it.
 */
async function attemptRealNetworkCall(
  grantToCheck: ToolGrant,
  listener: RealListener,
): Promise<'blocked-before-connecting' | 'reached'> {
  if (!isHostAllowed(grantToCheck, listener.host)) return 'blocked-before-connecting';
  const response = await fetch(`http://${listener.host}:${String(listener.port)}/`);
  await response.text();
  return 'reached';
}

describe('S4 — a real local listener is never reached under network: none', () => {
  let listener: RealListener | undefined;

  afterEach(async () => {
    await listener?.close();
    listener = undefined;
  });

  it('network: none blocks the gate before any real connection is attempted, and the listener sees zero hits', async () => {
    listener = await startRealListener();
    const outcome = await attemptRealNetworkCall(grant({ network: 'none' }), listener);

    expect(outcome).toBe('blocked-before-connecting');
    expect(listener.hitCount()).toBe(0);
  });

  it("negative control: the identical listener, gate, and call path genuinely reaches the listener under network: 'full' -- proving the block above is real, not a vacuous test that nothing could ever reach", async () => {
    listener = await startRealListener();
    const outcome = await attemptRealNetworkCall(grant({ network: 'full' }), listener);

    expect(outcome).toBe('reached');
    expect(listener.hitCount()).toBe(1);
  });

  it("network: 'allowlist' with a different, unrelated host allowlisted still blocks the real listener -- an adversarial step cannot reach an unlisted host merely because *some* host is granted", async () => {
    listener = await startRealListener();
    const outcome = await attemptRealNetworkCall(
      grant({ network: 'allowlist', allowlistHosts: ['registry.npmjs.org'] }),
      listener,
    );

    expect(outcome).toBe('blocked-before-connecting');
    expect(listener.hitCount()).toBe(0);
  });

  it("network: 'allowlist' naming the listener's own real host by address reaches it for real", async () => {
    listener = await startRealListener();
    const outcome = await attemptRealNetworkCall(
      grant({ network: 'allowlist', allowlistHosts: ['127.0.0.1'] }),
      listener,
    );

    expect(outcome).toBe('reached');
    expect(listener.hitCount()).toBe(1);
  });
});
