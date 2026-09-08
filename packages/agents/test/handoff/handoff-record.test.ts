/**
 * `handoffRecordSchema` (re-exported from `@forge/schemas/artifacts`) — `05` §5.6's full `HO-0042`
 * worked example round-trips exactly.
 *
 * @see specs/05 §5.6
 * @see PLAN-M6.md A7
 */
import { describe, expect, it } from 'vitest';

import { handoffRecordSchema } from '../../src/handoff/index.ts';

describe('handoffRecordSchema', () => {
  it("round-trips 05 §5.6's own full HO-0042 worked example exactly", () => {
    const worked = {
      id: 'HO-0042',
      from: 'architect',
      to: 'platform',
      step: 'design-system → initialize-repo',
      timestamp: '2026-03-04T12:41:02Z',
      delivered: [
        'ADR-011 monorepo strategy',
        'ADR-012 build system',
        'docs/forge/kb/architecture/architecture-spec.md',
      ],
      open_questions: [
        'Do we need a separate package for the shared domain types, or is a folder enough at MVP scale?',
      ],
      assumptions: [
        {
          id: 'ASM-004',
          text: 'Single deployable at MVP; second service arrives at M2',
          confidence: 'high',
          validate_by: 'stage plan review at M2 kickoff',
        },
      ],
      constraints_for_receiver: ['Do not introduce a new language runtime without an ADR'],
      acceptance_for_receiver: ['pnpm install && pnpm build && pnpm test succeed from clean clone'],
    };

    const result = handoffRecordSchema.parse(worked);

    expect(result).toEqual(worked);
  });
});
