/**
 * Test-suite network guard.
 *
 * `specs/21` §21.1 denies outbound network access to unit and integration tests, because a suite
 * that silently reaches the network passes on its author's machine and fails everywhere else.
 *
 * **This is a security control, not scaffolding.** Three adversarial reviews of the previous
 * version each found a new escape, because it was a deny-list extended one channel at a time. The
 * allow-list is therefore *positive and closed*: `isPermittedHost` names exactly what may be
 * reached, everything else is denied, and any input whose destination cannot be determined is
 * denied rather than defaulted. That is what makes a host like `127.0.0.1.nip.io` — a real DNS name
 * answered by a public nameserver, which the previous `startsWith('127.')` test waved through —
 * denied by construction rather than by having been anticipated.
 *
 * **Why this file is `.mjs` and not `.ts`.** It must be loadable by `--import` in three places that
 * do not run vitest's TypeScript transform: the test process, a worker thread (fresh module
 * registry, no setup file), and a child process. Keeping one plain-ESM source beats maintaining a
 * second copy of the policy. It is still typechecked — the root `tsconfig.json` sets
 * `allowJs`/`checkJs`, so the JSDoc below is enforced by `pnpm typecheck`.
 *
 * **Delivery.** `scripts/run-tests.mjs` puts `--import <this file>` into `NODE_OPTIONS`. Node
 * applies it to the test process, to every process it spawns, and to every worker thread it starts,
 * so the guard installs itself in each of them at the bottom of this module. Two other approaches
 * were tried and verified not to work: subclassing `Worker` misses `import { Worker } from
 * 'node:worker_threads'`, because Node snapshots a builtin's named exports when it builds the ESM
 * facade; and pushing onto `process.execArgv` is ignored, because Node captured the real list at
 * startup.
 *
 * **Covered channels** — one test each in `test/network-guard.test.ts`: `fetch`; `node:http`,
 * `https`, `net`, `tls`, `http2`; `dgram` addressed and connected; `dns`, `dns.promises` and
 * `Resolver`; `WebSocket`; worker threads including nested and explicit-`execArgv`; child processes;
 * and dynamic `import()` of any of these.
 *
 * @see specs/21 §21.1
 */
// Deliberately NOT static imports. `import dns from 'node:dns'` makes Node build that builtin's ESM
// facade, which snapshots the current value of every export — after which patching the underlying
// module object is invisible to `import { resolve4 } from 'node:dns'`, the spelling ordinary code
// uses. That defect escaped three separate channels in three separate reviews
// (`worker_threads`, `child_process`, `dns`) before being recognised as one cause.
//
// `process.getBuiltinModule` returns the module object *without* constructing the facade, so the
// patches below land before any snapshot exists and every import spelling sees them. It is available
// from Node 20.16; the dev-toolchain floor is 20.19 (`SPEC-QUESTIONS.md` Q9).
const childProcess = process.getBuiltinModule('node:child_process');
const dgram = process.getBuiltinModule('node:dgram');
const dns = process.getBuiltinModule('node:dns');
const net = process.getBuiltinModule('node:net');
const workerThreads = process.getBuiltinModule('node:worker_threads');

/**
 * How the denied request was attempted, so a failure names the API that has to change.
 * @typedef {'fetch' | 'tcp' | 'udp' | 'dns'} NetworkChannel
 */

/** Thrown in place of any outbound request attempted from a unit or integration test. */
export class NetworkAccessDeniedError extends Error {
  /**
   * @param {NetworkChannel} channel
   * @param {string} target
   */
  constructor(channel, target) {
    super(
      `Network access is denied in unit and integration tests (specs/21 §21.1). ` +
        `Attempted ${channel} request to: ${target}. ` +
        `Use a fixture, a loopback server the test starts itself, or move the test to the live suite.`,
    );
    /** @type {'NetworkAccessDeniedError'} */
    this.name = 'NetworkAccessDeniedError';
    /** @type {NetworkChannel} */
    this.channel = channel;
    /** @type {string} */
    this.target = target;
  }
}

/**
 * The complete allow-list. Everything not named here is denied.
 *
 * Loopback is permitted because §21.1's target is the *accidental external dependency*; a test that
 * starts a server on 127.0.0.1 has none, and denying it would push integration tests towards worse
 * workarounds. `localhost` is an exact string match, never a prefix or suffix test, so no hostname
 * can be constructed that satisfies it accidentally.
 *
 * @param {unknown} host
 * @returns {boolean}
 */
