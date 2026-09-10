/**
 * Branches the main conformance suite test doesn't reach: each `checkC*` function's own "precondition
 * still somehow not met" guard (only reachable by calling the check directly, bypassing the `it()`
 * wrapper's `skip()` — exactly the situation this piece's own suite.test.ts already relies on for its
 * fails-closed proofs), and C16's orphan-`tool.result` defensive branch.
 *
 * @see specs/07 §7.6
 * @see PLAN-M4.md P4
 */
import { describe, expect, it } from 'vitest';

import {
  checkC8StructuredOutput,
  checkC9Resume,
  checkC15SkillScoping,
  checkC16McpGrantFidelity,
} from '../../src/conformance/capabilities.ts';
import { createConformanceContext } from '../../src/conformance/context.ts';
import type { ConformanceOptions } from '../../src/conformance/fixtures.ts';
import type { AdapterCapabilities, PlatformAdapter } from '../../src/types/index.ts';

function stubOptions(overrides: Partial<ConformanceOptions> = {}): ConformanceOptions {
  return {
    createScratchDir: () => Promise.resolve('/tmp/unused'),
    validModel: 'model',
    invalidModel: 'invalid-model',
    helloPrompt: 'hello',
    writeFilePrompt: 'write',
    manyTurnsPrompt: 'many-turns',
    execPrompt: 'exec',
    secretProbe: { value: 'secret', prompt: 'probe' },
    controlTokenPrompt: 'control',
    ...overrides,
  };
}

const CAPABILITIES: AdapterCapabilities = {
  streaming: true,
  partialText: false,
  sessionResume: true,
  interject: false,
  structuredOutput: true,
  toolAllowlist: true,
  permissionModes: ['auto'],
  subagents: false,
  mcp: true,
  costReporting: 'none',
  tokenReporting: true,
  maxConcurrentSessions: 0,
  cwdIsolation: true,
  systemPromptControl: 'append',
  fileEditing: true,
  bash: true,
  network: 'none',
  bareMode: true,
  skills: 'inline',
  toolProxy: false,
};

function minimalAdapter(overrides: Partial<PlatformAdapter> = {}): PlatformAdapter {
  return {
    id: 'minimal',
    displayName: 'Minimal',
    capabilities: () => Promise.resolve(CAPABILITIES),
    preflight: () => Promise.resolve({ ok: true, issues: [] }),
    listModels: () => Promise.resolve([]),
    startSession: () => Promise.reject(new Error('startSession not implemented for this test')),
    resumeSession: () => Promise.reject(new Error('resumeSession not implemented for this test')),
    ...overrides,
  };
}

async function buildContext(adapter: PlatformAdapter, options: ConformanceOptions) {
  const { context, setAdapter, setCapabilities } = createConformanceContext(options);
  setAdapter(adapter);
  setCapabilities(await adapter.capabilities());
  return context;
}

describe('checkC8StructuredOutput — precondition guard', () => {
  it('throws plainly when called directly with no structured fixture supplied', async () => {
    const context = await buildContext(minimalAdapter(), stubOptions());
    await expect(checkC8StructuredOutput(context)).rejects.toThrow(/no structured fixture/);
  });
});

describe('checkC9Resume — precondition guard', () => {
  it('throws plainly when called directly with no resume fixture supplied', async () => {
    const context = await buildContext(minimalAdapter(), stubOptions());
    await expect(checkC9Resume(context)).rejects.toThrow(/no resume fixture/);
  });
});

