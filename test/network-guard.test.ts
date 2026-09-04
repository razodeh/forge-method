/**
 * The network guard's threat model, one test per declared channel.
 *
 * `specs/21` §21.1 denies outbound network access to unit and integration tests. This file is the
 * enumeration of what "outbound" means: every API family that can open a socket, plus every realm
 * that gets its own copy of them. A channel with no test here is a channel that is not claimed to be
 * covered.
 *
 * Each test asserts `NetworkAccessDeniedError` and its `channel` field rather than merely that
 * something threw, so a denial for the wrong reason cannot pass as a denial.
 *
 * @see specs/21 §21.1
 * @see PLAN-M1.md P1b
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import dgram from 'node:dgram';
import dns from 'node:dns';
// The named and namespace spellings are imported deliberately: each reads Node's ESM facade for the
// builtin, which snapshots exports the first time the facade is built. Patching after that point is
// invisible to them, and that single mechanism defeated three channels across three reviews. These
// imports are the regression test for it.
import { resolve4 as namedResolve4 } from 'node:dns';
import * as dnsNamespace from 'node:dns';
import dnsPromises from 'node:dns/promises';
import http from 'node:http';
import http2 from 'node:http2';
import https from 'node:https';
import net from 'node:net';
import { connect as namedConnect } from 'node:net';
import tls from 'node:tls';
import { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';

import {
  NetworkAccessDeniedError,
  hasGuardImport,
  installNetworkGuard,
  isPermittedHost,
} from './network-guard.mjs';

/** Runs a snippet in a fresh worker thread and reports the error name it observed, or 'ESCAPED'. */
async function runInWorker(
  body: string,
  options: { execArgv?: string[]; env?: NodeJS.ProcessEnv } = {},
): Promise<unknown> {
  const worker = new Worker(
    `import { parentPort } from 'node:worker_threads';
     try { ${body}; parentPort.postMessage('ESCAPED'); }
     catch (error) { parentPort.postMessage(error.name); }`,
    { eval: true, ...options },
  );
  const outcome = await new Promise<unknown>((resolve, reject) => {
    worker.once('message', (message: unknown) => {
      resolve(message);
    });
    worker.once('error', (error: Error) => {
      reject(error);
    });
  });
  await worker.terminate();
  return outcome;
}

describe('the allow-list is positive and closed', () => {
  it.each([
    ['localhost', true],
    ['127.0.0.1', true],
    ['127.1.2.3', true],
    ['::1', true],
    ['[::1]', true],
    // `::1` has several legal spellings, and `server.address().address` reports `::` for a server
    // bound to the unspecified address — each was denied while meaning loopback.
    ['0:0:0:0:0:0:0:1', true],
    ['::', true],
    ['::ffff:127.0.0.1', true],
    ['LOCALHOST', true],
    // The IPv4 unspecified address, which `server.address().address` reports for a server bound
    // with no host — denying it broke the canonical UDP round-trip.
    ['0.0.0.0', true],
  ])('permits %s', (host, permitted) => {
    expect(isPermittedHost(host)).toBe(permitted);
  });

  it.each([
    // The exact host that defeated the previous prefix-matching implementation: a real DNS name,
    // answered by a public nameserver, that starts with "127.".
    '127.0.0.1.nip.io',
    '127.example.com',
    'localhost.evil.test',
    'evil.test',
    'notlocalhost',
    '128.0.0.1',
    '::2',
    '::ffff:8.8.8.8',
    '',
  ])('denies %s', (host) => {
    expect(isPermittedHost(host)).toBe(false);
  });

  it.each([[undefined], [null], [42], [{ toString: () => '127.0.0.1' }], [['127.0.0.1']]])(
    'denies the non-string destination %s, rather than defaulting it to permitted',
    (host) => {
      expect(isPermittedHost(host)).toBe(false);
    },
  );
});

