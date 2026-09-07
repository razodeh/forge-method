/**
 * `provisionSkills`/`provisionMcp` scope what they provision by `(runId, stepId)`, not `stepId` alone —
 * a step id like `"implement"` is naturally reused across different runs, and a skill/MCP tool granted
 * to one run's step must never be visible to a different run's same-named step. A fresh critic round
 * found the fake scoped by `stepId` only, leaking a provisioned skill across runs that happened to reuse
 * a step id — these tests pin the fix.
 *
 * @see specs/15 §15.6
 * @see specs/07 §7.6 (C15)
 * @see PLAN-M4.md P5
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { FAKE_MODEL_ID, FakePlatformAdapter, withCapabilities } from '../src/fake-adapter.ts';

async function createScratchDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'forge-testkit-provisioning-'));
}

function baseRequest(overrides: Record<string, unknown> = {}) {
  return {
    runId: 'r',
    stepId: 's',
    cwd: '',
    systemPrompt: { mode: 'append' as const, text: '' },
    prompt: '',
    model: FAKE_MODEL_ID,
    tools: { read: true, write: true, exec: false as const, network: 'none' as const },
    permissionMode: 'auto' as const,
    limits: {},
    env: {},
    abortSignal: new AbortController().signal,
    ...overrides,
  };
}

describe('provisionSkills scoping', () => {
  it('a skill provisioned for one run does not leak into a different run that reuses the same stepId', async () => {
    const adapter = new FakePlatformAdapter();
    const cwd = await createScratchDir();
    adapter.script((r) => r.prompt === 'go', { skillVisibleText: 'SKILL VISIBLE' });

    await adapter.provisionSkills([{ id: 'skill-1', summary: 's', body: 'b', appliesTo: [] }], {
      runId: 'run-A',
      stepId: 'implement',
      cwd,
    });

    const sameRun = await adapter.startSession(baseRequest({ cwd, prompt: 'go', runId: 'run-A', stepId: 'implement' }));
    const sameRunResult = await sameRun.result();
    expect(sameRunResult.finalText).toContain('SKILL VISIBLE');

    const differentRun = await adapter.startSession(
      baseRequest({ cwd, prompt: 'go', runId: 'run-B', stepId: 'implement' }),
    );
    const differentRunResult = await differentRun.result();
    expect(differentRunResult.finalText).not.toContain('SKILL VISIBLE');
  });

  it("15 §15.6's strategy mapping: 'inline' and 'none' capabilities report 'inline'/'bodies-injected'", async () => {
    const cwd = await createScratchDir();

    const inlineAdapter = withCapabilities({ skills: 'inline' });
    const inlineResult = await inlineAdapter.provisionSkills([], { runId: 'r', stepId: 's', cwd });
    expect(inlineResult.strategy).toBe('inline');

    const noneAdapter = withCapabilities({ skills: 'none' });
    const noneResult = await noneAdapter.provisionSkills([], { runId: 'r', stepId: 's', cwd });
    expect(noneResult.strategy).toBe('bodies-injected');
  });
});

describe('provisionMcp scoping', () => {
  it('an MCP tool grant for one run does not leak into a different run that reuses the same stepId', async () => {
    const adapter = new FakePlatformAdapter();
    const cwd = await createScratchDir();
    adapter.script((r) => r.prompt === 'go', { mcpToolAttempts: ['granted-tool'] });

    await adapter.provisionMcp?.(
      [{ id: 'server-1', transport: 'stdio', command: 'noop', grantedTools: ['granted-tool'] }],
      { runId: 'run-A', stepId: 'implement', cwd },
    );

    const sameRun = await adapter.startSession(baseRequest({ cwd, prompt: 'go', runId: 'run-A', stepId: 'implement' }));
    const sameRunEvents = [];
    for await (const event of sameRun.events) sameRunEvents.push(event);
    expect(sameRunEvents.some((event) => event.type === 'tool.result' && event.ok)).toBe(true);

    const differentRun = await adapter.startSession(
      baseRequest({ cwd, prompt: 'go', runId: 'run-B', stepId: 'implement' }),
    );
    const differentRunEvents = [];
    for await (const event of differentRun.events) differentRunEvents.push(event);
    expect(differentRunEvents.some((event) => event.type === 'tool.result' && !event.ok)).toBe(true);
  });

  it("grantedTools: '*' grants every tool name, not none", async () => {
    const adapter = new FakePlatformAdapter();
    const cwd = await createScratchDir();
    adapter.script((r) => r.prompt === 'go', { mcpToolAttempts: ['any-tool-name-at-all'] });

    await adapter.provisionMcp?.([{ id: 'server-1', transport: 'stdio', command: 'noop', grantedTools: '*' }], {
      runId: 'run-A',
      stepId: 'implement',
      cwd,
    });

    const handle = await adapter.startSession(baseRequest({ cwd, prompt: 'go', runId: 'run-A', stepId: 'implement' }));
    const events = [];
    for await (const event of handle.events) events.push(event);

    expect(events.some((event) => event.type === 'tool.result' && event.ok)).toBe(true);
  });

  it("a '*' server mixed with an explicit-list server in the same call still grants everything, not just the explicit list", async () => {
    const adapter = new FakePlatformAdapter();
    const cwd = await createScratchDir();
    adapter.script((r) => r.prompt === 'go', { mcpToolAttempts: ['listed-tool', 'unlisted-tool'] });

    await adapter.provisionMcp?.(
      [
        { id: 'server-explicit', transport: 'stdio', command: 'noop', grantedTools: ['listed-tool'] },
        { id: 'server-wildcard', transport: 'stdio', command: 'noop', grantedTools: '*' },
      ],
      { runId: 'run-A', stepId: 'implement', cwd },
    );

    const handle = await adapter.startSession(baseRequest({ cwd, prompt: 'go', runId: 'run-A', stepId: 'implement' }));
    const events = [];
    for await (const event of handle.events) events.push(event);

    const results = events.filter((event) => event.type === 'tool.result');
    expect(results).toHaveLength(2);
    expect(results.every((event) => event.ok)).toBe(true);
  });
});
