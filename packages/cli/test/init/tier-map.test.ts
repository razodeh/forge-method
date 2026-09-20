/**
 * `deriveTierMap` / `backfillTierMap` / `withTierMap` — `PLAN-M13.md` P5b (`SPEC-QUESTIONS.md` Q204):
 * `forge init` records `models.tiers.<tier>.<adapter id>` from the selected adapter, and never a model id
 * the adapter did not itself list.
 *
 * Adapters here are minimal stand-ins built on the real `FakePlatformAdapter` so nothing in `packages/cli`
 * has to name a platform model; what matters is the *contract* (`PlatformAdapter.defaultTierModels`
 * vs `listModels()`), not any one platform's table.
 *
 * @see specs/05 §5.8
 * @see specs/07 §7.2
 */
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import * as YAML from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

import type { TierModelMap } from '@forge/adapter-kit/types';
import { MODEL_TIER_NAMES } from '@forge/adapter-kit/types';
import { agentDefinitionSchema } from '@forge/agents/schema';
import { ProjectPaths } from '@forge/core/fs';
import { DEFAULT_CONFIG } from '@forge/schemas/config';

import {
  backfillTierMap,
  deriveTierMap,
  formatUnmappedTierWarnings,
  withTierMap,
} from '../../src/init/tier-map.ts';
import { stubAdapter } from './tier-stubs.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function projectWithConfig(yamlText: string): Promise<{ paths: ProjectPaths; file: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-cli-tiermap-'));
  dirs.push(dir);
  await mkdir(path.join(dir, '.forge'), { recursive: true });
  const file = path.join(dir, '.forge/config.yaml');
  await writeFile(file, yamlText);
  return { paths: new ProjectPaths(dir), file };
}

describe('the tier vocabulary', () => {
  it('is the same three tiers the agent schema accepts (an agent on a fourth tier would bypass init)', () => {
    const agentTiers = agentDefinitionSchema.shape.model.shape.tier.options;
    expect([...agentTiers].sort()).toEqual([...MODEL_TIER_NAMES].sort());
  });

  it('MODEL_TIER_NAMES is exactly the tier table DEFAULT_CONFIG ships (drift here breaks init silently)', () => {
    expect([...MODEL_TIER_NAMES].sort()).toEqual(Object.keys(DEFAULT_CONFIG.models.tiers).sort());
  });
});

