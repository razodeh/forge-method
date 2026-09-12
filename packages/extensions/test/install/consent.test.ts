/**
 * `describeRequestedCapabilities`/`promptForConsent` — `19` §19.5 step 3's capability consent screen,
 * `15` §15.11's "capability request screen ... require confirmation" line. `PLAN-M11.md` P3's own
 * literal Checks: a real manifest with 3 different capability kinds produces a description naming all
 * 3, none omitted, none fabricated; refusal leaves the target `.forge/` tree byte-identical to before
 * the attempt; `--yes` bypasses the prompt only when explicitly passed, never as a silent default.
 *
 * @see specs/19 §19.5
 * @see specs/15 §15.11
 * @see PLAN-M11.md P3
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';

import { computeContentChecksum } from '@forge/vcs';
import { isForgeError } from '@forge/core';
import { afterEach, describe, expect, it } from 'vitest';

import { describeRequestedCapabilities, promptForConsent } from '../../src/install/consent.ts';
import { moduleSchema } from '../../src/module/schema.ts';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function freshDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-extensions-consent-'));
  dirs.push(dir);
  return dir;
}

/** `15` §15.11's own worked example overlay, verbatim (the fields this schema validates; the rest —
 * `version`/`forgeVersion`/`requiresModules`/etc. — are real fields a real overlay.yaml also carries,
 * included here to prove they pass through untouched rather than being rejected). */
const ACME_OVERLAY = {
  id: 'acme-engineering',
  name: 'ACME Engineering Standards',
  version: '3.2.0',
  forgeVersion: '>=1.0 <2',
  requiresModules: ['fm-service'],
  provides: {
    agents: ['backend', 'reviewer', 'sap-integrator'],
    skills: ['acme-java-standards', 'acme-observability', 'acme-rest-standards'],
    mcp: ['acme-jira', 'acme-confluence'],
    checks: ['acme:licence-policy', 'acme:layering'],
    presets: ['acme-default'],
  },
  requestsCapabilities: [
    { network: ['artifactory.internal'] },
    { exec: ['./gradlew *'] },
    { 'mcp-write': false },
  ],
};

/** `19` §19.1's own fm-service worked example, verbatim. */
const FM_SERVICE_MODULE = moduleSchema.parse({
  id: 'fm-service',
  name: 'Backend services and APIs',
  version: '1.3.0',
  forgeVersion: '>=1.0 <2',
  requires: ['fm-core'],
  conflicts: [],
  levels: ['L1', 'L2', 'L3', 'L4'],
  ceilings: {
    backend: {
      write: true,
      exec: ['pnpm *', 'git *', 'docker *'],
      network: 'allowlist',
      deploy: false,
    },
    reviewer: { write: false, exec: ['git *', 'rg*'], network: 'none', deploy: false },
  },
  provides: {
    agents: ['domain-modeler', 'integration-architect'],
    workflows: ['contract-test-cycle'],
    frameworks: ['integration-design', 'api-versioning'],
    checks: ['contract:verify', 'api:breaking-change'],
    artifactTypes: [],
  },
});

function nullWritable(): Writable {
  return new Writable({
    write(_chunk, _enc, callback) {
      callback();
    },
  });
}