describe('specs/21 §21.1 — every declared channel is denied', () => {
  it('denies fetch with a string URL', async () => {
    await expect(fetch('https://registry.npmjs.org/forge-method')).rejects.toMatchObject({
      name: 'NetworkAccessDeniedError',
      channel: 'fetch',
      target: 'https://registry.npmjs.org/forge-method',
    });
  });

  it('denies fetch with a URL instance', async () => {
    await expect(fetch(new URL('https://example.test/from-url'))).rejects.toMatchObject({
      target: 'https://example.test/from-url',
    });
  });

  it('denies fetch with a Request instance', async () => {
    await expect(fetch(new Request('https://example.test/from-request'))).rejects.toMatchObject({
      target: 'https://example.test/from-request',
    });
  });

  it('denies fetch to a hostname that merely starts with a loopback address', async () => {
    await expect(fetch('http://127.0.0.1.nip.io/')).rejects.toMatchObject({ channel: 'fetch' });
  });

  it('denies node:http', () => {
    expect(() => http.get('http://example.com/')).toThrow(NetworkAccessDeniedError);
  });

  it('denies node:https', () => {
    expect(() => https.get('https://example.com/')).toThrow(NetworkAccessDeniedError);
  });

  it('denies node:tls', () => {
    expect(() => tls.connect(443, 'example.com')).toThrow(NetworkAccessDeniedError);
  });

  it('denies node:http2', () => {
    expect(() => http2.connect('https://example.com')).toThrow(NetworkAccessDeniedError);
  });

  it('denies a raw node:net socket, naming host and port', () => {
    expect(() => net.connect(443, 'example.com')).toThrow(
      expect.objectContaining({ channel: 'tcp', target: 'example.com:443' }) as Error,
    );
  });

  it('denies node:net addressed with an options object', () => {
    expect(() => net.connect({ host: 'example.com', port: 80 })).toThrow(NetworkAccessDeniedError);
  });

  it('denies node:net addressed with a hostname that starts with a loopback address', () => {
    expect(() => net.connect(80, '127.0.0.1.nip.io')).toThrow(NetworkAccessDeniedError);
  });

  it('denies a host that is present but not a string, which is genuinely unmodelled', () => {
    // This replaced a test asserting that `connect({ port })` with no host is denied. That
    // assertion was wrong: Node documents the default host as `localhost`, so an absent host has a
    // known destination and denying it was a false denial, not a closed allow-list. What must stay
    // denied is a host that is present in a shape this guard does not model. See SPEC-QUESTIONS.md
    // Q13 — the change is recorded because editing a test to pass is otherwise a review failure.
    expect(() => net.connect({ port: 80, host: 42 as unknown as string })).toThrow(
      NetworkAccessDeniedError,
    );
  });

  it('denies a numeric string port, which Node treats as a port and not a pipe name', () => {
    // The exact shape that defeated the previous implementation: it classified every string first
    // argument as a unix pipe and skipped the allow-list, and a real connection to 1.1.1.1:80
    // succeeded. A port arriving as a string from config is an ordinary spelling.
    const socket = new net.Socket();
    try {
      expect(() => socket.connect('80' as unknown as number, '1.1.1.1')).toThrow(
        expect.objectContaining({ channel: 'tcp', target: '1.1.1.1:80' }) as Error,
      );
    } finally {
      socket.destroy();
    }
  });

  it('still treats a non-numeric string as a pipe name, so unix sockets keep working', () => {
    const socket = new net.Socket();
    try {
      // A pipe path carries no network destination; the guard must not deny it. It fails to connect
      // because nothing is listening, which is an ENOENT, not a denial.
      expect(() => socket.connect('/tmp/forge-nonexistent.sock')).not.toThrow();
    } finally {
      socket.destroy();
    }
  });

  it('denies a Resolver repointed at a public nameserver, even for a permitted host', () => {
    const resolver = new dns.Resolver();
    expect(() => {
      resolver.setServers(['1.1.1.1']);
    }).toThrow(NetworkAccessDeniedError);
  });

  it('denies an IPv6 literal outside the loopback address', () => {
    expect(() => net.connect(80, '2606:4700::1111')).toThrow(NetworkAccessDeniedError);
  });

  it('denies an addressed datagram', () => {
    const socket = dgram.createSocket('udp4');
    try {
      expect(() => {
        socket.send(Buffer.from('x'), 53, '8.8.8.8');
      }).toThrow(expect.objectContaining({ channel: 'udp' }) as Error);
    } finally {
      socket.close();
    }
  });

  it('denies a connected datagram socket, whose send() carries no address argument', () => {
    const socket = dgram.createSocket('udp4');
    try {
      expect(() => {
        socket.connect(53, '8.8.8.8');
      }).toThrow(NetworkAccessDeniedError);
    } finally {
      socket.close();
    }
  });

  it('denies dns.resolve4, which uses c-ares sockets and bypasses net entirely', () => {
    expect(() => {
      dns.resolve4('example.com', () => undefined);
    }).toThrow(expect.objectContaining({ channel: 'dns' }) as Error);
  });

  it('denies dns.lookup, which uses getaddrinfo on the threadpool', () => {
    expect(() => {
      dns.lookup('example.com', () => undefined);
    }).toThrow(NetworkAccessDeniedError);
  });

  it('denies the dns/promises API', async () => {
    await expect(dnsPromises.resolve4('example.com')).rejects.toThrow(NetworkAccessDeniedError);
  });

  it('denies a dns.Resolver instance, not just the module-level functions', () => {
    const resolver = new dns.Resolver();
    expect(() => {
      resolver.resolve4('example.com', () => undefined);
    }).toThrow(NetworkAccessDeniedError);
  });

  it('denies DNS through a named import, which reads a snapshot taken before any patch', () => {
    // Regression for the defect class that escaped three reviews: `import { resolve4 }` reached the
    // unpatched original and completed a real query to a public nameserver from a green suite.
    expect(() => {
      namedResolve4('example.com', () => undefined);
    }).toThrow(NetworkAccessDeniedError);
  });

  it('denies DNS through a namespace import', () => {
    expect(() => {
      dnsNamespace.resolve4('example.com', () => undefined);
    }).toThrow(NetworkAccessDeniedError);
  });

  it('denies a socket opened through a named import of node:net', () => {
    expect(() => namedConnect(443, 'example.com')).toThrow(NetworkAccessDeniedError);
  });

  it('denies dns.lookupService, which is getnameinfo and always sends a PTR query', () => {
    // It was unconditionally permitted: it was listed as resolving "locally" for an IP literal, and
    // its signature accepts nothing else — so the exemption fired on every valid call and the method
    // could never be denied. Three public nameservers were reached from a green suite.
    expect(() => {
      dns.lookupService('8.8.8.8', 53, () => undefined);
    }).toThrow(expect.objectContaining({ channel: 'dns' }) as Error);
  });

  it('denies dns/promises lookupService', async () => {
    await expect(dnsPromises.lookupService('8.8.8.8', 53)).rejects.toThrow(
      NetworkAccessDeniedError,
    );
  });

  it('denies dns.reverse even for a loopback literal, because the query goes to a nameserver', () => {
    // The allow-list is about the destination, and for `resolve*`/`reverse` the destination is
    // whatever `dns.getServers()` returns — not the name being asked about. Checking the queried
    // name let `reverse('127.0.0.1')` send a real packet to a real resolver from a green suite.
    expect(() => {
      dns.reverse('127.0.0.1', () => undefined);
    }).toThrow(expect.objectContaining({ channel: 'dns' }) as Error);
  });

  it('denies dns.resolve4 for a permitted name, for the same reason', () => {
    expect(() => {
      dns.resolve4('localhost', () => undefined);
    }).toThrow(NetworkAccessDeniedError);
  });

  it('denies a child whose NODE_OPTIONS carries the guard URL under a different flag', () => {
    // The previous check scanned the token list for the guard URL, so `--title <guardUrl>` satisfied
    // it and suppressed injection. Only the flag and its value together mean the guard is loaded.
    const output = execFileSync(
      process.execPath,
      [
        '-e',
        `import('node:http').then(({ default: http }) => {
           try {
             http.get('http://example.com/', (r) => { console.log('ESCAPED ' + r.statusCode); });
           } catch (error) { console.log(error.name); }
         })`,
      ],
      {
        encoding: 'utf8',
        env: {
          PATH: process.env['PATH'] ?? '',
          NODE_OPTIONS: `--title ${pathToFileURL(path.join(import.meta.dirname, 'network-guard.mjs')).href}`,
        },
      },
    );
    expect(output.trim()).toBe('NetworkAccessDeniedError');
  });

  it('denies a hostname that starts with a loopback address via DNS', () => {
    expect(() => {
      dns.resolve4('127.0.0.1.nip.io', () => undefined);
    }).toThrow(NetworkAccessDeniedError);
  });

  // Node 20 has no global WebSocket without a flag, and `specs/02` §2.1 tests on 20/22/24. Skipping
  // where the API does not exist keeps the floor green on the declared floor; the underlying socket
  // is covered by the node:net cases regardless of which client opens it.
  it.skipIf(typeof globalThis.WebSocket === 'undefined')(
    'denies WebSocket, whose TCP connect goes through the guarded socket',
    async () => {
      // The constructor is asynchronous by specification and never throws; the denial surfaces as an
      // error event, exactly as a refused connection would.
      const socket = new WebSocket('wss://example.com/');
      const event = await new Promise<Event>((resolve) => {
        socket.addEventListener('error', resolve, { once: true });
      });
      expect(event.type).toBe('error');
    },
  );

  it('denies a dynamically imported module, which resolves to the same patched builtin', async () => {
    const dynamicNet = await import('node:net');
    expect(() => dynamicNet.default.connect(80, 'example.com')).toThrow(NetworkAccessDeniedError);
  });
});