describe('deriveTierMap', () => {
  it('offers exactly what the adapter declares when it also lists every one of those models', async () => {
    const result = await deriveTierMap(stubAdapter({}));
    expect(result.offered).toEqual({ frugal: 'm-small', balanced: 'm-mid', max: 'm-big' });
    expect(result.unmapped).toEqual([]);
    expect(result.note).toBeUndefined();
  });

  it('writes nothing, and says why, for an adapter that declares no defaults (the generic adapter)', async () => {
    const result = await deriveTierMap(stubAdapter({ id: 'gen', defaults: 'omit' }));
    expect(result.offered).toEqual({});
    expect(result.unmapped).toEqual([...MODEL_TIER_NAMES]);
    expect(result.note).toContain('"gen"');
  });

  it('writes nothing when listModels() is empty, even though the adapter declares defaults', async () => {
    const result = await deriveTierMap(stubAdapter({ models: [] }));
    expect(result.offered).toEqual({});
    expect(result.unmapped).toEqual([...MODEL_TIER_NAMES]);
    expect(result.note).toContain('no models');
  });

  it('writes nothing when listModels() rejects, without throwing out of init', async () => {
    const result = await deriveTierMap(stubAdapter({ models: new Error('network down') }));
    expect(result.offered).toEqual({});
    expect(result.unmapped).toEqual([...MODEL_TIER_NAMES]);
    expect(result.note).toContain('network down');
  });

  it('writes nothing when defaultTierModels() throws', async () => {
    const result = await deriveTierMap(
      stubAdapter({
        defaults: () => {
          throw new Error('boom');
        },
      }),
    );
    expect(result.offered).toEqual({});
    expect(result.unmapped).toEqual([...MODEL_TIER_NAMES]);
    expect(result.note).toContain('boom');
  });

  it('never writes a declared id the adapter does not list: only that tier stays unmapped', async () => {
    const result = await deriveTierMap(
      stubAdapter({ defaults: { frugal: 'm-small', balanced: 'guessed-model', max: 'm-big' } }),
    );
    expect(result.offered).toEqual({ frugal: 'm-small', max: 'm-big' });
    expect(result.unmapped).toEqual(['balanced']);
    expect(result.note).toContain('balanced');
  });

  it('leaves a tier unmapped when the adapter simply omits it', async () => {
    const result = await deriveTierMap(stubAdapter({ defaults: { balanced: 'm-mid' } }));
    expect(result.offered).toEqual({ balanced: 'm-mid' });
    expect(result.unmapped).toEqual(['frugal', 'max']);
  });

  it('rejects blank, padded and non-string ids even if the adapter lists them', async () => {
    const weird = { frugal: '', balanced: ' m-mid ', max: 7 } as unknown as TierModelMap;
    const result = await deriveTierMap(
      stubAdapter({ models: ['', ' m-mid ', '7', 'm-big'], defaults: weird }),
    );
    expect(result.offered).toEqual({});
    expect(result.unmapped).toEqual([...MODEL_TIER_NAMES]);
  });

  it('does not treat inherited properties of the declared map as declared tiers', async () => {
    const inherited = Object.create({ frugal: 'm-small' }) as TierModelMap;
    const result = await deriveTierMap(stubAdapter({ defaults: inherited }));
    expect(result.offered).toEqual({});
  });

  it('survives an adapter whose defaultTierModels() returns a non-object', async () => {
    const result = await deriveTierMap(
      stubAdapter({ defaults: (() => 'x') as unknown as () => never }),
    );
    expect(result.offered).toEqual({});
    expect(result.unmapped).toEqual([...MODEL_TIER_NAMES]);
  });
});

describe('withTierMap', () => {
  it('adds the adapter under each offered tier and leaves every other entry alone', () => {
    const tiers = { frugal: { other: 'x' }, balanced: {}, max: {} };
    const next = withTierMap(tiers, 'stub', { frugal: 'm-small', max: 'm-big' });
    expect(next).toEqual({
      frugal: { other: 'x', stub: 'm-small' },
      balanced: {},
      max: { stub: 'm-big' },
    });
    expect(tiers.frugal).toEqual({ other: 'x' }); // input not mutated
  });

  it('does not mutate DEFAULT_CONFIG', () => {
    withTierMap(DEFAULT_CONFIG.models.tiers, 'stub', { frugal: 'm-small' });
    expect(DEFAULT_CONFIG.models.tiers).toEqual({ frugal: {}, balanced: {}, max: {} });
  });
});

