/**
 * `forge session <type|list|show|resume>` — every real subcommand is a named `USR-003` refusal, `16`'s
 * own facilitated-collaboration engine not being in M6's own Build line at all.
 *
 * @see specs/03 §3.2.6
 */
import { describe, expect, it } from 'vitest';

import {
  sessionList,
  sessionResume,
  sessionShow,
  startSession,
  type SessionType,
} from '../../../src/commands/loop/session.ts';

describe('startSession', () => {
  it.each([
    'brainstorm',
    'design-review',
    'retro',
    'premortem',
    'war-room',
    'estimation',
    'tradeoff',
    'standup',
  ] as const satisfies readonly SessionType[])('throws USR-003 for %s', (type) => {
    expect(() => startSession(type)).toThrow(expect.objectContaining({ code: 'USR-003' }));
  });
});

describe('sessionList / sessionShow / sessionResume', () => {
  it('all throw USR-003', () => {
    expect(() => sessionList()).toThrow(expect.objectContaining({ code: 'USR-003' }));
    expect(() => sessionShow()).toThrow(expect.objectContaining({ code: 'USR-003' }));
    expect(() => sessionResume()).toThrow(expect.objectContaining({ code: 'USR-003' }));
  });
});
