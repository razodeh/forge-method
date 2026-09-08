/**
 * `emitHandoff` — `05` §5.6's `FORGE_HANDOFF:` → real `HandoffRecord` → event log.
 *
 * @see specs/05 §5.6
 * @see PLAN-M6.md A7
 */
import { ForgeError } from '@forge/core';
import { parseControlTokens } from '@forge/adapter-kit/control-tokens';
import { describe, expect, it } from 'vitest';

import { emitHandoff } from '../../src/handoff/emit-handoff.ts';
import type { EmitHandoffContext } from '../../src/handoff/types.ts';

function fakeTelemetry(): { emitted: unknown[]; emitter: EmitHandoffContext['telemetry'] } {
  const emitted: unknown[] = [];
  return {
    emitted,
    emitter: {
      emit: (event) => {
        emitted.push(event);
        return Promise.resolve(event);
      },
    },
  };
}

const BASE_CTX: Omit<EmitHandoffContext, 'telemetry'> = {
  id: 'HO-0042',
  from: 'architect',
  step: 'design-system → initialize-repo',
  timestamp: '2026-03-04T12:41:02Z',
  delivered: ['ADR-011 monorepo strategy', 'docs/forge/kb/architecture/architecture-spec.md'],
  openQuestions: ['Do we need a second package for domain types?'],
  assumptions: [
    {
      id: 'ASM-004',
      text: 'Single deployable at MVP',
      confidence: 'high',
      validate_by: 'stage plan review at M2 kickoff',
    },
  ],
  constraintsForReceiver: ['Do not introduce a new language runtime without an ADR'],
  acceptanceForReceiver: ['pnpm install && pnpm build && pnpm test succeed from clean clone'],
  runId: 'run-1',
  stepId: 'design-system',
};

describe('emitHandoff', () => {
  it('against a real FORGE_HANDOFF: token (parsed by the real @forge/adapter-kit parser) produces a real, schema-valid record with real, non-empty delivered/constraints_for_receiver', async () => {
    const { tokens } = parseControlTokens(
      'FORGE_HANDOFF: platform the repo scaffold is ready for initialization',
    );
    const handoffToken = tokens[0];
    if (handoffToken === undefined) throw new Error('expected parseControlTokens to recognize the line');
    expect(handoffToken.token).toBe('FORGE_HANDOFF');

    const { emitted, emitter } = fakeTelemetry();
    const record = await emitHandoff(handoffToken, { ...BASE_CTX, telemetry: emitter });

    expect(record.id).toBe('HO-0042');
    expect(record.from).toBe('architect');
    expect(record.to).toBe('platform');
    expect(record.delivered).toEqual(BASE_CTX.delivered);
    expect(record.delivered.length).toBeGreaterThan(0);
    expect(record.constraints_for_receiver).toEqual(BASE_CTX.constraintsForReceiver);
    expect(record.constraints_for_receiver.length).toBeGreaterThan(0);
    // The token's own real reason text is not silently discarded -- it lands as the first open question.
    expect(record.open_questions[0]).toBe('the repo scaffold is ready for initialization');

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ type: 'ArtifactCreated', runId: 'run-1', payload: record });
  });

  it('throws RUN-047 when given a non-FORGE_HANDOFF token', async () => {
    const { tokens } = parseControlTokens('FORGE_ASK: question="pick one" options=[a,b]');
    const askToken = tokens[0];
    if (askToken === undefined) throw new Error('expected parseControlTokens to recognize the line');
    expect(askToken.token).toBe('FORGE_ASK');

    const { emitter } = fakeTelemetry();
    await expect(emitHandoff(askToken, { ...BASE_CTX, telemetry: emitter })).rejects.toThrow(
      ForgeError,
    );
  });
});
