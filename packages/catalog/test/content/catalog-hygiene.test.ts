/**
 * Every shipped catalog entry, across every piece (C2, C3, and beyond) validates cleanly against
 * `validateEntry`, `fits_when`/`avoid_when` each name at least two real *distinct* conditions (a
 * mechanical non-emptiness/length/distinctness floor, not a subjective quality bar), and no list field
 * contains an accidental exact or near-duplicate item.
 *
 * A `pairs_with`/`alternatives` reference to an id from a row this milestone hasn't shipped content for
 * yet is expected to be "dangling" until that piece ships -- `KNOWN_FUTURE_IDS` is the explicit, closed
 * allowlist of ids `12` §12.2's own scope table promises will exist once the whole catalog is built,
 * comma-split from each remaining row exactly as every shipped row's own items were (`SPEC-QUESTIONS.md`
 * Q86/Q87's "split on commas, not further" rule). Any other dangling reference is a real authoring bug
 * this test still catches. As each future piece ships, its own ids move out of this allowlist (they
 * resolve for real) rather than needing a new copy of this whole file -- one hygiene test for the whole
 * catalog, not one per piece.
 *
 * The near-duplicate check exists because of a real bug C2 shipped and a fresh critic round caught
 * (`SPEC-QUESTIONS.md` Q89): a mechanical `length >= 2` count floor does not itself prove two *distinct*
 * conditions -- 33 of C2's own 56 files initially padded a list with a copy or near-copy of its only real
 * point. This test is that lesson made permanent, not just fixed once by hand.
 *
 * @see specs/12 §12.2
 * @see PLAN-M6.md C2, C3
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadCatalogEntry } from '../../src/schema/load.ts';
import { CatalogRegistry } from '../../src/registry/registry.ts';
import { validateEntry } from '../../src/registry/validate.ts';
import type { CatalogEntry } from '../../src/schema/types.ts';

const catalogRoot = path.resolve(import.meta.dirname, '../../catalog');

/** Every id `12` §12.2's own scope table names in a row not yet shipped (C4: CI/CD, Containers/
 * orchestration, IaC, Observability, Testing, Feature flags & config, Secrets). */
const KNOWN_FUTURE_IDS = new Set([
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

function loadAllShippedEntries(): readonly CatalogEntry[] {
  const entries: CatalogEntry[] = [];
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

/** Word-overlap (Jaccard) similarity -- deliberately coarse: this only needs to catch "these two list
 * items say basically the same thing," not do real semantic comparison. 0.4 was chosen empirically
 * against the real C2 near-duplicates Q89 found (all scored 0.42-0.73) while not flagging genuinely
 * distinct conditions that happen to share a few common words. */
function jaccardSimilarity(a: string, b: string): number {
  const wordsOf = (text: string) => new Set(text.toLowerCase().split(/\W+/).filter(Boolean));
  const wa = wordsOf(a);
  const wb = wordsOf(b);
  const intersection = [...wa].filter((word) => wb.has(word)).length;
  const union = new Set([...wa, ...wb]).size;
  return union === 0 ? 0 : intersection / union;
}

const LIST_FIELDS = [
  'strengths',
  'weaknesses',
  'fits_when',
  'avoid_when',
  'notes_for_agents',
] as const;

describe('every shipped catalog entry', () => {
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

  it.each(entries.map((entry) => [entry.id, entry] as const))(
    '%s: no list field contains an exact or near-duplicate item',
    (_id, entry) => {
      const duplicates: string[] = [];
      for (const field of LIST_FIELDS) {
        const items = entry[field];
        for (let i = 0; i < items.length; i += 1) {
          for (let j = i + 1; j < items.length; j += 1) {
            if (jaccardSimilarity(items[i]!, items[j]!) > 0.4) {
              duplicates.push(`${field}[${String(i)}] ~= ${field}[${String(j)}]`);
            }
          }
        }
      }
      expect(duplicates).toEqual([]);
    },
  );
});
