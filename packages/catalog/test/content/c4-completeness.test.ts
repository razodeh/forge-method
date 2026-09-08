/**
 * C4's own Checks section: every named item in `12` §12.2's own "Catalog scope" table rows 12-18
 * (CI/CD, Containers/orchestration, IaC, Observability, Testing, Feature flags & config, Secrets) has a
 * real, schema-valid entry -- mirroring C2/C3's own completeness-test shape exactly. Also, since this is
 * the last content piece, a final whole-catalog completeness test: every row of the full table (all 18
 * rows, C2+C3+C4 combined) has real coverage.
 *
 * @see specs/12 §12.2
 * @see PLAN-M6.md C4
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadCatalogEntry } from '../../src/schema/load.ts';

const repoRoot = path.resolve(import.meta.dirname, '../../../..');
const catalogRoot = path.resolve(import.meta.dirname, '../../catalog');

interface RequiredItem {
  readonly row: string;
  readonly cellText: string;
  readonly kind: string;
  readonly id: string;
}

const C4_REQUIRED: readonly RequiredItem[] = [
  // CI/CD
  { row: 'CI/CD', cellText: 'GitHub Actions', kind: 'ci', id: 'github-actions' },
  { row: 'CI/CD', cellText: 'GitLab CI', kind: 'ci', id: 'gitlab-ci' },
  { row: 'CI/CD', cellText: 'Jenkins', kind: 'ci', id: 'jenkins' },
  { row: 'CI/CD', cellText: 'CircleCI', kind: 'ci', id: 'circleci' },
  { row: 'CI/CD', cellText: 'Buildkite', kind: 'ci', id: 'buildkite' },
  { row: 'CI/CD', cellText: 'Argo CD', kind: 'ci', id: 'argo-cd' },
  { row: 'CI/CD', cellText: 'Flux', kind: 'ci', id: 'flux' },
  { row: 'CI/CD', cellText: 'Spinnaker', kind: 'ci', id: 'spinnaker' },
  // Containers/orchestration
  { row: 'Containers/orchestration', cellText: 'Docker', kind: 'container', id: 'docker' },
  { row: 'Containers/orchestration', cellText: 'Podman', kind: 'container', id: 'podman' },
  { row: 'Containers/orchestration', cellText: 'Kubernetes', kind: 'container', id: 'kubernetes' },
  {
    row: 'Containers/orchestration',
    cellText: 'ECS/Fargate',
    kind: 'container',
    id: 'ecs-fargate',
  },
  { row: 'Containers/orchestration', cellText: 'Nomad', kind: 'container', id: 'nomad' },
  { row: 'Containers/orchestration', cellText: 'Cloud Run', kind: 'container', id: 'cloud-run' },
  { row: 'Containers/orchestration', cellText: 'App Runner', kind: 'container', id: 'app-runner' },
  { row: 'Containers/orchestration', cellText: 'Fly.io', kind: 'container', id: 'fly-io' },
  { row: 'Containers/orchestration', cellText: 'Render', kind: 'container', id: 'render' },
  { row: 'Containers/orchestration', cellText: 'Railway', kind: 'container', id: 'railway' },
  { row: 'Containers/orchestration', cellText: 'Vercel', kind: 'container', id: 'vercel' },
  { row: 'Containers/orchestration', cellText: 'Netlify', kind: 'container', id: 'netlify' },
  // IaC
  { row: 'IaC', cellText: 'Terraform/OpenTofu', kind: 'iac', id: 'terraform-opentofu' },
  { row: 'IaC', cellText: 'Pulumi', kind: 'iac', id: 'pulumi' },
  { row: 'IaC', cellText: 'CDK', kind: 'iac', id: 'cdk' },
  { row: 'IaC', cellText: 'CloudFormation', kind: 'iac', id: 'cloudformation' },
  { row: 'IaC', cellText: 'Ansible', kind: 'iac', id: 'ansible' },
  { row: 'IaC', cellText: 'Helm', kind: 'iac', id: 'helm' },
  { row: 'IaC', cellText: 'Kustomize', kind: 'iac', id: 'kustomize' },
  { row: 'IaC', cellText: 'Crossplane', kind: 'iac', id: 'crossplane' },
  // Observability
  { row: 'Observability', cellText: 'OpenTelemetry', kind: 'observability', id: 'opentelemetry' },
  { row: 'Observability', cellText: 'Prometheus', kind: 'observability', id: 'prometheus' },
  {
    row: 'Observability',
    cellText: 'Grafana+Loki+Tempo+Mimir (LGTM)',
    kind: 'observability',
    id: 'grafana-lgtm',
  },
  { row: 'Observability', cellText: 'Datadog', kind: 'observability', id: 'datadog' },
  { row: 'Observability', cellText: 'New Relic', kind: 'observability', id: 'new-relic' },
  { row: 'Observability', cellText: 'Honeycomb', kind: 'observability', id: 'honeycomb' },
  { row: 'Observability', cellText: 'Sentry', kind: 'observability', id: 'sentry' },
  { row: 'Observability', cellText: 'Elastic', kind: 'observability', id: 'elastic' },
  { row: 'Observability', cellText: 'Jaeger', kind: 'observability', id: 'jaeger' },
  { row: 'Observability', cellText: 'Pyroscope', kind: 'observability', id: 'pyroscope' },
  // Testing
  { row: 'Testing', cellText: 'Vitest/Jest', kind: 'testing', id: 'vitest-jest' },
  { row: 'Testing', cellText: 'Playwright', kind: 'testing', id: 'playwright' },
  { row: 'Testing', cellText: 'Cypress', kind: 'testing', id: 'cypress' },
  { row: 'Testing', cellText: 'pytest', kind: 'testing', id: 'pytest' },
  { row: 'Testing', cellText: 'JUnit5', kind: 'testing', id: 'junit5' },
  { row: 'Testing', cellText: 'testcontainers', kind: 'testing', id: 'testcontainers' },
  { row: 'Testing', cellText: 'k6/Gatling/Locust', kind: 'testing', id: 'k6-gatling-locust' },
  { row: 'Testing', cellText: 'Pact (contract)', kind: 'testing', id: 'pact' },
  { row: 'Testing', cellText: 'Schemathesis', kind: 'testing', id: 'schemathesis' },
  {
    row: 'Testing',
    cellText: 'Hypothesis/fast-check',
    kind: 'testing',
    id: 'hypothesis-fast-check',
  },
  { row: 'Testing', cellText: 'Stryker (mutation)', kind: 'testing', id: 'stryker' },
  // Feature flags & config
  {
    row: 'Feature flags & config',
    cellText: 'OpenFeature',
    kind: 'feature-flags',
    id: 'openfeature',
  },
  { row: 'Feature flags & config', cellText: 'Unleash', kind: 'feature-flags', id: 'unleash' },
  {
    row: 'Feature flags & config',
    cellText: 'LaunchDarkly',
    kind: 'feature-flags',
    id: 'launchdarkly',
  },
  { row: 'Feature flags & config', cellText: 'Flagsmith', kind: 'feature-flags', id: 'flagsmith' },
  {
    row: 'Feature flags & config',
    cellText: 'env+config service',
    kind: 'feature-flags',
    id: 'env-config-service',
  },
  // Secrets
  { row: 'Secrets', cellText: 'Vault', kind: 'secrets', id: 'vault' },
  {
    row: 'Secrets',
    cellText: 'AWS/GCP/Azure secret managers',
    kind: 'secrets',
    id: 'aws-gcp-azure-secret-managers',
  },
  { row: 'Secrets', cellText: 'SOPS+age', kind: 'secrets', id: 'sops-age' },
  { row: 'Secrets', cellText: 'Doppler', kind: 'secrets', id: 'doppler' },
  {
    row: 'Secrets',
    cellText: '1Password/Infisical',
    kind: 'secrets',
    id: '1password-infisical',
  },
];

function findSpecFile(): string {
  const specsDir = path.join(repoRoot, 'specs');
  const match = readdirSync(specsDir).find((name) => name.startsWith('12-'));
  if (match === undefined) throw new Error('specs/12-*.md not found');
  return path.join(specsDir, match);
}

describe("C4 completeness against 12 §12.2's own scope table", () => {
  const specText = readFileSync(findSpecFile(), 'utf8');
  const specLines = new Map<string, string>();
  for (const item of C4_REQUIRED) {
    if (!specLines.has(item.row)) {
      const line = specText
        .split('\n')
        .find((candidate) => candidate.startsWith(`| ${item.row} |`));
      if (line === undefined) throw new Error(`row "${item.row}" not found in specs/12-*.md`);
      specLines.set(item.row, line);
    }
  }

  it.each(C4_REQUIRED)(
    '$row: "$cellText" still appears in the live spec row (canary against spec drift)',
    ({ row, cellText }) => {
      expect(specLines.get(row)).toContain(cellText);
    },
  );

  it.each(C4_REQUIRED)(
    '$row: "$cellText" has a real, loadable entry at $kind/$id.entry.yaml',
    ({ kind, id }) => {
      const filePath = path.join(catalogRoot, kind, `${id}.entry.yaml`);
      const source = readFileSync(filePath, 'utf8');
      const result = loadCatalogEntry(source, `${kind}/${id}.entry.yaml`);
      if (!result.success)
        throw new Error(
          `${kind}/${id}.entry.yaml failed to load: ${JSON.stringify(result.issues)}`,
        );
      expect(result.entry.id).toBe(id);
      expect(result.entry.kind).toBe(kind);
    },
  );

  it.each([
    'ci',
    'container',
    'iac',
    'observability',
    'testing',
    'feature-flags',
    'secrets',
  ] as const)('ships exactly the required set for kind "%s", no more, no fewer', (kind) => {
    const shipped = readdirSync(path.join(catalogRoot, kind))
      .filter((name) => name.endsWith('.entry.yaml'))
      .map((name) => name.replace(/\.entry\.yaml$/, ''))
      .sort();
    const required = C4_REQUIRED.filter((item) => item.kind === kind)
      .map((item) => item.id)
      .sort();
    expect(shipped).toEqual(required);
  });
});

describe("final whole-catalog completeness against 12 §12.2's own full scope table (all 18 rows)", () => {
  const ALL_KINDS = [
    'language',
    'framework',
    'frontend',
    'mobile',
    'stack',
    'datastore',
    'queue',
    'stream',
    'api-style',
    'orm',
    'auth',
    'ci',
    'container',
    'iac',
    'observability',
    'testing',
    'feature-flags',
    'secrets',
  ] as const;

  it('every scope-table kind directory exists and ships at least one entry', () => {
    for (const kind of ALL_KINDS) {
      const kindPath = path.join(catalogRoot, kind);
      const files = readdirSync(kindPath).filter((name) => name.endsWith('.entry.yaml'));
      expect(files.length).toBeGreaterThan(0);
    }
  });

  it('the whole shipped catalog totals 183 entries: 56 (C2) + 68 (C3) + 59 (C4)', () => {
    let total = 0;
    for (const kind of ALL_KINDS) {
      total += readdirSync(path.join(catalogRoot, kind)).filter((name) =>
        name.endsWith('.entry.yaml'),
      ).length;
    }
    expect(total).toBe(183);
  });

  it('every shipped entry loads cleanly with no schema/hygiene issues', () => {
    for (const kind of ALL_KINDS) {
      const kindPath = path.join(catalogRoot, kind);
      for (const fileName of readdirSync(kindPath)) {
        const source = readFileSync(path.join(kindPath, fileName), 'utf8');
        const result = loadCatalogEntry(source, `${kind}/${fileName}`);
        if (!result.success)
          throw new Error(`${kind}/${fileName} failed to load: ${JSON.stringify(result.issues)}`);
      }
    }
  });
});