describe('describeRequestedCapabilities', () => {
  it('an overlay with 3 different capability kinds (shell pattern, network host, tool grant) names all 3', () => {
    const overlayWithMcpWrite = {
      ...ACME_OVERLAY,
      requestsCapabilities: [
        { network: ['artifactory.internal'] },
        { exec: ['./gradlew *'] },
        { 'mcp-write': true },
      ],
    };

    const description = describeRequestedCapabilities({
      kind: 'overlay',
      document: overlayWithMcpWrite,
    });

    expect(description.id).toBe('acme-engineering');
    expect(description.name).toBe('ACME Engineering Standards');
    const kinds = description.entries.map((e) => e.kind);
    expect(kinds).toContain('network');
    expect(kinds).toContain('shell');
    expect(kinds).toContain('tool-grant');
    expect(description.text).toContain('artifactory.internal');
    expect(description.text).toContain('./gradlew *');
    expect(description.text).toContain('mcp-write');
  });

  it('also names an added MCP server from provides.mcp, as a fourth, distinct kind', () => {
    const description = describeRequestedCapabilities({ kind: 'overlay', document: ACME_OVERLAY });
    const mcpEntries = description.entries.filter((e) => e.kind === 'mcp-server');
    expect(mcpEntries.map((e) => e.text)).toEqual([
      'Add MCP server "acme-jira"',
      'Add MCP server "acme-confluence"',
    ]);
  });

  it('an explicit mcp-write: false is a non-request and is never fabricated into an entry', () => {
    const description = describeRequestedCapabilities({ kind: 'overlay', document: ACME_OVERLAY });
    expect(description.entries.some((e) => e.kind === 'tool-grant')).toBe(false);
  });

  it('omits nothing the manifest actually requests', () => {
    const manifest = {
      id: 'wide',
      name: 'Wide overlay',
      requestsCapabilities: [
        { network: ['a.example', 'b.example'] },
        { exec: ['./run *', 'make *'] },
        { 'mcp-write': true },
      ],
    };
    const description = describeRequestedCapabilities({ kind: 'overlay', document: manifest });
    expect(description.entries).toHaveLength(5);
    expect(description.entries.map((e) => e.text)).toEqual([
      'Reach network host "a.example"',
      'Reach network host "b.example"',
      'Run shell commands matching "./run *"',
      'Run shell commands matching "make *"',
      'Write via MCP tool calls (mcp-write)',
    ]);
  });

  it('refuses a malformed overlay document with a named CFG-036 error, fabricating nothing', () => {
    try {
      describeRequestedCapabilities({
        kind: 'overlay',
        document: { id: 'x', name: 'X', requestsCapabilities: [{ network: 'not-an-array' }] },
      });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(isForgeError(error)).toBe(true);
      if (isForgeError(error)) expect(error.code).toBe('CFG-036');
    }
  });

  it('a real module.yaml (ceilings) produces shell, network, and tool-grant entries', () => {
    const description = describeRequestedCapabilities({
      kind: 'module',
      module: FM_SERVICE_MODULE,
    });

    expect(description.id).toBe('fm-service');
    const kinds = new Set(description.entries.map((e) => e.kind));
    expect(kinds.has('shell')).toBe(true);
    expect(kinds.has('network')).toBe(true);
    expect(kinds.has('tool-grant')).toBe(true);
    // The `reviewer` role's own `write: false`/`network: 'none'` grants no entry of their own —
    // nothing is fabricated for a ceiling that grants nothing.
    expect(description.text).not.toContain('Deploy (role "reviewer")');
    expect(description.text).not.toContain('Write files (role "reviewer")');
  });

  it("an identical exec pattern granted to two different roles is shown as two distinct entries, not folded — each role's own grant is its own request", () => {
    // `FM_SERVICE_MODULE`'s own worked example: both "backend" and "reviewer" declare `"git *"`.
    const description = describeRequestedCapabilities({
      kind: 'module',
      module: FM_SERVICE_MODULE,
    });

    expect(description.text).toContain('Run shell commands matching "git *" (role "backend")');
    expect(description.text).toContain('Run shell commands matching "git *" (role "reviewer")');
    const gitEntries = description.entries.filter((e) => e.text.includes('"git *"'));
    expect(gitEntries).toHaveLength(2);
  });

  it('an "allowlist" network level with no allowlistHosts declared is disclosed as such, never rendered as if hosts existed', () => {
    const module = moduleSchema.parse({
      id: 'fm-empty-allowlist',
      name: 'Empty allowlist module',
      version: '1.0.0',
      forgeVersion: '>=1.0 <2',
      levels: ['L1'],
      ceilings: {
        ops: { write: false, network: 'allowlist' },
      },
      provides: {},
    });

    const description = describeRequestedCapabilities({ kind: 'module', module });

    expect(description.text).toContain(
      'Network access level "allowlist" (role "ops") (no hosts declared)',
    );
  });

  it('a module with no ceilings at all produces an explicit "none declared" description', () => {
    const bare = moduleSchema.parse({
      id: 'fm-bare',
      name: 'Bare module',
      version: '1.0.0',
      forgeVersion: '>=1.0 <2',
      levels: ['L1'],
      provides: {},
    });
    const description = describeRequestedCapabilities({ kind: 'module', module: bare });
    expect(description.entries).toHaveLength(0);
    expect(description.text).toContain('none declared');
  });
});