describe('backfillTierMap (re-init)', () => {
  const BASE = (extra: string): string =>
    `# my project\nplatform:\n  primary: stub\n  fallback: null\n${extra}`;

  async function tiersOf(file: string): Promise<Record<string, unknown>> {
    return (
      YAML.parse(await readFile(file, 'utf8')) as { models: { tiers: Record<string, unknown> } }
    ).models.tiers;
  }

  it('adds missing entries for the recorded adapter, keeping comments', async () => {
    const { paths, file } = await projectWithConfig(
      BASE('models:\n  tiers:\n    frugal: {}\n    balanced: {}\n    max: {}\n'),
    );
    const { reports, notes } = await backfillTierMap(paths, [stubAdapter({})]);
    expect(await readFile(file, 'utf8')).toContain('# my project');
    expect(await tiersOf(file)).toEqual({
      frugal: { stub: 'm-small' },
      balanced: { stub: 'm-mid' },
      max: { stub: 'm-big' },
    });
    expect(notes).toEqual([]);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.unmapped).toEqual([]);
  });

  it('NEVER overwrites a real value the user set, and keeps other adapters’ entries', async () => {
    const { paths, file } = await projectWithConfig(
      BASE(
        'models:\n  tiers:\n    frugal: { stub: my-own-model }\n    balanced: { stub: 42 }\n    max: { other: keep-me }\n',
      ),
    );
    const { reports } = await backfillTierMap(paths, [stubAdapter({})]);
    expect(await tiersOf(file)).toEqual({
      frugal: { stub: 'my-own-model' }, // hand-edited: untouched
      balanced: { stub: 42 }, // a value of an unexpected type is still the user's, not ours to replace
      max: { other: 'keep-me', stub: 'm-big' }, // a different adapter's entry survives; ours is added
    });
    expect(reports[0]?.mapped).toEqual({ frugal: 'my-own-model', max: 'm-big' });
    expect(reports[0]?.unmapped).toEqual(['balanced']);
    expect(reports[0]?.note).toContain('not a usable model id');
  });

  it('a value the adapter does not list is still the user’s: never replaced', async () => {
    const { paths, file } = await projectWithConfig(
      BASE('models:\n  tiers:\n    max: { stub: some-future-model }\n'),
    );
    await backfillTierMap(paths, [stubAdapter({})]);
    expect(((await tiersOf(file))['max'] as Record<string, string>)['stub']).toBe(
      'some-future-model',
    );
  });

  it.each([
    ['blank', '""'],
    ['whitespace-only', '"   "'],
    ['null', 'null'],
  ])(
    'fills an entry that is %s: resolveStepModel treats it as unmapped, so nothing chosen is lost',
    async (_label, literal) => {
      const { paths, file } = await projectWithConfig(
        BASE(`models:\n  tiers:\n    balanced: { stub: ${literal} }\n`),
      );
      const { reports } = await backfillTierMap(paths, [stubAdapter({})]);
      expect(((await tiersOf(file))['balanced'] as Record<string, string>)['stub']).toBe('m-mid');
      expect(reports[0]?.unmapped).toEqual([]);
    },
  );

  it('does not rewrite the file at all when nothing is missing (proved on a non-canonical layout)', async () => {
    // Flow style, odd spacing and a trailing comment: an implementation that always re-serialised would
    // normalise all of it, so byte equality here proves no write happened.
    const original =
      'platform:   {primary: stub,   fallback: null}   # keep\n' +
      'models:\n  tiers:\n    frugal: {stub: a}\n    balanced:   {stub: b}\n    max: { stub: c }\n';
    const { paths, file } = await projectWithConfig(original);
    const { reports } = await backfillTierMap(paths, [stubAdapter({})]);
    expect(await readFile(file, 'utf8')).toBe(original);
    expect(reports[0]?.unmapped).toEqual([]);
  });

  it('does not even ask the adapter for its models when nothing is missing', async () => {
    const { paths } = await projectWithConfig(
      BASE(
        'models:\n  tiers:\n    frugal: {stub: a}\n    balanced: {stub: b}\n    max: {stub: c}\n',
      ),
    );
    let asked = 0;
    const adapter = stubAdapter({});
    const counting = Object.assign(Object.create(adapter) as typeof adapter, {
      listModels: () => {
        asked += 1;
        return adapter.listModels();
      },
    });
    await backfillTierMap(paths, [counting]);
    expect(asked).toBe(0);
  });

  it('is idempotent', async () => {
    const { paths, file } = await projectWithConfig(BASE(''));
    await backfillTierMap(paths, [stubAdapter({})]);
    const once = await readFile(file, 'utf8');
    await backfillTierMap(paths, [stubAdapter({})]);
    expect(await readFile(file, 'utf8')).toBe(once);
  });

  it('fills a tier written as a bare null, and creates a missing models block', async () => {
    const { paths, file } = await projectWithConfig(BASE('models:\n  tiers:\n    frugal:\n'));
    await backfillTierMap(paths, [stubAdapter({})]);
    expect(await tiersOf(file)).toEqual({
      frugal: { stub: 'm-small' },
      balanced: { stub: 'm-mid' },
      max: { stub: 'm-big' },
    });
  });

  it('leaves data of the wrong shape alone, and says so, rather than reshaping it', async () => {
    const original = BASE('models:\n  tiers:\n    frugal: just-a-string\n');
    const { paths, file } = await projectWithConfig(original);
    const { reports } = await backfillTierMap(paths, [stubAdapter({})]);
    expect((await tiersOf(file))['frugal']).toBe('just-a-string');
    expect(reports[0]?.unmapped).toEqual(['frugal']);
    expect(reports[0]?.note).toContain('left alone');
  });

  it('does not write through a shared (anchored/aliased) map: that would re-point another tier', async () => {
    const { paths, file } = await projectWithConfig(
      BASE('models:\n  tiers:\n    frugal: &shared {}\n    balanced: *shared\n    max: {}\n'),
    );
    const { reports } = await backfillTierMap(paths, [stubAdapter({})]);
    const tiers = await tiersOf(file);
    // `balanced` still aliases `frugal`'s (empty) map: no tier silently inherited another tier's model.
    expect(tiers['frugal']).toEqual({});
    expect(tiers['balanced']).toEqual({});
    expect(tiers['max']).toEqual({ stub: 'm-big' });
    expect(reports[0]?.unmapped).toEqual(['frugal', 'balanced']);
    expect(reports[0]?.note).toContain('alias or anchor');
  });

  it('counts a tier that resolves through an alias to a real value as mapped (no false warning)', async () => {
    const { paths } = await projectWithConfig(
      BASE(
        'models:\n  tiers:\n    frugal: &s { stub: shared-model }\n    balanced: *s\n    max: { stub: c }\n',
      ),
    );
    const { reports } = await backfillTierMap(paths, [stubAdapter({})]);
    expect(reports[0]?.unmapped).toEqual([]);
    expect(reports[0]?.mapped.balanced).toBe('shared-model');
  });

  it.each(['__proto__', 'constructor', 'toString'])(
    'handles an adapter id named %s as plain data',
    async (id) => {
      const { paths, file } = await projectWithConfig(
        `platform:\n  primary: ${id}\n  fallback: null\n`,
      );
      const { reports } = await backfillTierMap(paths, [stubAdapter({ id })]);
      expect(reports[0]?.unmapped).toEqual([]);
      const text = await readFile(file, 'utf8');
      expect(text).toContain('m-mid');
      expect(Object.prototype).not.toHaveProperty('balanced');
    },
  );

  it('writes nothing for an adapter that lists no models, and reports the tiers unmapped with why', async () => {
    const original = BASE('');
    const { paths, file } = await projectWithConfig(original);
    const { reports } = await backfillTierMap(paths, [stubAdapter({ models: [] })]);
    expect(await readFile(file, 'utf8')).toBe(original);
    expect(reports[0]?.unmapped).toEqual([...MODEL_TIER_NAMES]);
    expect(reports[0]?.note).toContain('no models');
  });

  it('also fills the recorded fallback adapter', async () => {
    const { paths, file } = await projectWithConfig(
      'platform:\n  primary: stub\n  fallback: stub2\n',
    );
    await backfillTierMap(paths, [stubAdapter({}), stubAdapter({ id: 'stub2' })]);
    expect((await tiersOf(file))['balanced']).toEqual({ stub: 'm-mid', stub2: 'm-mid' });
  });

  it('does not lose an edit made while the adapter is being consulted (re-reads before writing)', async () => {
    const { paths, file } = await projectWithConfig(BASE(''));
    const base = stubAdapter({});
    const editing = Object.assign(Object.create(base) as typeof base, {
      listModels: async () => {
        // A person edits the file while `listModels()` is in flight.
        await writeFile(
          file,
          `# added meanwhile\n${BASE('models:\n  tiers:\n    max: { stub: USER-EDIT }\n')}`,
        );
        return base.listModels();
      },
    });
    await backfillTierMap(paths, [editing]);
    const text = await readFile(file, 'utf8');
    expect(text).toContain('# added meanwhile');
    const tiers = await tiersOf(file);
    expect((tiers['max'] as Record<string, string>)['stub']).toBe('USER-EDIT');
    expect((tiers['frugal'] as Record<string, string>)['stub']).toBe('m-small'); // still filled
  });

  it('leaves an LF file LF when it writes (no CR introduced)', async () => {
    const { paths, file } = await projectWithConfig(BASE(''));
    await backfillTierMap(paths, [stubAdapter({})]);
    expect(await readFile(file, 'utf8')).not.toContain('\r');
  });

  it('keeps CRLF line endings when it has to write', async () => {
    const original = BASE('').replace(/\n/g, '\r\n');
    const { paths, file } = await projectWithConfig(original);
    await backfillTierMap(paths, [stubAdapter({})]);
    const text = await readFile(file, 'utf8');
    expect(text).toContain('m-mid');
    expect(text.replace(/\r\n/g, '')).not.toContain('\n'); // every line break is CRLF
  });

  it('refuses to fill a blank scalar that another tier aliases (it would leak that tier’s model)', async () => {
    const { paths, file } = await projectWithConfig(
      BASE(
        'models:\n  tiers:\n    frugal: { stub: &a "" }\n    balanced: { stub: *a }\n    max: {}\n',
      ),
    );
    const { reports } = await backfillTierMap(paths, [stubAdapter({})]);
    const tiers = await tiersOf(file);
    expect((tiers['balanced'] as Record<string, string>)['stub']).toBe('');
    expect(reports[0]?.unmapped).toEqual(['frugal', 'balanced']);
  });

  it('does not warn about a padded model id: a run accepts any non-blank string', async () => {
    const { paths } = await projectWithConfig(
      BASE(
        'models:\n  tiers:\n    frugal: { stub: " x " }\n    balanced: { stub: b }\n    max: { stub: c }\n',
      ),
    );
    const { reports } = await backfillTierMap(paths, [stubAdapter({})]);
    expect(reports[0]?.unmapped).toEqual([]);
  });

  it('reports, rather than throws, when the YAML library refuses an alias bomb', async () => {
    const refs = Array(400).fill('*x').join(', ');
    const original = BASE(`x: &x [1,2,3,4,5,6,7,8,9,10]\ny: [${refs}]\n`);
    const { paths, file } = await projectWithConfig(original);
    const { reports, notes } = await backfillTierMap(paths, [stubAdapter({})]);
    expect(reports).toEqual([]);
    expect(notes[0]).toContain('could not be evaluated');
    expect(await readFile(file, 'utf8')).toBe(original);
  });

  it('reports, rather than throws, when the config cannot be written', async () => {
    const { paths, file } = await projectWithConfig(BASE(''));
    const forgeDir = path.dirname(file);
    await chmod(forgeDir, 0o500); // no new entries: the atomic temp file cannot be created
    try {
      const { notes } = await backfillTierMap(paths, [stubAdapter({})]);
      expect(notes[0]).toContain('could not be written');
    } finally {
      await chmod(forgeDir, 0o700);
    }
  });

  describe('never fails silently', () => {
    it('a recorded adapter it was not given is reported, config untouched', async () => {
      const original = BASE('');
      const { paths, file } = await projectWithConfig(original);
      const { reports, notes } = await backfillTierMap(paths, [
        stubAdapter({ id: 'someone-else' }),
      ]);
      expect(reports).toEqual([]);
      expect(notes).toHaveLength(1);
      expect(notes[0]).toContain('"stub"');
      expect(await readFile(file, 'utf8')).toBe(original);
    });

    it('a malformed config is reported and left alone (not thrown)', async () => {
      const original = 'platform: [unterminated\n  primary: stub\n';
      const { paths, file } = await projectWithConfig(original);
      const { reports, notes } = await backfillTierMap(paths, [stubAdapter({})]);
      expect(reports).toEqual([]);
      expect(notes[0]).toContain('not valid YAML');
      expect(await readFile(file, 'utf8')).toBe(original);
    });

    it('a duplicate-key config (YAML error) is reported, not partially edited', async () => {
      const original = 'platform:\n  primary: stub\nplatform:\n  primary: stub\n';
      const { paths, file } = await projectWithConfig(original);
      const { notes } = await backfillTierMap(paths, [stubAdapter({})]);
      expect(notes[0]).toContain('not valid YAML');
      expect(await readFile(file, 'utf8')).toBe(original);
    });

    it('an unreadable config (a directory where the file should be) is reported', async () => {
      const dir = await mkdtemp(path.join(tmpdir(), 'forge-cli-tiermap-'));
      dirs.push(dir);
      await mkdir(path.join(dir, '.forge/config.yaml'), { recursive: true });
      const { reports, notes } = await backfillTierMap(new ProjectPaths(dir), [stubAdapter({})]);
      expect(reports).toEqual([]);
      expect(notes[0]).toContain('could not be read');
    });

    it('a config recording no platform is reported', async () => {
      const { paths } = await projectWithConfig('project:\n  name: x\n');
      const { notes } = await backfillTierMap(paths, [stubAdapter({})]);
      expect(notes[0]).toContain('no platform.primary');
    });
  });

  it('does nothing, quietly, for a project with no config.yaml at all', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-cli-tiermap-'));
    dirs.push(dir);
    expect(await backfillTierMap(new ProjectPaths(dir), [stubAdapter({})])).toEqual({
      reports: [],
      notes: [],
    });
  });
});