describe('specs/21 §21.1 — every realm gets its own guard', () => {
  it('denies a worker thread, which has a fresh module registry and no setup file', async () => {
    await expect(
      runInWorker(`const net = await import('node:net'); net.default.connect(443, 'example.com')`),
    ).resolves.toBe('NetworkAccessDeniedError');
  });

  it('denies a worker that overrides execArgv, which cannot drop an inherited NODE_OPTIONS', async () => {
    await expect(
      runInWorker(`const net = await import('node:net'); net.default.connect(443, 'example.com')`, {
        execArgv: [],
      }),
    ).resolves.toBe('NetworkAccessDeniedError');
  });

  it('denies a nested worker', async () => {
    const outcome = await runInWorker(
      `const { Worker } = await import('node:worker_threads');
       const inner = new Worker(
         \`import { parentPort } from 'node:worker_threads';
          import net from 'node:net';
import { connect as namedConnect } from 'node:net';
          try { net.connect(443, 'example.com'); parentPort.postMessage('ESCAPED'); }
          catch (error) { parentPort.postMessage(error.name); }\`,
         { eval: true },
       );
       const result = await new Promise((resolve) => inner.once('message', resolve));
       await inner.terminate();
       if (result !== 'NetworkAccessDeniedError') throw new Error(result);
       throw Object.assign(new Error('denied'), { name: 'NetworkAccessDeniedError' })`,
    );
    expect(outcome).toBe('NetworkAccessDeniedError');
  });

  // The two uncovered cases — a child spawned with an env that drops NODE_OPTIONS, and a non-Node
  // binary — are recorded in SPEC-QUESTIONS.md Q12 rather than tested, because a test asserting that
  // an escape works would enshrine it. The covered case is tested here.
  it('denies a worker given an explicit env, which replaces the inherited NODE_OPTIONS', async () => {
    await expect(
      runInWorker(`const net = await import('node:net'); net.default.connect(443, 'example.com')`, {
        env: { PATH: process.env['PATH'] ?? '' },
      }),
    ).resolves.toBe('NetworkAccessDeniedError');
  });

  it('denies a child process given an explicit env, the hermetic-subprocess pattern', () => {
    // `{ env: { PATH } }` is how a test isolates a subprocess, and it dropped the guard entirely.
    // `@forge/vcs` will spawn git exactly this way.
    const output = execFileSync(
      process.execPath,
      [
        '-e',
        `import('node:http').then(({ default: http }) => {
           try {
             http.get('http://example.com/', (r) => { console.log('ESCAPED ' + r.statusCode); });
           } catch (error) { console.log(error.name); }
         })`,
      ],
      { encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '' } },
    );
    expect(output.trim()).toBe('NetworkAccessDeniedError');
  });

  it('denies a child whose env carries an unrelated NODE_OPTIONS value', () => {
    // The injection check was a substring test on a caller-controlled string, so any NODE_OPTIONS
    // containing the text "network-guard" — an unrelated --title, a checkout under a directory of
    // that name — suppressed it and the child ran unguarded, reaching a real host with HTTP 200.
    const output = execFileSync(
      process.execPath,
      [
        '-e',
        `import('node:http').then(({ default: http }) => {
           try {
             http.get('http://example.com/', (r) => { console.log('ESCAPED ' + r.statusCode); });
           } catch (error) { console.log(error.name); }
         })`,
      ],
      {
        encoding: 'utf8',
        env: { PATH: process.env['PATH'] ?? '', NODE_OPTIONS: '--title=network-guard' },
      },
    );
    expect(output.trim()).toBe('NetworkAccessDeniedError');
  });

  it('denies process.binding, which hands out a raw TCP constructor', () => {
    expect(() => {
      (process as unknown as { binding: (name: string) => unknown }).binding('tcp_wrap');
    }).toThrow(NetworkAccessDeniedError);
  });

  it('denies a child process, which inherits the guard through NODE_OPTIONS', () => {
    const output = execFileSync(
      process.execPath,
      [
        '-e',
        `import('node:http').then(({ default: http }) => {
           try {
             http.get('http://example.com/', (r) => { console.log('ESCAPED ' + r.statusCode); });
           } catch (error) { console.log(error.name); }
         })`,
      ],
      { encoding: 'utf8' },
    );
    expect(output.trim()).toBe('NetworkAccessDeniedError');
  });
});