export function isPermittedHost(host) {
  // Fail closed: a non-string destination is one whose shape this function does not model, which is
  // exactly the case that must not be waved through.
  if (typeof host !== 'string') return false;

  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  // Hostnames are case-insensitive, and `fetch` lowercases via URL parsing while a raw socket does
  // not — so a case-sensitive match made the two guarded channels disagree.
  if (bare.toLowerCase() === 'localhost') return true;

  const family = net.isIP(bare);
  // `net.isIP` returns 0 for anything that is not a literal address, so a hostname can never reach
  // the range checks below however it is spelled.
  // `0.0.0.0` for the same reason `::` is permitted below: `server.address().address` reports it
  // for a server bound with no host, and `dgram.createSocket('udp4').bind(0)` always does — so
  // denying it broke the canonical UDP round-trip and forced tests to spell `127.0.0.1` explicitly,
  // which is the worse workaround the loopback allowance exists to prevent.
  if (family === 4) return bare.split('.')[0] === '127' || bare === '0.0.0.0';
  if (family === 6) {
    const lower = bare.toLowerCase();
    // `::1` has several legal spellings, and `server.address().address` returns `::` for a server
    // bound to the unspecified address — connecting to which targets loopback. Requiring the literal
    // string `::1` denied a test its own server's reported address.
    if (/^(0{1,4}:){0,7}:?0*1$/.test(lower) || lower === '::' || lower === '::1') return true;
    // IPv4-mapped loopback, e.g. ::ffff:127.0.0.1.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower)?.[1];
    if (mapped !== undefined) return net.isIP(mapped) === 4 && mapped.split('.')[0] === '127';
    // The hex form of the same address, e.g. ::ffff:7f00:1 for 127.0.0.1.
    const hex = /^::ffff:([0-9a-f]{1,4}):[0-9a-f]{1,4}$/.exec(lower)?.[1];
    return hex !== undefined && Number.parseInt(hex, 16) >>> 8 === 127;
  }
  return false;
}

/**
 * Interprets `connect`'s second argument, which is the host, a connection callback, or absent.
 *
 * `connect(port)` and `connect(port, cb)` both target `localhost` per Node's documentation. Treating
 * anything not `undefined` as the host denied `socket.connect(port, cb)` with an error naming
 * `<function>` — the same false-denial defect as `SPEC-QUESTIONS.md` Q13, one argument shape over.
 * `net.connect(port, cb)` escaped it only because Node normalises arguments before reaching the
 * patched method; the raw `net.Socket#connect` path, which is what is actually patched, did not.
 *
 * @param {unknown} second
 * @returns {unknown}
 */
function hostArgument(second) {
  if (second === undefined || typeof second === 'function') return 'localhost';
  return second;
}

/**
 * Mirrors Node's internal `toNumber` test, which is what distinguishes a port from a pipe name.
 * @param {string} value
 * @returns {boolean}
 */
function isNumericPort(value) {
  return value.length > 0 && Number.isFinite(Number(value));
}

/**
 * The destination of a `net.Socket.prototype.connect` call.
 *
 * `unix` is a domain socket or IPC path — no network destination, and how vitest's own worker IPC
 * keeps working. `tcp` carries a host of `null` when the argument shape is one this function does
 * not model, which `assertPermitted` then denies.
 *
 * @typedef {{ kind: 'unix' } | { kind: 'tcp', host: unknown, port: unknown }} ConnectTarget
 */

/**
 * @param {readonly unknown[]} args
 * @returns {ConnectTarget}
 */
