/**
 * `parseInitFlags` — `03` §3.3's own worked non-interactive flag line.
 *
 * @see specs/03 §3.3
 */
import { describe, expect, it } from 'vitest';

import { ForgeError } from '@forge/core/errors';

import { parseInitFlags } from '../../src/init/parse-init-flags.ts';

describe('parseInitFlags', () => {
  it("parses the spec's own literal worked flag line end to end", () => {
    const args = [
      '.',
      '--name',
      'Acme Billing',
      '--idea-file',
      './idea.md',
      '--level',
      'L3',
      '--mode',
      'guided',
      '--platform',
      'some-adapter',
      '--fallback-platform',
      'some-other-adapter',
      '--autonomy',
      'guided',
      '--budget',
      '25',
      '--modules',
      'fm-service,fm-web',
      '--preset',
      'startup-lean',
      '--overlay',
      'npm:@acme/forge-standards',
      '--kb-root',
      'docs/forge',
      '--git-init',
      '--allow-commits',
    ];
    const { dir, options } = parseInitFlags(args, true);
    expect(dir).toBe('.');
    expect(options).toEqual({
      name: 'Acme Billing',
      ideaFile: './idea.md',
      level: 'L3',
      mode: 'guided',
      platform: 'some-adapter',
      fallbackPlatform: 'some-other-adapter',
      autonomy: 'guided',
      budget: 25,
      modules: ['fm-service', 'fm-web'],
      preset: 'startup-lean',
      overlay: ['npm:@acme/forge-standards'],
      kbRoot: 'docs/forge',
      gitInit: true,
      allowCommits: true,
      yes: true,
    });
  });

  it('defaults dir to "." when no positional is given', () => {
    expect(parseInitFlags(['--name', 'X'], true).dir).toBe('.');
  });

  it('takes yes from its own second argument, not from the parsed flags', () => {
    expect(parseInitFlags(['--name', 'X'], false).options.yes).toBe(false);
  });

  it('requires --name', () => {
    expect(() => parseInitFlags([], true)).toThrow(ForgeError);
  });

  it('rejects an out-of-set --mode/--level/--autonomy value', () => {
    expect(() => parseInitFlags(['--name', 'X', '--mode', 'bogus'], true)).toThrow(ForgeError);
    expect(() => parseInitFlags(['--name', 'X', '--level', 'L9'], true)).toThrow(ForgeError);
    expect(() => parseInitFlags(['--name', 'X', '--autonomy', 'bogus'], true)).toThrow(ForgeError);
  });

  it('rejects a non-numeric --budget', () => {
    expect(() => parseInitFlags(['--name', 'X', '--budget', 'lots'], true)).toThrow(ForgeError);
  });

  it('rejects more than one positional (a second, unexpected [dir])', () => {
    expect(() => parseInitFlags(['a', 'b', '--name', 'X'], true)).toThrow(ForgeError);
  });

  it('rejects an unrecognised --flag', () => {
    expect(() => parseInitFlags(['--name', 'X', '--bogus'], true)).toThrow(ForgeError);
  });

  it('collects multiple --overlay flags in order', () => {
    const { options } = parseInitFlags(['--name', 'X', '--overlay', 'a', '--overlay', 'b'], true);
    expect(options.overlay).toEqual(['a', 'b']);
  });

  it('splits and trims a comma-separated --modules list, dropping empty entries', () => {
    const { options } = parseInitFlags(['--name', 'X', '--modules', ' fm-web, fm-data ,'], true);
    expect(options.modules).toEqual(['fm-web', 'fm-data']);
  });
});