describe('formatUnmappedTierWarnings', () => {
  it('says nothing when every tier is mapped', () => {
    expect(
      formatUnmappedTierWarnings([{ adapterId: 'a', mapped: { max: 'x' }, unmapped: [] }]),
    ).toEqual([]);
  });

  it('names the tiers, the adapter, the reason and the remedy', () => {
    const [line, ...rest] = formatUnmappedTierWarnings([
      { adapterId: 'gen', mapped: {}, unmapped: ['frugal', 'max'], note: 'no defaults' },
    ]);
    expect(rest).toEqual([]);
    expect(line).toContain('frugal, max');
    expect(line).toContain('"gen"');
    expect(line).toContain('no defaults');
    expect(line).toContain('RUN-078');
    expect(line).toContain('models.tiers.<tier>.gen');
  });

  it('also strips bidi and line-separator characters that could disguise a line', () => {
    const [line] = formatUnmappedTierWarnings([
      { adapterId: 'a\u202Eb', mapped: {}, unmapped: ['max'], note: 'x\u2028y' },
    ]);
    expect(line).not.toMatch(/[\u202E\u2028]/);
  });

  it('strips escape sequences and cannot be made to print a forged second line', () => {
    const [line, ...rest] = formatUnmappedTierWarnings([
      {
        adapterId: 'x\u001b[31m',
        mapped: {},
        unmapped: ['max'],
        note: 'boom\nforge init: wrote 999 files\r\u001b]0;pwned\u0007',
      },
    ]);
    expect(rest).toEqual([]);
    const codes = Array.from(line ?? '', (ch) => ch.charCodeAt(0));
    expect(codes.every((code) => code >= 0x20 && code !== 0x7f)).toBe(true);
    expect(line).not.toContain('\n');
    expect(line).not.toContain('\u001b');
  });
});