function resolveTcpTarget(args) {
  const [first, second] = args;

  // `net.connect()` and `http.get()` reach this method with Node's *normalized* argument list — a
  // single array of `[options, callback]`.
  if (Array.isArray(first)) return resolveTcpTarget(/** @type {readonly unknown[]} */ (first));

  // A string first argument is a pipe path only if it is *not* numeric. Node decides this with
  // `isPipeName(s) = typeof s === 'string' && toNumber(s) === false`, so `socket.connect('80', host)`
  // is a port, not a pipe — an ordinary spelling when the port came from config or an env var.
  // Treating every string as a pipe skipped the allow-list entirely and let a real TCP connection
  // to a public IP through.
  if (typeof first === 'string') {
    if (!isNumericPort(first)) return { kind: 'unix' };
    // `connect(port)` and `connect(port, cb)` both default to localhost, per Node's documentation.
    return { kind: 'tcp', host: second === undefined ? 'localhost' : second, port: first };
  }

  if (typeof first === 'object' && first !== null) {
    const options = /** @type {{ host?: unknown, port?: unknown, path?: unknown }} */ (first);
    if (typeof options.path === 'string') return { kind: 'unix' };
    // No `?? 'localhost'` default: an options object with no host is an unmodelled shape, and the
    // previous version's localhost default made it silently permitted.
    // Node documents the default host for `connect({ port })` as `localhost`, so an absent host is
    // a modelled shape with a known destination, not an unknown one. Denying it produced an error
    // naming `<undefined>` for `net.connect(server.address().port)` — the most ordinary loopback
    // spelling there is. A host that is *present* but not a string remains unmodelled, and denied.
    return { kind: 'tcp', host: options.host ?? 'localhost', port: options.port };
  }

  return { kind: 'tcp', host: hostArgument(second), port: first };
}

/**
 * Denies a destination unless the allow-list permits it.
 * @param {NetworkChannel} channel
 * @param {unknown} host
 * @param {unknown} [port]
 * @returns {void}
 */
function assertPermitted(channel, host, port) {
  if (isPermittedHost(host)) return;
  const rendered = typeof host === 'string' ? host : `<${typeof host}>`;
  throw new NetworkAccessDeniedError(
    channel,
    port === undefined ? rendered : `${rendered}:${String(port)}`,
  );
}

/**
 * Renders a `fetch` first argument without invoking a user-controlled getter more than once.
 * @param {unknown} input
 * @returns {{ href: string, host: string | null }}
 */
function describeFetchTarget(input) {
  const href =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input instanceof Request
          ? input.url
          : '';
  if (href === '') return { href: '<non-URL fetch input>', host: null };
  try {
    return { href, host: new URL(href).hostname };
  } catch {
    return { href, host: null };
  }
}

/**
 * Extracts the destination address from `dgram.Socket#send`.
 *
 * `send(msg[, offset, length][, port][, address][, callback])`. Taking "the first string argument"
 * finds the *message* when the message is a string, so a denial would name a value the caller never
 * passed as an address — and `QUALITY-BAR.md` R2 requires an error to state what it actually found.
 *
 * @param {readonly unknown[]} args
 * @returns {string | undefined}
 */
function dgramSendAddress(args) {
  // The offset/length form is the only one with two consecutive numbers in positions 1 and 2.
  const addressIndex = typeof args[1] === 'number' && typeof args[2] === 'number' ? 4 : 2;
  const address = args[addressIndex];
  return typeof address === 'string' ? address : undefined;
}

/**
 * `dns` entry points that resolve locally for a literal address rather than querying a resolver.
 * `lookup` on an IP literal is answered by `getaddrinfo` without a packet, and `dgram`'s implicit
 * bind uses exactly that path — denying it made loopback UDP unusable while denying nothing real.
 * `resolve*` and `reverse` always query, so they are never exempt.
 */
const LOCAL_DNS_METHODS = new Set(['lookup']);

/** Every `dns` entry point that reaches a resolver. */
const DNS_METHODS = /** @type {const} */ ([
  'lookup',
  'lookupService',
  'resolve',
  'resolve4',
  'resolve6',
  'resolveAny',
  'resolveCaa',
  'resolveCname',
  'resolveMx',
  'resolveNaptr',
  'resolveNs',
  'resolvePtr',
  'resolveSoa',
  'resolveSrv',
  'resolveTxt',
  'reverse',
  // Not a query itself, but repointing a Resolver at a public nameserver turns a permitted host
  // into an outbound packet, which is the thing being prevented.
  'setServers',
]);

/**
 * Whether `nodeOptions` actually loads `guardUrl` via `--import`.
 *
 * Exported so `test/setup.ts` uses the same check for its entry-point rail rather than a second,
 * weaker copy — the copy is how the fail-open survived a round after being fixed here.
 *
 * @param {string | undefined} nodeOptions
 * @param {string} guardUrl
 * @returns {boolean}
 */