describe('loopback stays usable, so integration tests are not pushed to worse workarounds', () => {
  it('permits connect(port) with no host, whose documented default is localhost', async () => {
    // The most ordinary loopback spelling there is, and it was denied with an error naming
    // `<undefined>` — every future integration test writing `net.connect(server.address().port)`
    // would have hit it.
    const server = net.createServer();
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('expected a TCP address');

    const client = net.connect(address.port);
    await new Promise<void>((resolve, reject) => {
      client.once('connect', () => {
        resolve();
      });
      client.once('error', (error: Error) => {
        reject(error);
      });
    });
    client.destroy();
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });

    expect(client.destroyed).toBe(true);
  });

  it('permits spawning with env: null, which Node reads as "inherit process.env"', () => {
    // Reading NODE_OPTIONS off `null` threw a TypeError from inside the caller's spawn call. The
    // inherited environment already carries the guard, so there is nothing to inject.
    // `env: null` is legal at runtime — Node reads it as `process.env` — but @types/node types the
    // field as `ProcessEnv | undefined`, so the cast documents the gap between the two.
    const output = execFileSync(process.execPath, ['-e', "console.log('ran')"], {
      encoding: 'utf8',
      env: null as unknown as NodeJS.ProcessEnv,
    });
    expect(output.trim()).toBe('ran');
  });

  it('permits a Resolver pointed at a loopback DNS stub', () => {
    // `setServers(['::1'])` was denied: the port-stripper ate the last hextet of a bare IPv6
    // literal, so the guard refused a host its own allow-list test declares permitted.
    const resolver = new dns.Resolver();
    expect(() => {
      resolver.setServers(['::1']);
    }).not.toThrow();
    expect(() => {
      resolver.setServers(['127.0.0.1', '[::1]:53']);
    }).not.toThrow();
  });

  it('permits socket.connect(port, callback), whose second argument is not a host', async () => {
    // Denied with an error naming `<function>`. `net.connect(port, cb)` escaped it because Node
    // normalises arguments first; the raw `net.Socket#connect` path — which is what is patched —
    // did not. Same false-denial defect as SPEC-QUESTIONS.md Q13, one argument shape over.
    const server = net.createServer();
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('expected a TCP address');

    const socket = new net.Socket();
    await new Promise<void>((resolve, reject) => {
      socket.connect(address.port, () => {
        resolve();
      });
      socket.once('error', (error: Error) => {
        reject(error);
      });
    });
    socket.destroy();
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });

    expect(socket.destroyed).toBe(true);
  });

  it('permits a raw socket to a server the test started', async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('expected a TCP address');

    const client = net.connect(address.port, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      client.once('connect', () => {
        resolve();
      });
      client.once('error', (error: Error) => {
        reject(error);
      });
    });
    client.destroy();
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });

    expect(client.destroyed).toBe(true);
  });

  it('permits a UDP round-trip using the address the server itself reports', async () => {
    // `dgram.createSocket('udp4').bind(0)` always reports `0.0.0.0`, so denying that address made
    // the canonical UDP integration shape impossible and forced tests to hardcode 127.0.0.1 — the
    // worse workaround the loopback allowance exists to prevent.
    const server = dgram.createSocket('udp4');
    const received = new Promise<string>((resolve) => {
      server.once('message', (message) => {
        resolve(message.toString());
      });
    });
    await new Promise<void>((resolve) => {
      server.bind(0, resolve);
    });
    const { address, port } = server.address();

    const client = dgram.createSocket('udp4');
    client.send(Buffer.from('ping'), port, address);
    const body = await received;
    client.close();
    server.close();

    expect(body).toBe('ping');
  });

  it('permits a datagram to a loopback server the test started', async () => {
    // Regression: the DNS guard denied `dgram`'s implicit bind, which resolves the *local* address
    // `0.0.0.0` through getaddrinfo without a packet. That made loopback UDP entirely unusable while
    // preventing nothing, and reported `channel: 'dns'` pointing a debugger at the wrong subsystem.
    const server = dgram.createSocket('udp4');
    const received = new Promise<string>((resolve) => {
      server.once('message', (message) => {
        resolve(message.toString());
      });
    });
    await new Promise<void>((resolve) => {
      server.bind(0, '127.0.0.1', resolve);
    });

    const client = dgram.createSocket('udp4');
    client.send(Buffer.from('ping'), server.address().port, '127.0.0.1');
    const body = await received;
    client.close();
    server.close();

    expect(body).toBe('ping');
  });

  it('permits fetch to a loopback server, matching the socket policy', async () => {
    const server = http.createServer((_request, response) => {
      response.end('ok');
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('expected a TCP address');

    const body = await (await fetch(`http://127.0.0.1:${String(address.port)}/`)).text();
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });

    expect(body).toBe('ok');
  });
});

