/**
 * C3's own Checks section: every named item in `12` §12.2's own "Catalog scope" table rows 6-11
 * (Datastores, Messaging/stream, Stream/batch processing, API styles, ORM/data access, Auth) has a
 * real, schema-valid entry. Mirrors `c2-completeness.test.ts`'s own approach exactly -- see that file's
 * doc comment for the rationale (live-spec cross-check, hand-authored id slugs).
 *
 * @see specs/12 §12.2
 * @see PLAN-M6.md C3
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

const REQUIRED: readonly RequiredItem[] = [
  // Datastores
  { row: 'Datastores', cellText: 'PostgreSQL', kind: 'datastore', id: 'postgresql' },
  { row: 'Datastores', cellText: 'MySQL/MariaDB', kind: 'datastore', id: 'mysql-mariadb' },
  { row: 'Datastores', cellText: 'SQLite', kind: 'datastore', id: 'sqlite' },
  { row: 'Datastores', cellText: 'CockroachDB', kind: 'datastore', id: 'cockroachdb' },
  { row: 'Datastores', cellText: 'YugabyteDB', kind: 'datastore', id: 'yugabytedb' },
  { row: 'Datastores', cellText: 'MongoDB', kind: 'datastore', id: 'mongodb' },
  { row: 'Datastores', cellText: 'DynamoDB', kind: 'datastore', id: 'dynamodb' },
  {
    row: 'Datastores',
    cellText: 'Cassandra/ScyllaDB',
    kind: 'datastore',
    id: 'cassandra-scylladb',
  },
  { row: 'Datastores', cellText: 'Redis/Valkey', kind: 'datastore', id: 'redis-valkey' },
  { row: 'Datastores', cellText: 'Neo4j', kind: 'datastore', id: 'neo4j' },
  { row: 'Datastores', cellText: 'ClickHouse', kind: 'datastore', id: 'clickhouse' },
  { row: 'Datastores', cellText: 'DuckDB', kind: 'datastore', id: 'duckdb' },
  { row: 'Datastores', cellText: 'Snowflake', kind: 'datastore', id: 'snowflake' },
  { row: 'Datastores', cellText: 'BigQuery', kind: 'datastore', id: 'bigquery' },
  { row: 'Datastores', cellText: 'Redshift', kind: 'datastore', id: 'redshift' },
  {
    row: 'Datastores',
    cellText: 'InfluxDB/Timescale',
    kind: 'datastore',
    id: 'influxdb-timescale',
  },
  {
    row: 'Datastores',
    cellText: 'Elasticsearch/OpenSearch',
    kind: 'datastore',
    id: 'elasticsearch-opensearch',
  },
  {
    row: 'Datastores',
    cellText: 'Meilisearch/Typesense',
    kind: 'datastore',
    id: 'meilisearch-typesense',
  },
  {
    row: 'Datastores',
    cellText: 'S3-class object stores',
    kind: 'datastore',
    id: 's3-class-object-stores',
  },
  { row: 'Datastores', cellText: 'EventStoreDB', kind: 'datastore', id: 'eventstoredb' },
  // Messaging/stream
  { row: 'Messaging/stream', cellText: 'Kafka', kind: 'queue', id: 'kafka' },
  { row: 'Messaging/stream', cellText: 'Redpanda', kind: 'queue', id: 'redpanda' },
  { row: 'Messaging/stream', cellText: 'RabbitMQ', kind: 'queue', id: 'rabbitmq' },
  { row: 'Messaging/stream', cellText: 'NATS/JetStream', kind: 'queue', id: 'nats-jetstream' },
  {
    row: 'Messaging/stream',
    cellText: 'AWS SQS/SNS/EventBridge/Kinesis',
    kind: 'queue',
    id: 'aws-sqs-sns-eventbridge-kinesis',
  },
  { row: 'Messaging/stream', cellText: 'GCP Pub/Sub', kind: 'queue', id: 'gcp-pub-sub' },
  {
    row: 'Messaging/stream',
    cellText: 'Azure Service Bus',
    kind: 'queue',
    id: 'azure-service-bus',
  },
  { row: 'Messaging/stream', cellText: 'Pulsar', kind: 'queue', id: 'pulsar' },
  {
    row: 'Messaging/stream',
    cellText: 'Temporal (durable execution)',
    kind: 'queue',
    id: 'temporal',
  },
  // Stream/batch processing
  { row: 'Stream/batch processing', cellText: 'Flink', kind: 'stream', id: 'flink' },
  { row: 'Stream/batch processing', cellText: 'Spark', kind: 'stream', id: 'spark' },
  {
    row: 'Stream/batch processing',
    cellText: 'Kafka Streams',
    kind: 'stream',
    id: 'kafka-streams',
  },
  { row: 'Stream/batch processing', cellText: 'Beam', kind: 'stream', id: 'beam' },
  { row: 'Stream/batch processing', cellText: 'dbt', kind: 'stream', id: 'dbt' },
  { row: 'Stream/batch processing', cellText: 'Airflow', kind: 'stream', id: 'airflow' },
  { row: 'Stream/batch processing', cellText: 'Dagster', kind: 'stream', id: 'dagster' },
  { row: 'Stream/batch processing', cellText: 'Prefect', kind: 'stream', id: 'prefect' },
  { row: 'Stream/batch processing', cellText: 'Airbyte', kind: 'stream', id: 'airbyte' },
  { row: 'Stream/batch processing', cellText: 'Debezium', kind: 'stream', id: 'debezium' },
  // API styles
  { row: 'API styles', cellText: 'REST', kind: 'api-style', id: 'rest' },
  { row: 'API styles', cellText: 'GraphQL', kind: 'api-style', id: 'graphql' },
  { row: 'API styles', cellText: 'gRPC', kind: 'api-style', id: 'grpc' },
  { row: 'API styles', cellText: 'tRPC', kind: 'api-style', id: 'trpc' },
  { row: 'API styles', cellText: 'WebSocket/SSE', kind: 'api-style', id: 'websocket-sse' },
  { row: 'API styles', cellText: 'webhooks', kind: 'api-style', id: 'webhooks' },
  {
    row: 'API styles',
    cellText: 'GraphQL Federation',
    kind: 'api-style',
    id: 'graphql-federation',
  },
  { row: 'API styles', cellText: 'AsyncAPI', kind: 'api-style', id: 'asyncapi' },
  // ORM/data access
  { row: 'ORM/data access', cellText: 'Prisma', kind: 'orm', id: 'prisma' },
  { row: 'ORM/data access', cellText: 'Drizzle', kind: 'orm', id: 'drizzle' },
  { row: 'ORM/data access', cellText: 'TypeORM', kind: 'orm', id: 'typeorm' },
  { row: 'ORM/data access', cellText: 'SQLAlchemy', kind: 'orm', id: 'sqlalchemy' },
  { row: 'ORM/data access', cellText: 'Django ORM', kind: 'orm', id: 'django-orm' },
  { row: 'ORM/data access', cellText: 'Hibernate/JPA', kind: 'orm', id: 'hibernate-jpa' },
  { row: 'ORM/data access', cellText: 'jOOQ', kind: 'orm', id: 'jooq' },
  { row: 'ORM/data access', cellText: 'sqlc', kind: 'orm', id: 'sqlc' },
  { row: 'ORM/data access', cellText: 'Ecto', kind: 'orm', id: 'ecto' },
  { row: 'ORM/data access', cellText: 'ActiveRecord', kind: 'orm', id: 'activerecord' },
  {
    row: 'ORM/data access',
    cellText: 'raw SQL + query builder',
    kind: 'orm',
    id: 'raw-sql-query-builder',
  },
  // Auth
  { row: 'Auth', cellText: 'OAuth2/OIDC', kind: 'auth', id: 'oauth2-oidc' },
  { row: 'Auth', cellText: 'SAML', kind: 'auth', id: 'saml' },
  { row: 'Auth', cellText: 'JWT vs sessions', kind: 'auth', id: 'jwt-vs-sessions' },
  { row: 'Auth', cellText: 'Auth0/Okta/Entra', kind: 'auth', id: 'auth0-okta-entra' },
  { row: 'Auth', cellText: 'Keycloak', kind: 'auth', id: 'keycloak' },
  { row: 'Auth', cellText: 'Ory', kind: 'auth', id: 'ory' },
  { row: 'Auth', cellText: 'Clerk', kind: 'auth', id: 'clerk' },
  { row: 'Auth', cellText: 'Supabase Auth', kind: 'auth', id: 'supabase-auth' },
  { row: 'Auth', cellText: 'Cognito', kind: 'auth', id: 'cognito' },
  { row: 'Auth', cellText: 'WebAuthn/passkeys', kind: 'auth', id: 'webauthn-passkeys' },
];

function findSpecFile(): string {
  const specsDir = path.join(repoRoot, 'specs');
  const match = readdirSync(specsDir).find((name) => name.startsWith('12-'));
  if (match === undefined) throw new Error('specs/12-*.md not found');
  return path.join(specsDir, match);
}

describe("C3 completeness against 12 §12.2's own scope table", () => {
  const specText = readFileSync(findSpecFile(), 'utf8');
  const specLines = new Map<string, string>();
  for (const item of REQUIRED) {
    if (!specLines.has(item.row)) {
      const line = specText
        .split('\n')
        .find((candidate) => candidate.startsWith(`| ${item.row} |`));
      if (line === undefined) throw new Error(`row "${item.row}" not found in specs/12-*.md`);
      specLines.set(item.row, line);
    }
  }

  it.each(REQUIRED)(
    '$row: "$cellText" still appears in the live spec row (canary against spec drift)',
    ({ row, cellText }) => {
      expect(specLines.get(row)).toContain(cellText);
    },
  );

  it.each(REQUIRED)(
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

  it.each(['datastore', 'queue', 'stream', 'api-style', 'orm', 'auth'] as const)(
    'ships exactly the required set for kind "%s", no more, no fewer',
    (kind) => {
      const shipped = readdirSync(path.join(catalogRoot, kind))
        .filter((name) => name.endsWith('.entry.yaml'))
        .map((name) => name.replace(/\.entry\.yaml$/, ''))
        .sort();
      const required = REQUIRED.filter((item) => item.kind === kind)
        .map((item) => item.id)
        .sort();
      expect(shipped).toEqual(required);
    },
  );
});
