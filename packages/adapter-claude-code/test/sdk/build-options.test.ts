/**
 * `buildSdkOptions` — `07` §7.3's own mapping table, SDK column.
 *
 * @see specs/07 §7.3
 * @see PLAN-M7.md P3
 */
import { describe, expect, it } from 'vitest';

import type { HookCallback } from '@anthropic-ai/claude-agent-sdk';
import { claudeCodeAdapterConfigSchema } from '../../src/config.ts';
import { buildSdkOptions } from '../../src/sdk/build-options.ts';
import { mapToolGrantToAllowedTools } from '../../src/tool-grant.ts';
import type { SessionRequest } from '@forge/adapter-kit';

function baseRequest(overrides: Partial<SessionRequest> = {}): SessionRequest {
  return {
    runId: 'run-1',
    stepId: 'implement-story-1',
    cwd: '/tmp/lane',
    systemPrompt: { mode: 'append', text: 'You are a FORGE engineer.' },
    prompt: 'Implement the story.',
    model: 'claude-sonnet-5',
    tools: { read: true, write: true, exec: false, network: 'none' },
    permissionMode: 'accept-edits',
    limits: {},
    env: {},
    abortSignal: new AbortController().signal,
    ...overrides,
  };
}

describe('buildSdkOptions', () => {
  it('passes cwd and model verbatim', () => {
    const options = buildSdkOptions(
      baseRequest({ cwd: '/tmp/some-lane', model: 'claude-fable-5-1' }),
      claudeCodeAdapterConfigSchema.parse({}),
    );
    expect(options.cwd).toBe('/tmp/some-lane');
    expect(options.model).toBe('claude-fable-5-1');
  });

  it('reuses the exact same mapToolGrantToAllowedTools function the CLI transport (P2) exports, not a second, potentially-diverging copy', () => {
    const grant: SessionRequest['tools'] = {
      read: false,
      write: false,
      exec: ['pnpm test*'],
      network: 'none',
    };
    const options = buildSdkOptions(
      baseRequest({ tools: grant }),
      claudeCodeAdapterConfigSchema.parse({}),
    );
    expect(options.allowedTools).toEqual([...mapToolGrantToAllowedTools(grant)]);
  });

  it.each([
    ['deny-unlisted', 'dontAsk'],
    ['accept-edits', 'acceptEdits'],
    ['auto', 'auto'],
    ['manual', 'default'],
  ] as const)(
    'maps permissionMode %s to the real SDK PermissionMode value %s',
    (mode, expected) => {
      const options = buildSdkOptions(
        baseRequest({ permissionMode: mode }),
        claudeCodeAdapterConfigSchema.parse({}),
      );
      expect(options.permissionMode).toBe(expected);
    },
  );

  it('always sets includePartialMessages: true', () => {
    const options = buildSdkOptions(baseRequest(), claudeCodeAdapterConfigSchema.parse({}));
    expect(options.includePartialMessages).toBe(true);
  });

  it('sets settingSources: [] (real SDK isolation mode) when config.bare is true', () => {
    const options = buildSdkOptions(
      baseRequest(),
      claudeCodeAdapterConfigSchema.parse({ bare: true }),
    );
    expect(options.settingSources).toEqual([]);
  });

  it('omits settingSources entirely when config.bare is false (real SDK default: all sources load)', () => {
    const options = buildSdkOptions(
      baseRequest(),
      claudeCodeAdapterConfigSchema.parse({ bare: false }),
    );
    expect(options.settingSources).toBeUndefined();
  });

  it("systemPrompt.mode 'append' maps to the real preset-append form", () => {
    const options = buildSdkOptions(
      baseRequest({ systemPrompt: { mode: 'append', text: 'extra context' } }),
      claudeCodeAdapterConfigSchema.parse({}),
    );
    expect(options.systemPrompt).toEqual({
      type: 'preset',
      preset: 'claude_code',
      append: 'extra context',
    });
  });

  it("systemPrompt.mode 'replace' maps to a bare custom-string prompt", () => {
    const options = buildSdkOptions(
      baseRequest({ systemPrompt: { mode: 'replace', text: 'full replacement' } }),
      claudeCodeAdapterConfigSchema.parse({}),
    );
    expect(options.systemPrompt).toBe('full replacement');
  });

  it('sets maxTurns from limits.maxTurns when present -- unlike the CLI transport, the SDK genuinely supports this natively', () => {
    const options = buildSdkOptions(
      baseRequest({ limits: { maxTurns: 5 } }),
      claudeCodeAdapterConfigSchema.parse({}),
    );
    expect(options.maxTurns).toBe(5);
  });

  it('omits maxTurns entirely when limits.maxTurns is absent', () => {
    const options = buildSdkOptions(
      baseRequest({ limits: {} }),
      claudeCodeAdapterConfigSchema.parse({}),
    );
    expect(options.maxTurns).toBeUndefined();
  });

  it('sets outputFormat to the real json_schema shape when outputSchema is set', () => {
    const schema = { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] };
    const options = buildSdkOptions(
      baseRequest({ outputSchema: schema }),
      claudeCodeAdapterConfigSchema.parse({}),
    );
    expect(options.outputFormat).toEqual({ type: 'json_schema', schema });
  });

  it('omits outputFormat entirely when outputSchema is absent', () => {
    const options = buildSdkOptions(baseRequest(), claudeCodeAdapterConfigSchema.parse({}));
    expect(options.outputFormat).toBeUndefined();
  });

  it('sets resume to the given resumeSessionId (P4)', () => {
    const options = buildSdkOptions(
      baseRequest(),
      claudeCodeAdapterConfigSchema.parse({}),
      'session-abc',
    );
    expect(options.resume).toBe('session-abc');
  });

  it('omits resume entirely for a fresh (non-resumed) session', () => {
    const options = buildSdkOptions(baseRequest(), claudeCodeAdapterConfigSchema.parse({}));
    expect(options.resume).toBeUndefined();
  });

  it('mcp.allowedTools (P7) is merged into the same allowedTools array as the plain ToolGrant-derived entries', () => {
    const options = buildSdkOptions(
      baseRequest({ tools: { read: true, write: false, exec: false, network: 'none' } }),
      claudeCodeAdapterConfigSchema.parse({}),
      undefined,
      { allowedTools: ['mcp__github__get_issue'], serverConfig: {}, strict: true },
    );
    expect(options.allowedTools).toEqual(['Read', 'mcp__github__get_issue']);
  });

  it('sets mcpServers and strictMcpConfig from the real, confirmed field names when mcp extras are given', () => {
    const options = buildSdkOptions(
      baseRequest(),
      claudeCodeAdapterConfigSchema.parse({}),
      undefined,
      {
        allowedTools: [],
        serverConfig: { github: { type: 'stdio', command: 'npx' } },
        strict: true,
      },
    );
    expect(options.mcpServers).toEqual({ github: { type: 'stdio', command: 'npx' } });
    expect(options.strictMcpConfig).toBe(true);
  });

  it('strictMcpConfig reflects mcp.strict:false (config.mcp.adoptHostServers) rather than always being true', () => {
    const options = buildSdkOptions(
      baseRequest(),
      claudeCodeAdapterConfigSchema.parse({}),
      undefined,
      {
        allowedTools: [],
        serverConfig: {},
        strict: false,
      },
    );
    expect(options.strictMcpConfig).toBe(false);
  });

  it('mcpServers/strictMcpConfig are both omitted entirely when no mcp extras are given at all', () => {
    const options = buildSdkOptions(baseRequest(), claudeCodeAdapterConfigSchema.parse({}));
    expect(options.mcpServers).toBeUndefined();
    expect(options.strictMcpConfig).toBeUndefined();
  });
});