describe('the patched surface is complete, not hand-remembered', () => {
  it('patches every dns function that can reach a resolver', async () => {
    // `eslint.config.js` derives its builtin list from the running Node precisely because a
    // hand-typed list silently omitted net/tls/dns/http2. This file's DNS list is hand-typed, and
    // `SPEC-QUESTIONS.md` Q12 claims the uncovered set is complete — a claim that rested on nobody
    // having checked. CI runs Node 24, where the API surface differs from the author's machine.
    const dnsModule = await import('node:dns');
    const resolver = new dnsModule.default.Resolver();

    // Functions that inspect or configure local state without addressing a nameserver.
    const localOnly = new Set([
      'getServers',
      'setDefaultResultOrder',
      'getDefaultResultOrder',
      'cancel',
      'setLocalAddress',
      'Resolver',
      'lookup',
    ]);

    const unpatched: string[] = [];
    for (const [label, holder] of [
      ['dns', dnsModule.default],
      ['dns.promises', dnsModule.default.promises],
      ['Resolver.prototype', Object.getPrototypeOf(resolver) as Record<string, unknown>],
    ] as const) {
      for (const key of Object.keys(holder)) {
        const value = (holder as Record<string, unknown>)[key];
        if (typeof value !== 'function' || localOnly.has(key)) continue;
        // A patched method throws or rejects for a public host; an unpatched one does not.
        if (!/^(resolve|reverse|lookupService|setServers)/.test(key)) continue;
        if (!String(value).includes('guardedDns')) unpatched.push(`${label}.${key}`);
      }
    }

    expect(unpatched.sort()).toEqual([]);
  });
});