export function hasGuardImport(nodeOptions, guardUrl) {
  const tokens = (nodeOptions ?? '').split(/\s+/).filter((token) => token !== '');
  for (const [index, token] of tokens.entries()) {
    // `--import <url>` and `--import=<url>` are the only forms that actually load the guard.
    if (token === `--import=${guardUrl}`) return true;
    if (token === '--import' && tokens[index + 1] === guardUrl) return true;
  }
  return false;
}

/**
 * Returns `env` with this module's `--import` present in NODE_OPTIONS.
 *
 * Two weaker checks were tried and both failed open, each verified by a child that reached a public
 * host with HTTP 200: `includes('network-guard')` matched an unrelated `--title=network-guard`, and
 * then scanning the token list for the guard URL matched `--title <guardUrl>`. Only the flag *and*
 * its value together mean the guard is loaded — anything less is the prefix-matching mistake this
 * file's header forbids for hostnames, moved to another field.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {Record<string, string | undefined>}
 */
function withGuardOption(env) {
  const existing = env['NODE_OPTIONS'] ?? '';
  if (hasGuardImport(existing, import.meta.url)) return env;
  const option = `--import ${import.meta.url}`;
  return { ...env, NODE_OPTIONS: existing === '' ? option : `${existing} ${option}` };
}

/**
 * Replaces `holder[method]` with `replacement`, carrying over symbol-keyed own properties.
 *
 * `util.promisify` reads a symbol off the original function; dropping it made the promisified form
 * hang forever rather than resolve, which took out vitest's own worker startup.
 *
 * @param {Record<string, unknown>} holder
 * @param {string} method
 * @param {(this: unknown, ...args: unknown[]) => unknown} replacement
 * @returns {() => void} a restorer
 */
function replaceMethod(holder, method, replacement) {
  const original = /** @type {(this: unknown, ...args: unknown[]) => unknown} */ (holder[method]);
  for (const symbol of Object.getOwnPropertySymbols(original)) {
    Object.defineProperty(replacement, symbol, {
      value: /** @type {Record<symbol, unknown>} */ (/** @type {unknown} */ (original))[symbol],
      configurable: true,
    });
  }
  holder[method] = replacement;
  return () => {
    holder[method] = original;
  };
}

/**
 * Strips a port from a resolver address, leaving bare IPv6 literals intact.
 * @param {string} server
 * @returns {string}
 */
function stripResolverPort(server) {
  const bracketed = /^\[(.+)\](?::\d+)?$/.exec(server)?.[1];
  if (bracketed !== undefined) return bracketed;
  return /^(?:\d+\.){3}\d+:\d+$/.test(server) ? server.slice(0, server.lastIndexOf(':')) : server;
}

/**
 * Installs the guard and returns a restore function.
 *
 * Returns a restorer rather than mutating irreversibly so the guard's own test can prove the guard
 * is active without leaving the environment broken for the rest of the run.
 *
 * @returns {() => void}
 */