/** The third, required `CanUseTool` argument this suite never cares about the CONTENTS of, but must
 * supply something real for -- minimal, satisfying only the fields the real, installed `.d.ts`
 * actually requires (`signal`/`toolUseID`/`requestId`). */
function canUseToolOptions(): Parameters<
  NonNullable<ReturnType<typeof buildSdkOptions>['canUseTool']>
>[2] {
  return { signal: new AbortController().signal, toolUseID: 'tool-use-1', requestId: 'request-1' };
}

describe('buildSdkOptions: canUseTool (SessionRequest.vetExecCommand wiring) (specs/22 M17 P7) (critic round 5)', () => {
  it('is omitted entirely from Options when req.vetExecCommand is unset -- strictly additive, no change for every caller before this round', () => {
    const options = buildSdkOptions(baseRequest(), claudeCodeAdapterConfigSchema.parse({}));
    expect(options.canUseTool).toBeUndefined();
  });

  it('denies a Bash call with the real vetExecCommand reason when the gate refuses', async () => {
    const options = buildSdkOptions(
      baseRequest({
        vetExecCommand: () =>
          Promise.resolve({
            allowed: false,
            reason: 'refused: reaches outside the sandboxed root',
          }),
      }),
      claudeCodeAdapterConfigSchema.parse({}),
    );
    const result = await options.canUseTool?.(
      'Bash',
      { command: 'make -f /tmp/evil.mk pwn' },
      canUseToolOptions(),
    );
    expect(result).toEqual({
      behavior: 'deny',
      message: 'refused: reaches outside the sandboxed root',
    });
  });

  it('allows a Bash call when the gate allows it', async () => {
    const options = buildSdkOptions(
      baseRequest({ vetExecCommand: () => Promise.resolve({ allowed: true }) }),
      claudeCodeAdapterConfigSchema.parse({}),
    );
    const result = await options.canUseTool?.(
      'Bash',
      { command: 'node --test' },
      canUseToolOptions(),
    );
    expect(result).toEqual({ behavior: 'allow' });
  });

  it('allows a non-Bash tool call immediately, without ever calling vetExecCommand at all', async () => {
    let calls = 0;
    const options = buildSdkOptions(
      baseRequest({
        vetExecCommand: () => {
          calls += 1;
          return Promise.resolve({ allowed: false, reason: 'should never be reached' });
        },
      }),
      claudeCodeAdapterConfigSchema.parse({}),
    );
    const result = await options.canUseTool?.(
      'Read',
      { path: 'src/index.ts' },
      canUseToolOptions(),
    );
    expect(result).toEqual({ behavior: 'allow' });
    expect(calls).toBe(0);
  });

  it('denies (never allows) a Bash call whose own "command" is not a real string -- fail closed on an unexpected shape, matching isExecAllowed/vetProposedCommand\'s own convention everywhere else (specs/22 M17 P7, critic round 5: this branch used to fail OPEN)', async () => {
    let calls = 0;
    const options = buildSdkOptions(
      baseRequest({
        vetExecCommand: () => {
          calls += 1;
          return Promise.resolve({ allowed: true });
        },
      }),
      claudeCodeAdapterConfigSchema.parse({}),
    );
    const missingCommand = await options.canUseTool?.('Bash', {}, canUseToolOptions());
    const numericCommand = await options.canUseTool?.(
      'Bash',
      { command: 1234 },
      canUseToolOptions(),
    );
    expect(missingCommand).toMatchObject({ behavior: 'deny' });
    expect(numericCommand).toMatchObject({ behavior: 'deny' });
    // Never even reached the real gate for a shape it cannot vet at all.
    expect(calls).toBe(0);
  });

  it('never resolves to null for any input this suite exercises -- the real SDK\'s own doc comment warns a stray null blocks the tool "indefinitely"', async () => {
    const options = buildSdkOptions(
      baseRequest({ vetExecCommand: () => Promise.resolve({ allowed: false, reason: 'x' }) }),
      claudeCodeAdapterConfigSchema.parse({}),
    );
    const opts = canUseToolOptions();
    const results = await Promise.all([
      options.canUseTool?.('Bash', { command: 'node --test' }, opts),
      options.canUseTool?.('Bash', {}, opts),
      options.canUseTool?.('Read', { path: 'x' }, opts),
    ]);
    for (const result of results) expect(result).not.toBeNull();
  });
});