describe('the guard is reversible', () => {
  it('restores every patched entry point when the returned restorer is called', () => {
    const guardedFetch = globalThis.fetch;
    /* eslint-disable-next-line @typescript-eslint/unbound-method --
       Comparing prototype method identity is the point: the assertion proves the guard replaced and
       then restored the exact function reference. It is never called through this binding. */
    const guardedConnect = net.Socket.prototype.connect;
    const restore = installNetworkGuard();
    try {
      expect(globalThis.fetch).not.toBe(guardedFetch);
      // eslint-disable-next-line @typescript-eslint/unbound-method -- identity check, see above
      expect(net.Socket.prototype.connect).not.toBe(guardedConnect);
    } finally {
      restore();
    }
    expect(globalThis.fetch).toBe(guardedFetch);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- identity check, see above
    expect(net.Socket.prototype.connect).toBe(guardedConnect);
  });
});

describe('hasGuardImport distinguishes the flag from its value', () => {
  const url = 'file:///repo/test/network-guard.mjs';

  it.each([`--import ${url}`, `--import=${url}`, `--enable-source-maps --import ${url}`])(
    'accepts %s',
    (options) => {
      expect(hasGuardImport(options, url)).toBe(true);
    },
  );

  it.each([
    // Each of these defeated an earlier version: a substring match, then a token-list scan.
    ['', 'empty'],
    ['--title=network-guard', 'a substring of the module name'],
    [`--title ${url}`, 'the URL under a different flag'],
    [`--title=${url}`, 'the URL as another flag value'],
    [`--import ${url}x`, 'a longer path with the same prefix'],
  ])('rejects %s (%s)', (options) => {
    expect(hasGuardImport(options, url)).toBe(false);
  });
});
