/**
 * `extractVerificationCommand` — `17` §17.4 point 6 / §17.6's own `forge kb verify` mechanism.
 *
 * @see specs/17 §17.4
 * @see specs/17 §17.6
 * @see PLAN-M10.md P20
 */
import { describe, expect, it } from 'vitest';

import { extractVerificationCommand } from '../../src/adopt/verify.ts';

describe('extractVerificationCommand', () => {
  it('extracts the command from the exact convention reconstruction.ts writes', () => {
    const body = [
      '## Statement',
      '',
      'The build succeeds.',
      '',
      '## Verification',
      '',
      'This check passed; see the Verification section for what was actually observed.',
      '',
      'Command: `npm run build`',
      '',
    ].join('\n');
    expect(extractVerificationCommand(body)).toBe('npm run build');
  });

  it('returns undefined for a human-only, prose Verification section with no Command line', () => {
    const body = ['## Verification', '', 'Confirmed directly against the real system.', ''].join(
      '\n',
    );
    expect(extractVerificationCommand(body)).toBeUndefined();
  });

  it('returns undefined when there is no Verification section at all', () => {
    expect(extractVerificationCommand('## Statement\n\nSomething true.\n')).toBeUndefined();
  });

  it('returns undefined for an empty body', () => {
    expect(extractVerificationCommand('')).toBeUndefined();
  });

  it('stops at the next heading — a Command line in a later section is not picked up', () => {
    const body = [
      '## Verification',
      '',
      'No command here.',
      '',
      '## Implications',
      '',
      'Command: `rm -rf /`',
      '',
    ].join('\n');
    expect(extractVerificationCommand(body)).toBeUndefined();
  });

  it('tolerates up to three leading spaces on the heading, matching kb-entry.ts', () => {
    const body = ['  ## Verification', '', 'Command: `pnpm test`', ''].join('\n');
    expect(extractVerificationCommand(body)).toBe('pnpm test');
  });

  it('the last Command line wins when more than one is present', () => {
    const body = [
      '## Verification',
      '',
      'Command: `npm run old-command`',
      '',
      'Command: `npm run new-command`',
      '',
    ].join('\n');
    expect(extractVerificationCommand(body)).toBe('npm run new-command');
  });

  it('ignores a Command line with an empty backtick body', () => {
    const body = ['## Verification', '', 'Command: ``', ''].join('\n');
    expect(extractVerificationCommand(body)).toBeUndefined();
  });
});