export function installNetworkGuard() {
  const originalFetch = globalThis.fetch;
  const originalConnect = net.Socket.prototype.connect;
  const originalSend = dgram.Socket.prototype.send;
  const originalDgramConnect = dgram.Socket.prototype.connect;

  globalThis.fetch = (input, init) => {
    const { href, host } = describeFetchTarget(input);
    // Loopback is permitted here for the same reason it is for sockets: an integration test that
    // starts an HTTP server on 127.0.0.1 and calls it with `fetch` is the normal shape.
    if (isPermittedHost(host)) return originalFetch(input, init);
    return Promise.reject(new NetworkAccessDeniedError('fetch', href));
  };

  net.Socket.prototype.connect = /** @type {typeof originalConnect} */ (
    function guardedConnect(/** @type {unknown[]} */ ...args) {
      const target = resolveTcpTarget(args);
      if (target.kind === 'tcp') assertPermitted('tcp', target.host, target.port);
      return Reflect.apply(originalConnect, this, args);
    }
  );

  // A connected datagram socket carries no address on `send`, so guarding `send` alone let every
  // `connect()`-then-`send()` datagram straight out. Both entry points have to be closed.
  dgram.Socket.prototype.send = /** @type {typeof originalSend} */ (
    function guardedSend(/** @type {unknown[]} */ ...args) {
      const host = dgramSendAddress(args);
      if (host !== undefined) assertPermitted('udp', host);
      return Reflect.apply(originalSend, this, args);
    }
  );

  dgram.Socket.prototype.connect = /** @type {typeof originalDgramConnect} */ (
    function guardedDgramConnect(/** @type {unknown[]} */ ...args) {
      // `connect(port[, address][, callback])` — the address is the first string, unambiguously,
      // because there is no message argument to confuse it with. An address-less connect targets
      // localhost by Node's own default, which the allow-list permits.
      const host = args.find((arg) => typeof arg === 'string');
      if (host !== undefined) assertPermitted('udp', host);
      return Reflect.apply(originalDgramConnect, this, args);
    }
  );

  // c-ares (`resolve*`) and getaddrinfo (`lookup`) each own their sockets and reach the network
  // without touching net or dgram. Resolving a hostname is itself the machine-dependent lookup
  // §21.1 exists to catch, so it is denied rather than merely followed.
  /** @type {Array<() => void>} */
  const restoreDns = [];
  /** @type {Array<[unknown, boolean]>} */
  const dnsNamespaces = [
    [dns, false],
    [dns.Resolver.prototype, false],
    // The promise-returning API must *reject*, never throw synchronously: a caller that only
    // attaches `.catch()` would otherwise take an unhandled exception, which is the same defect the
    // first version of the `fetch` guard had.
    [dns.promises, true],
    [dns.promises.Resolver.prototype, true],
  ];
  for (const [namespace, isPromiseApi] of dnsNamespaces) {
    const holder = /** @type {Record<string, unknown>} */ (namespace);
    for (const method of DNS_METHODS) {
      const original = holder[method];
      if (typeof original !== 'function') continue;
      // A `function` rather than an arrow so `this` is the calling Resolver instance: applying the
      // original against the prototype would lose per-instance state such as `setServers`.
      holder[method] = /** @type {(this: unknown, ...args: unknown[]) => unknown} */ (
        function guardedDns(/** @type {unknown[]} */ ...args) {
          // `setServers` takes an *array* of addresses, so the scalar search below finds nothing;
          // each entry has to clear the allow-list on its own.
          if (method === 'setServers') {
            const servers = Array.isArray(args[0]) ? args[0] : [];
            for (const server of servers) {
              // Entries may carry a port (`1.1.1.1:53`, `[::1]:53`); the address is what matters.
              // Only `[v6]:port` and `v4:port` carry a port. A blanket `:\d+$` strip ate the last
              // hextet of a bare IPv6 literal, so `setServers(['::1'])` — pointing a resolver at a
              // loopback stub, the normal integration-test shape — was denied while
              // `isPermittedHost('::1')` returns true. The guard contradicted its own unit test.
              const address = typeof server === 'string' ? stripResolverPort(server) : server;
              if (!isPermittedHost(address)) {
                const denial = new NetworkAccessDeniedError('dns', String(server));
                if (isPromiseApi) return Promise.reject(denial);
                throw denial;
              }
            }
            return Reflect.apply(original, this, args);
          }

          const host = args.find((arg) => typeof arg === 'string');

          // The allow-list is about the *destination*, and for `resolve*`/`reverse` the destination
          // is whatever `dns.getServers()` returns — a real nameserver on any real machine — not the
          // name being asked about. Testing the queried name let `dns.reverse('127.0.0.1')` and
          // `dns.resolve4('localhost')` send genuine packets from a green suite. Only `lookup` on an
          // IP literal is answered without one.
          // `lookup` is answered by getaddrinfo from the hosts file for an IP literal and for the
          // permitted names, with no packet — and it is on the path of every loopback connection, so
          // denying it makes the whole allow-list unusable.
          const resolvesLocally =
            LOCAL_DNS_METHODS.has(method) &&
            (net.isIP(String(host)) !== 0 || isPermittedHost(host));
          if (!resolvesLocally) {
            const denial = new NetworkAccessDeniedError('dns', host === undefined ? method : host);
            if (isPromiseApi) return Promise.reject(denial);
            throw denial;
          }
          return Reflect.apply(original, this, args);
        }
      );
      restoreDns.push(() => {
        holder[method] = original;
      });
    }
  }

  // A worker or child that supplies its own `env` drops the NODE_OPTIONS the guard travels in. The
  // parent owns that options object, so re-injecting the option there keeps every realm guarded
  // whatever the caller does with the environment.
  /** @type {Array<() => void>} */
  const restoreSpawns = [];
  const spawnHolder = /** @type {Record<string, unknown>} */ (
    /** @type {unknown} */ (childProcess)
  );
  for (const method of [
    'spawn',
    'spawnSync',
    'exec',
    'execSync',
    'execFile',
    'execFileSync',
    'fork',
  ]) {
    if (typeof spawnHolder[method] !== 'function') continue;
    const original = /** @type {(this: unknown, ...args: unknown[]) => unknown} */ (
      spawnHolder[method]
    );
    restoreSpawns.push(
      replaceMethod(spawnHolder, method, function guardedSpawn(...args) {
        const index = args.findIndex(
          (arg) => typeof arg === 'object' && arg !== null && !Array.isArray(arg),
        );
        const options = /** @type {{ env?: Record<string, string | undefined> | null }} */ (
          args[index]
        );
        // `env: null` is legal and means "inherit `process.env`", which already carries the option;
        // reading `NODE_OPTIONS` off it threw a TypeError from inside the caller's spawn. The Worker
        // path handled this and the child path did not, which is how the asymmetry showed up.
        if (index !== -1 && typeof options.env === 'object' && options.env !== null) {
          args[index] = { ...options, env: withGuardOption(options.env) };
        }
        return Reflect.apply(original, this, args);
      }),
    );
  }

  const workerHolder = /** @type {Record<string, unknown>} */ (
    /** @type {unknown} */ (workerThreads)
  );
  const OriginalWorker = /** @type {typeof workerThreads.Worker} */ (workerHolder['Worker']);
  workerHolder['Worker'] = class GuardedWorker extends OriginalWorker {
    /**
     * @param {ConstructorParameters<typeof OriginalWorker>[0]} filename
     * @param {ConstructorParameters<typeof OriginalWorker>[1]} [options]
     */
    constructor(filename, options) {
      super(
        filename,
        // `SHARE_ENV` shares the parent's environment, which already carries the option, so only a
        // supplied env object needs rewriting.
        typeof options?.env !== 'object' || options.env === null
          ? options
          : {
              ...options,
              env: /** @type {NodeJS.ProcessEnv} */ (withGuardOption(options.env)),
            },
      );
    }
  };
  restoreSpawns.push(() => {
    workerHolder['Worker'] = OriginalWorker;
  });

  // `process.binding('tcp_wrap')` hands out a raw TCP constructor that bypasses every patch above —
  // verified to complete a connection. It is deprecated and no plausible contributor writes it, but
  // `SPEC-QUESTIONS.md` Q12 claims the uncovered list is complete, so it is closed rather than left
  // as an undeclared gap.
  // `process.binding` is deprecated and absent from @types/node, hence the cast.
  const processHolder = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (process));
  const originalBinding = processHolder['binding'];
  const NETWORK_BINDINGS = new Set(['tcp_wrap', 'udp_wrap', 'cares_wrap', 'pipe_wrap']);
  const originalBindingFn = /** @type {(name: string) => unknown} */ (originalBinding);
  processHolder['binding'] = (/** @type {string} */ name) => {
    // Only the network-adjacent bindings. Denying every name — `natives`, `util`, `fs` — was a false
    // denial with a channel label that misdirects.
    if (NETWORK_BINDINGS.has(name)) {
      throw new NetworkAccessDeniedError('tcp', `process.binding(${name})`);
    }
    return originalBindingFn(name);
  };

  return () => {
    processHolder['binding'] = originalBinding;
    for (const restore of restoreSpawns) restore();
    globalThis.fetch = originalFetch;
    net.Socket.prototype.connect = originalConnect;
    dgram.Socket.prototype.send = originalSend;
    dgram.Socket.prototype.connect = originalDgramConnect;
    for (const restore of restoreDns) restore();
  };
}

// Self-install on load. This module is delivered by `--import` to the test process, to every child
// process, and to every worker thread, and each is a separate realm that must guard itself. The
// previous version gated this on `isMainThread`, which is `true` inside a child *process* — so the
// guard arrived there and deliberately did nothing, and a spawned `node -e` completed a real HTTP
// request while the suite reported green.
installNetworkGuard();
