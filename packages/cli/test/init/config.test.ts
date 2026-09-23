/**
 * `buildForgeConfig` — the real `ForgeConfig` `.forge/config.yaml` gets written with.
 *
 * @see specs/18 §18.3
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG, configSchema } from '@forge/schemas/config';

import { buildForgeConfig } from '../../src/init/config.ts';
import type { InitOptions } from '../../src/init/types.ts';

const BASE: InitOptions = { name: 'Acme Billing', yes: true };

describe('buildForgeConfig', () => {
  it('produces a config that validates against the real configSchema', () => {
    const config = buildForgeConfig({
      options: BASE,
      level: 'L2',
      platformId: 'fake-adapter',
      fallbackPlatformId: undefined,
    });
    expect(() => configSchema.parse(config)).not.toThrow();
  });

  it('derives a slug from name when --slug is not given', () => {
    const config = buildForgeConfig({
      options: BASE,
      level: 'L2',
      platformId: 'fake-adapter',
      fallbackPlatformId: undefined,
    });
    expect(config.project.slug).toBe('acme-billing');
  });

  it('uses an explicit --slug verbatim when given', () => {
    const config = buildForgeConfig({
      options: { ...BASE, slug: 'acme-b' },
      level: 'L2',
      platformId: 'fake-adapter',
      fallbackPlatformId: undefined,
    });
    expect(config.project.slug).toBe('acme-b');
  });

  it('sets platform.primary and platform.fallback from the resolved selection', () => {
    const config = buildForgeConfig({
      options: BASE,
      level: 'L2',
      platformId: 'fake-adapter',
      fallbackPlatformId: 'other-adapter',
    });
    expect(config.platform.primary).toBe('fake-adapter');
    expect(config.platform.fallback).toBe('other-adapter');
  });

  it('defaults platform.fallback to null when none was selected', () => {
    const config = buildForgeConfig({
      options: BASE,
      level: 'L2',
      platformId: 'fake-adapter',
      fallbackPlatformId: undefined,
    });
    expect(config.platform.fallback).toBeNull();
  });

  it('matches DEFAULT_CONFIG.paths exactly when --kb-root is not given', () => {
    const config = buildForgeConfig({
      options: BASE,
      level: 'L2',
      platformId: 'fake-adapter',
      fallbackPlatformId: undefined,
    });
    expect(config.paths).toEqual(DEFAULT_CONFIG.paths);
  });

  it('rebases every paths.* entry under --kb-root, not just paths.kb', () => {
    const config = buildForgeConfig({
      options: { ...BASE, kbRoot: 'custom/docs' },
      level: 'L2',
      platformId: 'fake-adapter',
      fallbackPlatformId: undefined,
    });
    expect(config.paths).toEqual({
      kb: 'custom/docs/kb',
      specs: 'custom/docs/specs',
      plans: 'custom/docs/plans',
      sessions: 'custom/docs/sessions',
      reports: 'custom/docs/reports',
      code: DEFAULT_CONFIG.paths.code,
      // `--kb-root` only rebases the docs sections above; `paths.release` (`PLAN-M14.md` P12) is
      // unrelated to the KB root, so it keeps its own (empty) `DEFAULT_CONFIG` default here too.
      release: DEFAULT_CONFIG.paths.release,
    });
  });

  it('leaves every field not covered by InitOptions at its DEFAULT_CONFIG value', () => {
    const config = buildForgeConfig({
      options: BASE,
      level: 'L2',
      platformId: 'fake-adapter',
      fallbackPlatformId: undefined,
    });
    expect(config.kb).toEqual(DEFAULT_CONFIG.kb);
    expect(config.security).toEqual(DEFAULT_CONFIG.security);
    expect(config.diagrams).toEqual(DEFAULT_CONFIG.diagrams);
  });

  it('applies every wizard override the worked flag example sets', () => {
    const options: InitOptions = {
      name: 'Acme Billing',
      level: 'L3',
      mode: 'guided',
      autonomy: 'guided',
      budget: 25,
      preset: 'startup-lean',
      kbRoot: 'docs/forge',
      allowCommits: true,
      yes: true,
    };
    const config = buildForgeConfig({
      options,
      level: 'L3',
      platformId: 'some-adapter',
      fallbackPlatformId: 'codemachine',
    });
    expect(config.project.mode).toBe('guided');
    expect(config.execution.autonomy).toBe('guided');
    expect(config.budget.perRunUsd).toBe(25);
    expect(config.roster.preset).toBe('startup-lean');
    // --kb-root rebases every paths.* entry under it (see buildForgeConfig's own doc comment for
    // why "docs/forge" alone would collide paths.kb with paths.specs/plans/sessions/reports).
    expect(config.paths.kb).toBe('docs/forge/kb');
    expect(config.paths.specs).toBe('docs/forge/specs');
    expect(config.vcs.allowCommits).toBe(true);
  });
});