describe('promptForConsent', () => {
  it('--yes bypasses the prompt and never reads the input stream at all', async () => {
    const input = new Readable({
      read() {
        throw new Error('input must never be read when --yes is passed');
      },
    });
    const granted = await promptForConsent('Some capability description', {
      yes: true,
      input,
      output: nullWritable(),
    });
    expect(granted).toBe(true);
  });

  it('is never a silent default: omitting --yes never grants consent on its own', async () => {
    const input = Readable.from(['']); // stream ends immediately, no answer given
    const granted = await promptForConsent('Some capability description', {
      input,
      output: nullWritable(),
    });
    expect(granted).toBe(false);
  });

  it('a scripted "y" answer on the real interactive path grants consent', async () => {
    const input = Readable.from(['y\n']);
    const granted = await promptForConsent('Some capability description', {
      input,
      output: nullWritable(),
    });
    expect(granted).toBe(true);
  });

  it('a scripted "yes" answer (case-insensitive) also grants consent', async () => {
    const input = Readable.from(['YES\n']);
    const granted = await promptForConsent('Some capability description', {
      input,
      output: nullWritable(),
    });
    expect(granted).toBe(true);
  });

  it('a scripted "n" answer refuses', async () => {
    const input = Readable.from(['n\n']);
    const granted = await promptForConsent('Some capability description', {
      input,
      output: nullWritable(),
    });
    expect(granted).toBe(false);
  });

  it('a bare Enter (empty answer) refuses — the default posture is refuse, not accept', async () => {
    const input = Readable.from(['\n']);
    const granted = await promptForConsent('Some capability description', {
      input,
      output: nullWritable(),
    });
    expect(granted).toBe(false);
  });

  it('an input stream that ends before any answer (EOF) refuses rather than hanging', async () => {
    const input = new Readable({
      read() {
        this.push(null); // EOF immediately, no data at all
      },
    });
    const granted = await promptForConsent('Some capability description', {
      input,
      output: nullWritable(),
    });
    expect(granted).toBe(false);
  });

  it('a real stdin I/O failure (not merely EOF) fails closed rather than hanging or crashing the process', async () => {
    const input = new Readable({
      read() {
        // No data pushed here; the failure is fired explicitly below, once promptForConsent has had
        // a chance to attach its own listener — a real stream failure (a broken pipe, EIO) arrives
        // asynchronously too, never synchronously before a caller starts listening.
      },
    });
    const resultPromise = promptForConsent('Some capability description', {
      input,
      output: nullWritable(),
    });
    await new Promise((resolve) => setImmediate(resolve));
    input.emit('error', new Error('EIO: simulated stream failure'));

    const granted = await resultPromise;
    // Reaching this assertion at all (rather than the test hanging or the process crashing on an
    // unhandled 'error' event, which Node treats as fatal by default) is itself part of what this
    // test proves.
    expect(granted).toBe(false);
  });

  it('--json prints the description and refuses without --yes, never blocking on a real prompt', async () => {
    const chunks: string[] = [];
    const output = new Writable({
      write(chunk: Buffer, _enc, callback) {
        chunks.push(chunk.toString('utf8'));
        callback();
      },
    });
    const input = new Readable({
      read() {
        throw new Error('input must never be read in --json mode without --yes');
      },
    });
    const granted = await promptForConsent('Some capability description', {
      json: true,
      input,
      output,
    });
    expect(granted).toBe(false);
    const printed: unknown = JSON.parse(chunks.join(''));
    expect(printed).toEqual({ description: 'Some capability description', granted: false });
  });

  it('--yes and --json together still auto-accept AND still produce valid, parseable JSON — a critic round found the first draft silently fell back to a free-form prose line here, breaking the exact "pipe this into jq" contract --json documents', async () => {
    const chunks: string[] = [];
    const output = new Writable({
      write(chunk: Buffer, _enc, callback) {
        chunks.push(chunk.toString('utf8'));
        callback();
      },
    });

    const granted = await promptForConsent('Some capability description', {
      yes: true,
      json: true,
      output,
    });

    expect(granted).toBe(true);
    const printed: unknown = JSON.parse(chunks.join(''));
    expect(printed).toEqual({ description: 'Some capability description', granted: true });
  });
});