describe('checkC15SkillScoping — precondition guards', () => {
  it('throws plainly when called directly with no skill fixture supplied', async () => {
    const context = await buildContext(minimalAdapter(), stubOptions());
    await expect(checkC15SkillScoping(context)).rejects.toThrow(/no skill fixture/);
  });

  it('throws plainly when the adapter has no provisionSkills method', async () => {
    const options = stubOptions({
      skill: {
        skill: { id: 's', summary: '', body: '', appliesTo: [] },
        prompt: 'p',
        expectedFragment: 'f',
      },
    });
    // provisionSkills omitted entirely — a legitimately optional method left unimplemented.
    const context = await buildContext(minimalAdapter(), options);
    await expect(checkC15SkillScoping(context)).rejects.toThrow(
      /provisionSkills is not implemented/,
    );
  });

  function skillStrategyAdapter(
    skillsCapability: 'native' | 'inline' | 'none',
    strategy: 'native' | 'inline' | 'bodies-injected',
  ): PlatformAdapter {
    const provisionedStepIds = new Set<string>();
    return minimalAdapter({
      capabilities: () => Promise.resolve({ ...CAPABILITIES, skills: skillsCapability }),
      provisionSkills: (skills, ctx) => {
        provisionedStepIds.add(ctx.stepId);
        return Promise.resolve({ strategy, provisionedSkillIds: skills.map((skill) => skill.id) });
      },
      startSession: (request) =>
        Promise.resolve({
          sessionId: 's1',
          events: {
            [Symbol.asyncIterator]: () => ({
              next: () => Promise.resolve({ done: true as const, value: undefined }),
            }),
          },
          stop: () => Promise.resolve(),
          result: () =>
            Promise.resolve({
              sessionId: 's1',
              ok: true,
              finalText: provisionedStepIds.has(request.stepId)
                ? 'the-skill-fragment'
                : 'nothing provisioned',
              usage: { inputTokens: 0, outputTokens: 0, turns: 1 },
              durationMs: 0,
              changedFiles: [],
              controlTokens: [],
            }),
        }),
    });
  }

  it("15 §15.6's own mapping: skills:'native' capability expects strategy:'native'", async () => {
    const options = stubOptions({
      skill: {
        skill: { id: 's', summary: '', body: '', appliesTo: [] },
        prompt: 'p',
        expectedFragment: 'the-skill-fragment',
      },
    });
    const context = await buildContext(skillStrategyAdapter('native', 'native'), options);
    await expect(checkC15SkillScoping(context)).resolves.toBeUndefined();
  });

  it("15 §15.6's own mapping: skills:'none' capability expects strategy:'bodies-injected'", async () => {
    const options = stubOptions({
      skill: {
        skill: { id: 's', summary: '', body: '', appliesTo: [] },
        prompt: 'p',
        expectedFragment: 'the-skill-fragment',
      },
    });
    const context = await buildContext(skillStrategyAdapter('none', 'bodies-injected'), options);
    await expect(checkC15SkillScoping(context)).resolves.toBeUndefined();
  });

  it('rejects a strategy that does not match the declared skills capability', async () => {
    const options = stubOptions({
      skill: {
        skill: { id: 's', summary: '', body: '', appliesTo: [] },
        prompt: 'p',
        expectedFragment: 'the-skill-fragment',
      },
    });
    // Declares 'native' but the provisioning claims 'inline' — a real mismatch the row's own
    // "declared degradation strategy is applied" clause exists to catch.
    const context = await buildContext(skillStrategyAdapter('native', 'inline'), options);
    await expect(checkC15SkillScoping(context)).rejects.toThrow();
  });
});

describe('checkC16McpGrantFidelity — precondition guards and orphan tool.result', () => {
  const server = {
    id: 'server-1',
    transport: 'stdio' as const,
    command: 'echo',
    grantedTools: ['allowed'],
  };

  it('throws plainly when called directly with no mcp fixture supplied', async () => {
    const context = await buildContext(minimalAdapter(), stubOptions());
    await expect(checkC16McpGrantFidelity(context)).rejects.toThrow(/no mcp fixture/);
  });

  it('throws plainly when the adapter has no provisionMcp method', async () => {
    const options = stubOptions({
      mcp: { server, allowedToolName: 'allowed', deniedToolName: 'denied', prompt: 'p' },
    });
    // provisionMcp omitted entirely — a legitimately optional method left unimplemented.
    const context = await buildContext(minimalAdapter(), options);
    await expect(checkC16McpGrantFidelity(context)).rejects.toThrow(
      /provisionMcp is not implemented/,
    );
  });

  it('ignores a tool.result event whose id matches no prior tool.call, rather than crashing', async () => {
    const options = stubOptions({
      mcp: { server, allowedToolName: 'allowed', deniedToolName: 'denied', prompt: 'p' },
    });
    const adapter = minimalAdapter({
      provisionMcp: (servers) => Promise.resolve({ loadedServerIds: servers.map((s) => s.id) }),
      startSession: () =>
        Promise.resolve({
          sessionId: 's1',
          events: (async function* () {
            await Promise.resolve();
            // An orphan tool.result with no matching tool.call — no name can be resolved for it, so
            // it must be skipped rather than crash the correlation logic.
            yield { type: 'tool.result' as const, id: 'no-such-call', ok: true, summary: 'orphan' };
            yield { type: 'tool.call' as const, id: 'call-allowed', name: 'allowed' };
            yield {
              type: 'tool.result' as const,
              id: 'call-allowed',
              ok: true,
              summary: 'allowed ok',
            };
            yield { type: 'session.ended' as const, reason: 'complete' as const };
          })(),
          stop: () => Promise.resolve(),
          result: () =>
            Promise.resolve({
              sessionId: 's1',
              ok: true,
              finalText: '',
              usage: { inputTokens: 0, outputTokens: 0, turns: 1 },
              durationMs: 0,
              changedFiles: [],
              controlTokens: [],
            }),
        }),
    });
    const context = await buildContext(adapter, options);
    await expect(checkC16McpGrantFidelity(context)).resolves.toBeUndefined();
  });
});