/** The second and third real `HookCallback` arguments this suite never cares about the CONTENTS of
 * (`toolUseID`, `{ signal }`), mirroring `canUseToolOptions()`'s own identical "supply something real,
 * assert nothing about it" convention above. */
function hookCallOptions(): { signal: AbortSignal } {
  return { signal: new AbortController().signal };
}

/** A real, minimal `PreToolUseHookInput` -- every `BaseHookInput` field the installed `.d.ts` actually
 * requires (`session_id`/`transcript_path`/`cwd`), plus the three `PreToolUse`-specific fields this
 * gate reads. */
function preToolUseInput(toolName: string, toolInput: unknown): Parameters<HookCallback>[0] {
  return {
    hook_event_name: 'PreToolUse',
    session_id: 'session-1',
    transcript_path: '/tmp/transcript.jsonl',
    cwd: '/tmp/lane',
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: 'tool-use-1',
  };
}

describe('buildSdkOptions: PreToolUse hook (SessionRequest.vetFileAccess wiring) (SPEC-QUESTIONS.md Q347)', () => {
  it('is omitted entirely from Options when req.vetFileAccess is unset -- strictly additive, no change for every caller before this piece', () => {
    const options = buildSdkOptions(baseRequest(), claudeCodeAdapterConfigSchema.parse({}));
    expect(options.hooks).toBeUndefined();
  });

  it('registers exactly one PreToolUse matcher, with no `matcher` pattern restricting it (every tool_use event is inspected; the callback itself narrows to Read/Edit/Write) -- when req.vetFileAccess IS set', () => {
    const options = buildSdkOptions(
      baseRequest({ vetFileAccess: () => Promise.resolve({ allowed: true }) }),
      claudeCodeAdapterConfigSchema.parse({}),
    );
    expect(options.hooks?.PreToolUse).toHaveLength(1);
    expect(options.hooks?.PreToolUse?.[0]?.hooks).toHaveLength(1);
    expect(options.hooks?.PreToolUse?.[0]?.matcher).toBeUndefined();
  });

  it.each(['Read', 'Edit', 'Write'] as const)(
    'denies a real out-of-lane %s call with the real vetFileAccess reason, via a genuine PreToolUseHookSpecificOutput deny decision',
    async (toolName) => {
      const options = buildSdkOptions(
        baseRequest({
          vetFileAccess: () =>
            Promise.resolve({
              allowed: false,
              reason: `refused: ${toolName} resolves outside the lane`,
            }),
        }),
        claudeCodeAdapterConfigSchema.parse({}),
      );
      const hook = options.hooks?.PreToolUse?.[0]?.hooks[0];
      const result = await hook?.(
        preToolUseInput(toolName, { file_path: '/tmp/forge-probe/test_forge_probe.py' }),
        'tool-use-1',
        hookCallOptions(),
      );
      expect(result).toMatchObject({
        continue: false,
        decision: 'block',
        reason: `refused: ${toolName} resolves outside the lane`,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `refused: ${toolName} resolves outside the lane`,
        },
      });
    },
  );

  it.each(['Read', 'Edit', 'Write'] as const)(
    'allows a real in-lane %s call when the gate allows it',
    async (toolName) => {
      const options = buildSdkOptions(
        baseRequest({ vetFileAccess: () => Promise.resolve({ allowed: true }) }),
        claudeCodeAdapterConfigSchema.parse({}),
      );
      const hook = options.hooks?.PreToolUse?.[0]?.hooks[0];
      const result = await hook?.(
        preToolUseInput(toolName, { file_path: '/tmp/lane/ok.txt' }),
        'tool-use-1',
        hookCallOptions(),
      );
      expect(result).toEqual({ continue: true });
    },
  );

  it('allows a non-Read/Edit/Write tool call (Bash included) immediately, without ever calling vetFileAccess at all', async () => {
    let calls = 0;
    const options = buildSdkOptions(
      baseRequest({
        vetFileAccess: () => {
          calls += 1;
          return Promise.resolve({ allowed: false, reason: 'should never be reached' });
        },
      }),
      claudeCodeAdapterConfigSchema.parse({}),
    );
    const hook = options.hooks?.PreToolUse?.[0]?.hooks[0];
    for (const toolName of ['Bash', 'Glob', 'Grep', 'WebFetch', 'Task']) {
      const result = await hook?.(
        preToolUseInput(toolName, { anything: 'x' }),
        'tool-use-1',
        hookCallOptions(),
      );
      expect(result).toEqual({ continue: true });
    }
    expect(calls).toBe(0);
  });

  it('passes through a non-PreToolUse hook event untouched (this callback is only ever registered under the PreToolUse key, but fails safe if it were ever invoked for a different event)', async () => {
    const options = buildSdkOptions(
      baseRequest({ vetFileAccess: () => Promise.resolve({ allowed: false, reason: 'x' }) }),
      claudeCodeAdapterConfigSchema.parse({}),
    );
    const hook = options.hooks?.PreToolUse?.[0]?.hooks[0];
    const result = await hook?.(
      {
        hook_event_name: 'SessionStart',
        session_id: 's',
        transcript_path: '/t',
        cwd: '/tmp',
      } as Parameters<HookCallback>[0],
      undefined,
      hookCallOptions(),
    );
    expect(result).toEqual({ continue: true });
  });

  it('denies (never allows) a Write/Edit/Read call whose own "tool_input" carries no real "file_path" string -- fail closed on an unexpected shape, matching buildCanUseTool\'s own identical convention for a non-string Bash "command"', async () => {
    let calls = 0;
    const options = buildSdkOptions(
      baseRequest({
        vetFileAccess: () => {
          calls += 1;
          return Promise.resolve({ allowed: true });
        },
      }),
      claudeCodeAdapterConfigSchema.parse({}),
    );
    const hook = options.hooks?.PreToolUse?.[0]?.hooks[0];
    const missingPath = await hook?.(preToolUseInput('Write', {}), 'tool-use-1', hookCallOptions());
    const numericPath = await hook?.(
      preToolUseInput('Edit', { file_path: 1234 }),
      'tool-use-1',
      hookCallOptions(),
    );
    expect(missingPath).toMatchObject({ continue: false, decision: 'block' });
    expect(numericPath).toMatchObject({ continue: false, decision: 'block' });
    // Never even reached the real gate for a shape it cannot vet at all.
    expect(calls).toBe(0);
  });
});
