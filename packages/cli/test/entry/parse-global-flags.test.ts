/**
 * `parseGlobalFlags` — `03` §3.2's global-flags table, parsed once and shared by every command.
 *
 * @see specs/03 §3.2
 */
import { describe, expect, it } from 'vitest';

import { ForgeError } from '@forge/core/errors';

import { parseGlobalFlags } from '../../src/entry/parse-global-flags.ts';

describe('parseGlobalFlags', () => {
  it('defaults every flag per the table, with no positionals', () => {
    expect(parseGlobalFlags([])).toEqual({
      profile: 'default',
      dryRun: false,
      yes: false,
      json: false,
      noTui: false,
      verbosity: 0,
      quiet: false,
      positionals: [],
    });
  });

  it('parses every value flag by its long spelling, `--flag value`', () => {
    const flags = parseGlobalFlags([
      '--project',
      '/tmp/proj',
      '--config',
      '/tmp/proj/forge.yaml',
      '--profile',
      'ci',
      '--platform',
      'some-adapter',
      '--model-tier',
      'balanced',
      '--autonomy',
      'guided',
      '--concurrency',
      '4',
      '--budget',
      '12.5',
      '--seed',
      '42',
    ]);
    expect(flags).toMatchObject({
      project: '/tmp/proj',
      config: '/tmp/proj/forge.yaml',
      profile: 'ci',
      platform: 'some-adapter',
      modelTier: 'balanced',
      autonomy: 'guided',
      concurrency: 4,
      budget: 12.5,
      seed: 42,
    });
  });

  it('parses `--flag=value` form identically to `--flag value`', () => {
    const flags = parseGlobalFlags(['--profile=ci', '--concurrency=3']);
    expect(flags.profile).toBe('ci');
    expect(flags.concurrency).toBe(3);
  });

  it('parses -C as the short form of --project', () => {
    expect(parseGlobalFlags(['-C', '/tmp/proj']).project).toBe('/tmp/proj');
  });

  it('parses every boolean flag by its long and short spellings', () => {
    const flags = parseGlobalFlags([
      '--dry-run',
      '--yes',
      '--json',
      '--no-tui',
      '--quiet',
      '--no-color',
    ]);
    expect(flags).toMatchObject({
      dryRun: true,
      yes: true,
      json: true,
      noTui: true,
      quiet: true,
      noColor: true,
    });
    expect(parseGlobalFlags(['-y']).yes).toBe(true);
    expect(parseGlobalFlags(['-q']).quiet).toBe(true);
  });

  it('counts -v as verbosity, repeatable individually and combined', () => {
    expect(parseGlobalFlags(['-v']).verbosity).toBe(1);
    expect(parseGlobalFlags(['-v', '-v']).verbosity).toBe(2);
    expect(parseGlobalFlags(['-vv']).verbosity).toBe(2);
    expect(parseGlobalFlags(['-vvv']).verbosity).toBe(3);
    expect(parseGlobalFlags(['--verbose', '--verbose']).verbosity).toBe(2);
  });

  it('leaves an unrecognised subcommand and its own arguments as positionals, in order', () => {
    const flags = parseGlobalFlags(['run', '--json', 'workflow-name', '--yes']);
    expect(flags.json).toBe(true);
    expect(flags.yes).toBe(true);
    expect(flags.positionals).toEqual(['run', 'workflow-name']);
  });

  it('rejects an out-of-set --model-tier value with a remediable USR-002', () => {
    expect.assertions(2);
    try {
      parseGlobalFlags(['--model-tier', 'ludicrous']);
    } catch (error) {
      expect(error).toBeInstanceOf(ForgeError);
      expect((error as InstanceType<typeof ForgeError>).code).toBe('USR-002');
    }
  });

  it('rejects an out-of-set --autonomy value', () => {
    expect(() => parseGlobalFlags(['--autonomy', 'yolo'])).toThrow(ForgeError);
  });

  it('rejects a non-integer --concurrency and a non-numeric --budget', () => {
    expect(() => parseGlobalFlags(['--concurrency', 'many'])).toThrow(ForgeError);
    expect(() => parseGlobalFlags(['--budget', 'lots'])).toThrow(ForgeError);
  });

  it('rejects a value flag given with no following value', () => {
    expect(() => parseGlobalFlags(['--profile'])).toThrow(ForgeError);
  });

  it('rejects an empty --concurrency/--budget/--seed value rather than silently parsing 0', () => {
    expect(() => parseGlobalFlags(['--concurrency='])).toThrow(ForgeError);
    expect(() => parseGlobalFlags(['--budget='])).toThrow(ForgeError);
    expect(() => parseGlobalFlags(['--seed='])).toThrow(ForgeError);
  });

  it('rejects non-decimal numeric shapes (hex, exponential) for --concurrency', () => {
    expect(() => parseGlobalFlags(['--concurrency', '0x10'])).toThrow(ForgeError);
    expect(() => parseGlobalFlags(['--concurrency', '1e3'])).toThrow(ForgeError);
  });

  it('rejects a string-value flag whose following token is itself a recognised flag', () => {
    // A forgotten argument (`--project --verbose status`) must not silently consume `--verbose` as
    // --project's value; it must be a real USR-002, not a wrong-but-quiet parse.
    expect(() => parseGlobalFlags(['--project', '--verbose', 'status'])).toThrow(ForgeError);
    expect(() => parseGlobalFlags(['--config', '--json'])).toThrow(ForgeError);
  });

  it('still accepts a value that merely starts with a dash, like a negative --seed', () => {
    expect(parseGlobalFlags(['--seed', '-5']).seed).toBe(-5);
  });
});