describe('refusal writes nothing to disk — the actual, mechanical guarantee', () => {
  it('consent.ts contains none of the filesystem/process-mutation calls that could write to disk — the direct, non-tautological proof behind this file\'s own "never touches the filesystem" claim', async () => {
    const consentSourcePath = path.join(
      import.meta.dirname,
      '..',
      '..',
      'src',
      'install',
      'consent.ts',
    );
    const source = await readFile(consentSourcePath, 'utf8');
    const bannedIdentifiers = [
      'writeFile',
      'appendFile',
      'mkdir',
      'rmdir',
      'rm(',
      'rmSync',
      'unlink',
      'createWriteStream',
      'execa(',
      'spawn(',
      "from 'node:fs'",
      'from "node:fs"',
      "from 'node:fs/promises'",
      'from "node:fs/promises"',
      "from 'node:child_process'",
      "from 'execa'",
    ];
    for (const identifier of bannedIdentifiers) {
      expect(source, `consent.ts must never contain "${identifier}"`).not.toContain(identifier);
    }
  });

  it('promptForConsent never writes to the filesystem on refusal, and a caller gating install on its result writes nothing either — demonstrates the safe consumption pattern a real installer (PLAN-M11.md P5, not yet built) is required to follow; the mechanical guarantee itself is the source-inspection test above', async () => {
    const projectDir = await freshDir();
    const forgeDir = path.join(projectDir, '.forge');
    await mkdir(path.join(forgeDir, 'overrides'), { recursive: true });
    await writeFile(path.join(forgeDir, 'config.yaml'), 'schemaVersion: 1\n');
    await writeFile(path.join(forgeDir, 'manifest.yaml'), 'modules: []\n');
    await writeFile(path.join(forgeDir, 'overrides', 'agent.acme.yaml'), 'role: backend\n');

    const before = await computeContentChecksum(forgeDir);

    const description = describeRequestedCapabilities({ kind: 'overlay', document: ACME_OVERLAY });
    const input = Readable.from(['n\n']);
    const granted = await promptForConsent(description.text, { input, output: nullWritable() });
    expect(granted).toBe(false);

    // The exact shape a real installer (`PLAN-M11.md` P5) is required to follow: only write anything
    // when consent was granted.
    let installRan = false;
    if (granted) {
      installRan = true;
      await writeFile(path.join(forgeDir, 'modules', 'acme-engineering', 'module.yaml'), 'id: x\n');
    }
    expect(installRan).toBe(false);

    const after = await computeContentChecksum(forgeDir);
    expect(after).toBe(before);
  });

  it('the identical tree, with a granted consent, is free to change (proves the checksum comparison is meaningful, not vacuously equal)', async () => {
    const projectDir = await freshDir();
    const forgeDir = path.join(projectDir, '.forge');
    await mkdir(forgeDir, { recursive: true });
    await writeFile(path.join(forgeDir, 'config.yaml'), 'schemaVersion: 1\n');

    const before = await computeContentChecksum(forgeDir);

    const description = describeRequestedCapabilities({ kind: 'overlay', document: ACME_OVERLAY });
    const input = Readable.from(['y\n']);
    const granted = await promptForConsent(description.text, { input, output: nullWritable() });
    expect(granted).toBe(true);

    if (granted) {
      await writeFile(path.join(forgeDir, 'manifest.yaml'), 'modules: [acme-engineering]\n');
    }

    const after = await computeContentChecksum(forgeDir);
    expect(after).not.toBe(before);
  });
});
