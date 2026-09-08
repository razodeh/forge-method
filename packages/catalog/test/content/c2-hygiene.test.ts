/**
 * C2's own Checks section: every shipped entry validates cleanly against `validateEntry`, and
 * `fits_when`/`avoid_when` each name at least two real conditions (a mechanical non-emptiness/length
 * floor, not a subjective quality bar).
 *
 * A `pairs_with`/`alternatives` reference to an id from a *later* catalog piece (C3/C4's own datastore,
 * container, ORM, etc. rows) is expected to be "dangling" until that piece ships -- `KNOWN_FUTURE_IDS`
 * is the explicit, closed allowlist of ids `12` §12.2's own scope table promises will exist once the
 * whole catalog is built, transcribed from that table's own remaining rows. Any other dangling reference
 * is a real authoring bug this test still catches.
 *
 * @see specs/12 §12.2
 * @see PLAN-M6.md C2
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadCatalogEntry } from '../../src/schema/load.ts';
import { CatalogRegistry } from '../../src/registry/registry.ts';
import { validateEntry } from '../../src/registry/validate.ts';

const catalogRoot = path.resolve(import.meta.dirname, '../../catalog');

/** Every id `12` §12.2's own scope table names in a row this milestone hasn't shipped content for yet
 * (C3: datastores/messaging/stream/API-styles/ORM/auth; C4: CI/containers/IaC/observability/testing/
 * feature-flags/secrets) -- comma-split from each row exactly as C2's own items were, per
 * `SPEC-QUESTIONS.md` Q86/Q87's "split on commas, not further" rule. */
const KNOWN_FUTURE_IDS = new Set([
  // Datastores
  'postgresql',
  'mysql-mariadb',
  'sqlite',
  'cockroachdb',
  'yugabytedb',
  'mongodb',
  'dynamodb',
  'cassandra-scylladb',
  'redis-valkey',
  'neo4j',
  'clickhouse',
  'duckdb',
  'snowflake',
  'bigquery',
  'redshift',
  'influxdb-timescale',
  'elasticsearch-opensearch',
  'meilisearch-typesense',
  's3-class-object-stores',
  'eventstoredb',
  // Messaging/stream
  'kafka',
  'redpanda',
  'rabbitmq',
  'nats-jetstream',
  'aws-sqs-sns-eventbridge-kinesis',
  'gcp-pub-sub',
  'azure-service-bus',
  'pulsar',
  'temporal',
  // Stream/batch processing
  'flink',
  'spark',
  'kafka-streams',
  'beam',
  'dbt',
  'airflow',
  'dagster',
  'prefect',
  'airbyte',
  'debezium',
  // API styles
  'rest',
  'graphql',
  'grpc',
  'trpc',
  'websocket-sse',
  'webhooks',
  'graphql-federation',
  'asyncapi',
  // ORM/data access
  'prisma',
  'drizzle',
  'typeorm',
  'sqlalchemy',
  'django-orm',
  'hibernate-jpa',
  'jooq',
  'sqlc',
  'ecto',
  'activerecord',
  'raw-sql-query-builder',
  // Auth
  'oauth2-oidc',
  'saml',
  'jwt-vs-sessions',
  'auth0-okta-entra',
  'keycloak',
  'ory',
  'clerk',
  'supabase-auth',
  'cognito',
  'webauthn-passkeys',
  // CI/CD
  'github-actions',
  'gitlab-ci',
  'jenkins',
  'circleci',
  'buildkite',
  'argo-cd',
  'flux',
  'spinnaker',
  // Containers/orchestration
  'docker',
  'podman',
  'kubernetes',
  'ecs-fargate',
  'nomad',
  'cloud-run',
  'app-runner',
  'fly-io',
  'render',
  'railway',
  'vercel',
  'netlify',
  // IaC
  'terraform-opentofu',
  'pulumi',
  'cdk',
  'cloudformation',
  'ansible',
  'helm',
  'kustomize',
  'crossplane',
  // Observability
  'opentelemetry',
  'prometheus',
  'grafana-lgtm',
  'datadog',
  'new-relic',
  'honeycomb',
  'sentry',
  'elastic',
  'jaeger',
  'pyroscope',
  // Testing
  'vitest-jest',
  'playwright',
  'cypress',
  'pytest',
  'junit5',
  'testcontainers',
  'k6-gatling-locust',
  'pact',
  'schemathesis',
  'hypothesis-fast-check',
  'stryker',
  // Feature flags & config
  'openfeature',
  'unleash',
  'launchdarkly',
  'flagsmith',
  'env-config-service',
  // Secrets
  'vault',
  'aws-gcp-azure-secret-managers',
  'sops-age',
  'doppler',
  '1password-infisical',
]);

function loadAllShippedEntries() {
  const entries = [];
  for (const kindDir of readdirSync(catalogRoot)) {
    const kindPath = path.join(catalogRoot, kindDir);
    for (const fileName of readdirSync(kindPath)) {
      const source = readFileSync(path.join(kindPath, fileName), 'utf8');
      const result = loadCatalogEntry(source, `${kindDir}/${fileName}`);
      if (!result.success)
        throw new Error(`${kindDir}/${fileName} failed to load: ${JSON.stringify(result.issues)}`);
      entries.push(result.entry);
    }
  }
  return entries;
}

describe('every shipped C2 entry', () => {
  const entries = loadAllShippedEntries();
  const registry = new CatalogRegistry(entries);

  it.each(entries.map((entry) => [entry.id, entry] as const))(
    '%s: validates cleanly, beyond references to a not-yet-shipped future catalog id',
    (_id, entry) => {
      const issues = validateEntry(entry, registry).filter((issue) => {
        if (!issue.message.includes('not a real entry id')) return true;
        const match = /"([^"]+)"/.exec(issue.message);
        const referencedId = match?.[1];
        return referencedId === undefined || !KNOWN_FUTURE_IDS.has(referencedId);
      });
      expect(issues).toEqual([]);
    },
  );

  it.each(entries.map((entry) => [entry.id, entry] as const))(
    '%s: fits_when and avoid_when each name at least two real conditions',
    (_id, entry) => {
      expect(entry.fits_when.length).toBeGreaterThanOrEqual(2);
      expect(entry.avoid_when.length).toBeGreaterThanOrEqual(2);
    },
  );
});
