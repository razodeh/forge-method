/**
 * `forge doctor --rule secrets-resolved` (`G-Deliver`) and `--rule skeleton-deployed` (`G-Foundation`), `PLAN-M13.md`
 * P25, Q219.
 *
 * `skeleton-deployed` passes only when a development Environment entry with a real (non-local) URL has a deployment
 * record showing a succeeded deployment of a commit in this repository with a 2xx health check on that host. Each
 * clause has a failing fixture; the environment register is written as a real KB collection file.
 *
 * @see specs/11 F-INIT-7
 * @see specs/14 §14.4, §14.7, §14.9
 * @see PLAN-M13.md P25
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ProjectPaths } from '@forge/core/fs';
import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import { doctorRule, type DoctorRuleId } from '../../../src/commands/doctor/rules.ts';
import { KB_ROOT, cleanupAll, createTestProject, writeAndCommit } from './helpers.ts';

afterEach(cleanupAll);

async function run(dir: string, rule: DoctorRuleId, env: Record<string, string> = {}) {
  return (
    await doctorRule(
      {
        paths: new ProjectPaths(dir),
        projectRoot: dir,
        kbRoot: KB_ROOT,
        reportsRoot: 'docs/forge/reports',
        env,
      },
      rule,
    )
  ).violations;
}

describe('secrets-resolved', () => {
  async function withRefs(files: Record<string, string>) {
    const { dir } = await createTestProject();
    for (const [relative, text] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(dir, relative)), { recursive: true });
      await writeFile(path.join(dir, relative), text);
    }
    return dir;
  }

  it('passes when the project references no secret at all', async () => {
    const { dir } = await createTestProject();
    expect(await run(dir, 'secrets-resolved')).toEqual([]);
  });

  it('passes when every referenced secret is set to a non-empty value', async () => {
    const dir = await withRefs({
      '.forge/mcp.yaml': 'token: ${secret:GITHUB_TOKEN}\n',
      'docs/forge/kb/delivery/notes.md': 'uses ${secret:DB_PASSWORD} and ${secret:GITHUB_TOKEN}\n',
    });
    expect(await run(dir, 'secrets-resolved', { GITHUB_TOKEN: 'x', DB_PASSWORD: 'y' })).toEqual([]);
  });

  it('fails each unresolved secret once, by name, sorted, with a remedy', async () => {
    const dir = await withRefs({
      '.forge/a.yaml': 'x: ${secret:ZED}\ny: ${secret:ALPHA}\nz: ${secret:ZED}\n',
    });
    const found = await run(dir, 'secrets-resolved', {});
    expect(found.map((v) => v.subject)).toEqual(['secret:ALPHA', 'secret:ZED']);
    expect(found[0]?.remedy).toMatch(/^Set ALPHA /);
  });

  it('a variable set to an empty or blank value does not resolve the secret', async () => {
    const dir = await withRefs({ '.forge/a.yaml': 'x: ${secret:EMPTY}\ny: ${secret:BLANK}\n' });
    const found = await run(dir, 'secrets-resolved', { EMPTY: '', BLANK: '   ' });
    expect(found.map((v) => v.subject)).toEqual(['secret:BLANK', 'secret:EMPTY']);
  });

  it('never puts a secret value in the output', async () => {
    const dir = await withRefs({
      '.forge/a.yaml': 'x: ${secret:HAS_VALUE}\ny: ${secret:MISSING}\n',
    });
    const found = await run(dir, 'secrets-resolved', { HAS_VALUE: 'super-secret-value-123' });
    expect(JSON.stringify(found)).not.toContain('super-secret-value-123');
  });

  it('does not scan .forge/state, where event logs are not configuration', async () => {
    const dir = await withRefs({ '.forge/state/events.md': '${secret:LOGGED_ONLY}\n' });
    expect(await run(dir, 'secrets-resolved')).toEqual([]);
  });

  it('is deterministic', async () => {
    const dir = await withRefs({ '.forge/a.yaml': '${secret:B} ${secret:A}\n' });
    expect(JSON.stringify(await run(dir, 'secrets-resolved'))).toBe(
      JSON.stringify(await run(dir, 'secrets-resolved')),
    );
  });
});

describe('skeleton-deployed', () => {
  interface EnvSpec {
    readonly id: string;
    readonly purpose: string;
    readonly url: string;
  }

  function register(envs: readonly EnvSpec[]): string {
    const entries = envs
      .map(
        (env) => `  - id: ${env.id}
    purpose: '${env.purpose}'
    url: '${env.url}'
    deploy_trigger: on merge to main
    data_policy: synthetic only
    secrets_source: the secret manager
    owner: platform
    access: ask the platform role`,
      )
      .join('\n');
    return `---
type: Environment
schemaVersion: 1
title: Environments
status: active
created: 2026-01-01
updated: 2026-01-01
revision: 1
author: platform
changelog: []
environments:
${entries}
---
`;
  }

  const DEV: EnvSpec = {
    id: 'ENV-002',
    purpose: 'Development environment the pipeline deploys the skeleton to',
    url: 'https://dev.example.com',
  };
  const LOCAL: EnvSpec = {
    id: 'ENV-001',
    purpose: 'Local development',
    url: 'http://localhost:3000',
  };

  async function sha(dir: string): Promise<string> {
    return (await execa('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim();
  }

  function evidence(overrides: Record<string, unknown>, headSha: string): string {
    return JSON.stringify({
      v: 1,
      environment: 'ENV-002',
      outcome: 'succeeded',
      sha: headSha,
      deployed_at: '2026-01-02T10:00:00Z',
      health: {
        url: 'https://dev.example.com/healthz',
        status: 200,
        checked_at: '2026-01-02T10:01:00Z',
      },
      ...overrides,
    });
  }

  async function project(
    envs: readonly EnvSpec[] | undefined,
    evidenceFor?: (headSha: string) => string,
    evidenceName = 'ENV-002.json',
  ): Promise<string> {
    const { dir } = await createTestProject();
    const files: Record<string, string> = {};
    if (envs !== undefined) files[`${KB_ROOT}/delivery/environments.md`] = register(envs);
    await writeAndCommit(dir, files);
    if (evidenceFor !== undefined) {
      await writeAndCommit(dir, {
        [`docs/forge/reports/deployments/${evidenceName}`]: evidenceFor(await sha(dir)),
      });
    }
    return dir;
  }

  it('passes: a development environment with a real URL and a healthy, succeeded deployment record', async () => {
    const dir = await project([LOCAL, DEV], (head) => evidence({}, head));
    expect(await run(dir, 'skeleton-deployed')).toEqual([]);
  });

  it('accepts an abbreviated commit id, https or http, and a different path on the same host', async () => {
    const dir = await project([DEV], (head) =>
      evidence(
        {
          sha: head.slice(0, 10),
          health: {
            url: 'HTTPS://DEV.example.com/a/b?x=1',
            status: 204,
            checked_at: '2026-01-02T10:01:00Z',
          },
        },
        head,
      ),
    );
    expect(await run(dir, 'skeleton-deployed')).toEqual([]);
  });

  it('fails a project with no environment register, naming the register and the Waiver route', async () => {
    const found = await run(await project(undefined), 'skeleton-deployed');
    expect(found).toHaveLength(1);
    expect(found[0]?.subject).toBe('environment');
    expect(found[0]?.message).toContain('No Environment entry is recorded');
    expect(found[0]?.remedy).toContain('Waiver');
  });

  it('fails when only the local development environment is recorded, even with a matching record', async () => {
    const dir = await project(
      [LOCAL],
      (head) => evidence({ environment: 'ENV-001' }, head),
      'ENV-001.json',
    );
    const found = await run(dir, 'skeleton-deployed');
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('Only local development environments');
    expect(found[0]?.message).toContain('ENV-001');
  });

  it('local addresses are not deployed environments: localhost, loopback, .local, a placeholder', async () => {
    for (const url of [
      'http://127.0.0.1:8080',
      'http://[::1]:3000',
      'http://0.0.0.0',
      'https://api.localhost',
      'http://box.local',
      '<how to reach it>',
      'ftp://dev.example.com',
    ]) {
      const dir = await project([{ ...DEV, url }], (head) => evidence({}, head));
      const found = await run(dir, 'skeleton-deployed');
      expect(found.length, url).toBe(1);
      expect(found[0]?.message, url).toContain('Only local development environments');
    }
  });

  it('a purpose that names another environment as well is not the development environment', async () => {
    const dir = await project(
      [{ id: 'ENV-002', purpose: 'Production (never dev)', url: 'https://prod.example.com' }],
      (head) =>
        evidence(
          {
            health: {
              url: 'https://prod.example.com/',
              status: 200,
              checked_at: '2026-01-02T10:01:00Z',
            },
          },
          head,
        ),
    );
    expect((await run(dir, 'skeleton-deployed'))[0]?.message).toContain(
      'No Environment entry is a development',
    );
  });

  it('local addresses in every spelling are refused, and look-alike names are not', async () => {
    for (const url of [
      'http://localhost.:3000',
      'http://foo.localhost.',
      'http://[::ffff:127.0.0.1]:8080',
      'http://[::ffff:7f00:1]',
      'http://[::127.0.0.1]',
      'http://[::7f00:1]',
      'http://[fe80::1]',
      'http://[fe90::1]',
      'http://0.1.2.3',
      'http://169.254.169.254',
      'http://app',
      'http://0x7f.1',
      'http://2130706433',
    ]) {
      const dir = await project([{ ...DEV, url }], (head) => evidence({}, head));
      const found = await run(dir, 'skeleton-deployed');
      expect(found[0]?.message, url).toContain('Only local development environments');
    }
    for (const url of [
      'https://127.example.com',
      'http://10.20.30.40:8080',
      'https://dev.example.com.',
    ]) {
      const host = new URL(url).host.replace(/:\d+$/, '').replace(/\.$/, '');
      const dir = await project([{ ...DEV, url }], (head) =>
        evidence(
          {
            health: {
              url: `${new URL(url).protocol}//${host}/health`,
              status: 200,
              checked_at: '2026-01-02T10:01:00Z',
            },
          },
          head,
        ),
      );
      expect(await run(dir, 'skeleton-deployed'), url).toEqual([]);
    }
  });

  it('the deployed commit must be in the history of the checked-out commit, and the health check must not precede the deployment', async () => {
    const { dir } = await createTestProject();
    await writeAndCommit(dir, { [`${KB_ROOT}/delivery/environments.md`]: register([DEV]) });
    await execa('git', ['checkout', '--quiet', '-b', 'elsewhere'], { cwd: dir });
    await writeAndCommit(dir, { 'other.txt': 'a commit only on another branch' });
    const foreign = await sha(dir);
    await execa('git', ['checkout', '--quiet', 'main'], { cwd: dir });
    await writeAndCommit(dir, {
      'docs/forge/reports/deployments/ENV-002.json': evidence({}, foreign),
    });
    const found = await run(dir, 'skeleton-deployed');
    expect(found[0]?.message).toContain('not in the history of the checked-out commit');

    const head = await sha(dir);
    await writeAndCommit(dir, {
      'docs/forge/reports/deployments/ENV-002.json': evidence(
        {
          health: {
            url: 'https://dev.example.com/',
            status: 200,
            checked_at: '2026-01-01T09:00:00Z',
          },
        },
        head,
      ),
    });
    expect((await run(dir, 'skeleton-deployed'))[0]?.message).toContain('before deployed_at');
  });

  it('a timestamp with no zone is refused: its meaning would depend on the machine that reads it', async () => {
    const dir = await project([DEV], (head) =>
      evidence({ deployed_at: '2026-01-02T10:00:00' }, head),
    );
    expect((await run(dir, 'skeleton-deployed'))[0]?.message).toContain('deployed_at');
    const offset = await project([DEV], (head) =>
      evidence(
        {
          deployed_at: '2026-01-02T10:00:00+02:00',
          health: {
            url: 'https://dev.example.com/',
            status: 200,
            checked_at: '2026-01-02T10:01:00+02:00',
          },
        },
        head,
      ),
    );
    expect(await run(offset, 'skeleton-deployed')).toEqual([]);
  });

  it('a deployment record that is only in the working tree is not part of the repository', async () => {
    const { dir } = await createTestProject();
    await writeAndCommit(dir, { [`${KB_ROOT}/delivery/environments.md`]: register([DEV]) });
    await mkdir(path.join(dir, 'docs/forge/reports/deployments'), { recursive: true });
    await writeFile(
      path.join(dir, 'docs/forge/reports/deployments/ENV-002.json'),
      evidence({}, await sha(dir)),
    );
    expect((await run(dir, 'skeleton-deployed'))[0]?.message).toContain(
      'exists but is not committed',
    );
  });

  it('a FIFO where the record should be neither hangs nor passes', async () => {
    const { dir } = await createTestProject();
    await writeAndCommit(dir, { [`${KB_ROOT}/delivery/environments.md`]: register([DEV]) });
    await mkdir(path.join(dir, 'docs/forge/reports/deployments'), { recursive: true });
    await execa('mkfifo', [path.join(dir, 'docs/forge/reports/deployments/ENV-002.json')]);
    const started = Date.now();
    const found = await run(dir, 'skeleton-deployed');
    expect(found).toHaveLength(1);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('an oversized deployment record is refused rather than read', async () => {
    const dir = await project([DEV], () => 'x'.repeat(2 * 1024 * 1024));
    expect((await run(dir, 'skeleton-deployed'))[0]?.message).toContain('byte limit');
  });

  it('an environment that is not a development one does not count, even with a record', async () => {
    const staging: EnvSpec = {
      id: 'ENV-002',
      purpose: 'Staging: pre-production verification',
      url: 'https://staging.example.com',
    };
    const dir = await project([staging], (head) => evidence({}, head));
    const found = await run(dir, 'skeleton-deployed');
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('No Environment entry is a development environment');
  });

  it('"devops" and "device" are not "dev"', async () => {
    const dir = await project(
      [{ id: 'ENV-002', purpose: 'Devops sandbox for device farms', url: 'https://x.example.com' }],
      (head) => evidence({}, head),
    );
    expect((await run(dir, 'skeleton-deployed'))[0]?.message).toContain(
      'No Environment entry is a development',
    );
  });

  it('fails a deployed-looking development environment with no deployment record', async () => {
    const found = await run(await project([DEV]), 'skeleton-deployed');
    expect(found).toHaveLength(1);
    expect(found[0]?.subject).toBe('ENV-002');
    expect(found[0]?.message).toContain(
      'no deployment record at docs/forge/reports/deployments/ENV-002.json',
    );
  });

  it('fails each way the record can be wrong', async () => {
    const cases: readonly [string, (head: string) => Record<string, unknown>, string][] = [
      ['failed outcome', () => ({ outcome: 'failed' }), 'not "succeeded"'],
      ['no outcome', () => ({ outcome: undefined }), 'not "succeeded"'],
      ['wrong environment', () => ({ environment: 'ENV-009' }), 'not ENV-002'],
      ['wrong version', () => ({ v: 2 }), '"v": 1'],
      ['no sha', () => ({ sha: undefined }), '"sha"'],
      ['non-hex sha', () => ({ sha: 'not-a-sha' }), '"sha"'],
      ['sha not in the repository', () => ({ sha: 'a'.repeat(40) }), 'not in this repository'],
      ['no deployed_at', () => ({ deployed_at: undefined }), 'deployed_at'],
      ['unparseable deployed_at', () => ({ deployed_at: 'yesterday' }), 'deployed_at'],
      ['no health', () => ({ health: undefined }), '"health"'],
      [
        'health url off host',
        () => ({
          health: {
            url: 'https://other.example.com/',
            status: 200,
            checked_at: '2026-01-02T10:01:00Z',
          },
        }),
        'not the environment',
      ],
      [
        'health url local',
        () => ({
          health: { url: 'http://localhost/', status: 200, checked_at: '2026-01-02T10:01:00Z' },
        }),
        'local address',
      ],
      [
        'health 500',
        () => ({
          health: {
            url: 'https://dev.example.com/',
            status: 500,
            checked_at: '2026-01-02T10:01:00Z',
          },
        }),
        'not a 2xx',
      ],
      [
        'health status as string',
        () => ({
          health: {
            url: 'https://dev.example.com/',
            status: '200',
            checked_at: '2026-01-02T10:01:00Z',
          },
        }),
        'not a 2xx',
      ],
      [
        'no checked_at',
        () => ({ health: { url: 'https://dev.example.com/', status: 200 } }),
        'health.checked_at',
      ],
    ];
    for (const [name, override, expected] of cases) {
      const dir = await project([DEV], (head) => evidence(override(head), head));
      const found = await run(dir, 'skeleton-deployed');
      expect(found, name).toHaveLength(1);
      expect(found[0]?.subject, name).toBe('ENV-002');
      expect(found[0]?.message, name).toContain(expected);
    }
  });

  it('a record that is not JSON, or not an object, fails naming the file', async () => {
    for (const text of ['{ nope', '[]', '"deployed"', 'null']) {
      const dir = await project([DEV], () => text);
      const found = await run(dir, 'skeleton-deployed');
      expect(found, text).toHaveLength(1);
      expect(found[0]?.message).toContain('docs/forge/reports/deployments/ENV-002.json');
    }
  });

  it('a record for another environment id does not satisfy this one', async () => {
    const dir = await project([DEV], (head) => evidence({}, head), 'ENV-003.json');
    expect((await run(dir, 'skeleton-deployed'))[0]?.message).toContain('no deployment record');
  });

  it('an environment register that fails its schema is a violation, not a skip', async () => {
    const { dir } = await createTestProject();
    await writeAndCommit(dir, {
      [`${KB_ROOT}/delivery/environments.md`]: `---
type: Environment
schemaVersion: 1
title: Environments
status: active
created: 2026-01-01
updated: 2026-01-01
revision: 1
author: platform
changelog: []
environments:
  - id: ENV-002
    purpose: development
---
`,
    });
    const found = await run(dir, 'skeleton-deployed');
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('could not be read');
  });

  it('when several development environments are recorded, one satisfied environment is enough', async () => {
    const second: EnvSpec = {
      id: 'ENV-003',
      purpose: 'Second dev sandbox',
      url: 'https://dev2.example.com',
    };
    const dir = await project([DEV, second], (head) => evidence({}, head));
    expect(await run(dir, 'skeleton-deployed')).toEqual([]);
  });

  it('when several are recorded and none is satisfied, each is reported', async () => {
    const second: EnvSpec = {
      id: 'ENV-003',
      purpose: 'Second dev sandbox',
      url: 'https://dev2.example.com',
    };
    const found = await run(await project([DEV, second]), 'skeleton-deployed');
    expect(found.map((v) => v.subject)).toEqual(['ENV-002', 'ENV-003']);
  });

  it('is deterministic', async () => {
    const dir = await project([LOCAL, DEV], (head) => evidence({ outcome: 'failed' }, head));
    expect(JSON.stringify(await run(dir, 'skeleton-deployed'))).toBe(
      JSON.stringify(await run(dir, 'skeleton-deployed')),
    );
  });
});
