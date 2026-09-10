/**
 * `writePromptRecord` — `05` §5.3's own mandatory audit write to
 * `.forge/state/runs/<runId>/steps/<stepId>/prompt.md`.
 *
 * @see specs/05 §5.3
 * @see PLAN-M6.md A5
 */
import { ProjectPaths, readTextFile } from '@forge/core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { compilePrompt } from '../../src/prompt/compile-prompt.ts';
import { writePromptRecord } from '../../src/prompt/write-prompt-record.ts';
import type { PromptConstraints } from '../../src/prompt/types.ts';
import type { StepContext } from '../../src/context/pack-for-step.ts';
import type { AgentContextPack } from '../../src/context/types.ts';
import type { AgentDefinition } from '../../src/schema/types.ts';

let scratchDirs: string[] = [];
afterEach(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
  scratchDirs = [];
});

function freshProjectRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'forge-agents-prompt-record-'));
  scratchDirs.push(dir);
  return dir;
}

const STEP: StepContext = { brief: 'brief', declaredInputIds: [], produces: [], consumes: [] };

function agent(): AgentDefinition {
  return {
    id: 'a',
    name: 'A',
    version: '1.0.0',
    tier: 'core',
    mandate: 'm',
    decisions_owned: [],
    persona: { voice: 'v', stance: 's', disagreement_style: 'd' },
    inputs: { required: [] },
    outputs: [{ type: 'X', schema: 'x.schema.json', path: 'x.md' }],
    kb_write: [],
    tools: { read: true, write: false, network: false, git_commit: 'none', deploy: false },
    model: { tier: 'balanced', thinking: 'medium' },
    limits: { max_turns: 1, wall_clock_ms: 1, max_cost_usd: 1 },
    parallel_safety: { file_ownership: [], exclusive: false },
    gates: { produces_evidence_for: [], may_approve: [] },
    skills: [],
    prompt: { system: 'p.md' },
  };
}

function pack(): AgentContextPack {
  return {
    pinnedCore: { glossary: 'g', constraints: 'c', adrIndex: 'a', codingStandards: 'cs' },
    declaredInputs: [],
    retrieved: [],
    manifest: { ids: [], tokenCounts: {} },
    skills: [],
  };
}

const CONSTRAINTS: PromptConstraints = {
  tools: {
    read: true,
    write: false,
    exec: undefined,
    network: false,
    git_commit: 'none',
    deploy: false,
  },
  forbiddenActions: [],
  budget: { max_turns: 1, wall_clock_ms: 1, max_cost_usd: 1 },
  autonomy: 'guided',
};

describe('writePromptRecord', () => {
  it('writes a real, readable prompt.md at the documented path for a real fixture run', async () => {
    const root = freshProjectRoot();
    const paths = new ProjectPaths(root);
    const prompt = compilePrompt(STEP, agent(), pack(), CONSTRAINTS, ['tests pass']);

    await writePromptRecord('run-1', 'step-1', prompt, paths);

    const written = await readTextFile(paths.resolveState('runs/run-1/steps/step-1/prompt.md'));
    expect(written).toContain(prompt.text);
    expect(written).toContain('FORGE operating contract');
    expect(written).toContain('tests pass');
  });
});
