/**
 * `createForgeMcpServer` — `07` §7.3's own 9-tool table, exercised against a real, connecting MCP
 * client (`@modelcontextprotocol/sdk`'s own `Client` + `InMemoryTransport`, never Claude Code itself)
 * round-tripping to a real, injected fixture `ForgeMcpBackend`. `PLAN-M7.md` P8's own three Checks,
 * verbatim.
 *
 * @see specs/07 §7.3
 * @see PLAN-M7.md P8
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { beforeEach, describe, expect, it } from 'vitest';

import type {
  AcknowledgedResult,
  AskAnswer,
  AssumeConfidence,
  ForgeMcpBackend,
  KbEntry,
  KbSearchHit,
  SkillBody,
  SpecEntry,
} from '../../src/forge-mcp/backend.ts';
import { createForgeMcpServer } from '../../src/forge-mcp/server.ts';

const ALL_TOOL_NAMES = [
  'forge_kb_search',
  'forge_kb_get',
  'forge_spec_get',
  'forge_ask',
  'forge_assume',
  'forge_handoff',
  'forge_request_change',
  'forge_report',
  'forge_skill_load',
] as const;

class RecordingBackend implements ForgeMcpBackend {
  readonly calls: { readonly method: string; readonly args: readonly unknown[] }[] = [];
  private failNextKbSearch = false;

  failKbSearchOnce(): void {
    this.failNextKbSearch = true;
  }

  kbSearch(query: string): Promise<readonly KbSearchHit[]> {
    this.calls.push({ method: 'kbSearch', args: [query] });
    if (this.failNextKbSearch) {
      this.failNextKbSearch = false;
      throw new Error('kb backend unavailable');
    }
    return Promise.resolve([
      { id: 'kb-1', title: 'Widget guide', snippet: 'How widgets work', score: 0.9 },
    ]);
  }

  kbGet(id: string): Promise<KbEntry | undefined> {
    this.calls.push({ method: 'kbGet', args: [id] });
    return Promise.resolve(
      id === 'kb-1' ? { id: 'kb-1', content: 'Full widget guide text.' } : undefined,
    );
  }

  specGet(id: string): Promise<SpecEntry | undefined> {
    this.calls.push({ method: 'specGet', args: [id] });
    return Promise.resolve(
      id === '07' ? { id: '07', content: 'Platform adapters spec text.' } : undefined,
    );
  }

  ask(question: string, options: readonly string[]): Promise<AskAnswer> {
    this.calls.push({ method: 'ask', args: [question, options] });
    return Promise.resolve({ answer: 'yes, proceed' });
  }

  assume(text: string, confidence: AssumeConfidence, impact: string): Promise<AcknowledgedResult> {
    this.calls.push({ method: 'assume', args: [text, confidence, impact] });
    return Promise.resolve({ acknowledged: true });
  }

  handoff(role: string, reason: string): Promise<AcknowledgedResult> {
    this.calls.push({ method: 'handoff', args: [role, reason] });
    return Promise.resolve({ acknowledged: true });
  }

  requestChange(target: string, reason: string): Promise<AcknowledgedResult> {
    this.calls.push({ method: 'requestChange', args: [target, reason] });
    return Promise.resolve({ acknowledged: true });
  }

  report(kind: string, payload: unknown): Promise<AcknowledgedResult> {
    this.calls.push({ method: 'report', args: [kind, payload] });
    return Promise.resolve({ acknowledged: true });
  }

  skillLoad(id: string): Promise<SkillBody | undefined> {
    this.calls.push({ method: 'skillLoad', args: [id] });
    return Promise.resolve(id === 'deploy' ? { body: '## Deploy\n\nFull skill body.' } : undefined);
  }
}

async function connectedClient(
  backend: ForgeMcpBackend,
): Promise<{ client: Client; backend: ForgeMcpBackend }> {
  const server = createForgeMcpServer(backend);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'forge-mcp-test-client', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, backend };
}

describe('createForgeMcpServer', () => {
  let backend: RecordingBackend;
  let client: Client;

  beforeEach(async () => {
    backend = new RecordingBackend();
    const connected = await connectedClient(backend);
    client = connected.client;
  });

  it('registers all 9 tools from the real, verbatim 07 §7.3 table', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([...ALL_TOOL_NAMES].sort());
  });

  it('forge_kb_search round-trips to backend.kbSearch and returns its real result as structuredContent', async () => {
    const result = await client.callTool({
      name: 'forge_kb_search',
      arguments: { query: 'widgets' },
    });
    expect(backend.calls).toEqual([{ method: 'kbSearch', args: ['widgets'] }]);
    expect(result.structuredContent).toEqual({
      hits: [{ id: 'kb-1', title: 'Widget guide', snippet: 'How widgets work', score: 0.9 }],
    });
    expect(result.isError).toBeUndefined();
  });

  it('forge_kb_get round-trips and reports found:false for an unknown id, not an error', async () => {
    const found = await client.callTool({ name: 'forge_kb_get', arguments: { id: 'kb-1' } });
    expect(found.structuredContent).toEqual({
      found: true,
      entry: { id: 'kb-1', content: 'Full widget guide text.' },
    });

    const missing = await client.callTool({
      name: 'forge_kb_get',
      arguments: { id: 'no-such-id' },
    });
    expect(missing.structuredContent).toEqual({ found: false });
    expect(missing.isError).toBeUndefined();
  });

  it('forge_spec_get round-trips and reports found:false for an unknown id, not an error', async () => {
    const found = await client.callTool({ name: 'forge_spec_get', arguments: { id: '07' } });
    expect(found.structuredContent).toEqual({
      found: true,
      entry: { id: '07', content: 'Platform adapters spec text.' },
    });

    const missing = await client.callTool({
      name: 'forge_spec_get',
      arguments: { id: 'no-such-spec' },
    });
    expect(missing.structuredContent).toEqual({ found: false });
  });

  it('forge_ask round-trips question and options (defaulting to []) to backend.ask, returning its real answer', async () => {
    const result = await client.callTool({
      name: 'forge_ask',
      arguments: { question: 'Proceed with the migration?', options: ['yes', 'no'] },
    });
    expect(backend.calls).toEqual([
      { method: 'ask', args: ['Proceed with the migration?', ['yes', 'no']] },
    ]);
    expect(result.structuredContent).toEqual({ answer: 'yes, proceed' });

    const withoutOptions = await client.callTool({
      name: 'forge_ask',
      arguments: { question: 'Anything else?' },
    });
    expect(backend.calls[1]).toEqual({ method: 'ask', args: ['Anything else?', []] });
    expect(withoutOptions.structuredContent).toEqual({ answer: 'yes, proceed' });
  });

  it('forge_assume round-trips text/confidence/impact to backend.assume verbatim, 3 params only', async () => {
    const result = await client.callTool({
      name: 'forge_assume',
      arguments: {
        text: 'The staging DB mirrors prod schema.',
        confidence: 'medium',
        impact: 'blocks migration if wrong',
      },
    });
    expect(backend.calls).toEqual([
      {
        method: 'assume',
        args: ['The staging DB mirrors prod schema.', 'medium', 'blocks migration if wrong'],
      },
    ]);
    expect(result.structuredContent).toEqual({ acknowledged: true });
  });

  it('forge_assume rejects a confidence value outside low/medium/high with a real MCP error, not a crash', async () => {
    const result = await client.callTool({
      name: 'forge_assume',
      arguments: { text: 'x', confidence: 'extremely-high', impact: 'y' },
    });
    expect(result.isError).toBe(true);
    expect(backend.calls).toEqual([]);
  });

  it('forge_handoff round-trips role/reason to backend.handoff', async () => {
    const result = await client.callTool({
      name: 'forge_handoff',
      arguments: { role: 'reviewer', reason: 'needs a second pair of eyes on the migration' },
    });
    expect(backend.calls).toEqual([
      { method: 'handoff', args: ['reviewer', 'needs a second pair of eyes on the migration'] },
    ]);
    expect(result.structuredContent).toEqual({ acknowledged: true });
  });

  it('forge_request_change round-trips target/reason to backend.requestChange', async () => {
    const result = await client.callTool({
      name: 'forge_request_change',
      arguments: { target: 'specs/07 §7.3', reason: 'the 9-tool table is missing a field' },
    });
    expect(backend.calls).toEqual([
      { method: 'requestChange', args: ['specs/07 §7.3', 'the 9-tool table is missing a field'] },
    ]);
    expect(result.structuredContent).toEqual({ acknowledged: true });
  });

  it('forge_report round-trips kind/payload (including a structured object payload) to backend.report', async () => {
    const payload = { findings: [{ severity: 'high', summary: 'real bug' }] };
    const result = await client.callTool({
      name: 'forge_report',
      arguments: { kind: 'review', payload },
    });
    expect(backend.calls).toEqual([{ method: 'report', args: ['review', payload] }]);
    expect(result.structuredContent).toEqual({ acknowledged: true });
  });

  it('a backend method that throws produces a real MCP error result, not an uncaught rejection that kills the server', async () => {
    backend.failKbSearchOnce();
    const result = await client.callTool({
      name: 'forge_kb_search',
      arguments: { query: 'widgets' },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('kb backend unavailable');

    // The server itself must still be alive and answering correctly afterward -- proves this was a
    // real, isolated per-call error result, not something that took the whole connection down.
    const after = await client.callTool({
      name: 'forge_kb_search',
      arguments: { query: 'widgets' },
    });
    expect(after.isError).toBeUndefined();
    expect(after.structuredContent).toEqual({
      hits: [{ id: 'kb-1', title: 'Widget guide', snippet: 'How widgets work', score: 0.9 }],
    });
  });

  describe('forge_skill_load', () => {
    it("the tool's own real, registered JSON schema accepts exactly a skill id and nothing else", async () => {
      const { tools } = await client.listTools();
      const skillLoadTool = tools.find((tool) => tool.name === 'forge_skill_load');
      expect(skillLoadTool).toBeDefined();
      const schema = skillLoadTool?.inputSchema as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      expect(Object.keys(schema.properties ?? {})).toEqual(['id']);
      expect(schema.required).toEqual(['id']);
    });

    it('15 §15.4.3 progressive-disclosure fallback: a known skill id returns its real body verbatim', async () => {
      const result = await client.callTool({
        name: 'forge_skill_load',
        arguments: { id: 'deploy' },
      });
      expect(backend.calls).toEqual([{ method: 'skillLoad', args: ['deploy'] }]);
      expect(result.structuredContent).toEqual({
        found: true,
        body: '## Deploy\n\nFull skill body.',
      });
      expect(result.isError).toBeUndefined();
    });

    it('an unknown skill id reports found:false, not an error', async () => {
      const result = await client.callTool({
        name: 'forge_skill_load',
        arguments: { id: 'no-such-skill' },
      });
      expect(result.structuredContent).toEqual({ found: false });
      expect(result.isError).toBeUndefined();
    });
  });
});
