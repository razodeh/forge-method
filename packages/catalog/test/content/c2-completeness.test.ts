/**
 * C2's own Checks section: every named item in `12` §12.2's own "Catalog scope" table rows 1-5
 * (Languages, Backend frameworks, Frontend, Mobile/cross-platform, Stacks) has a real, schema-valid
 * entry.
 *
 * Cross-checks against the live spec file rather than a hardcoded assumption divorced from it: each
 * required item's own comma-separated cell text is asserted to still appear in that row's own line of
 * `specs/12-*.md` (a canary against spec drift), and each required item's own shipped
 * `catalog/<kind>/<id>.entry.yaml` file is asserted to exist and load cleanly. The `id` per item is a
 * hand-authored slug, not a mechanical transform of the cell text (several cell texts -- e.g.
 * "HTMX+server-rendered", ".NET MAUI" -- don't slugify losslessly), so the mapping itself is the thing
 * under test here, the same "transcribed, not derived" precedent this whole codebase already uses for
 * fixture content.
 *
 * @see specs/12 §12.2
 * @see PLAN-M6.md C2
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
  // Languages
  { row: 'Languages', cellText: 'TypeScript/JS', kind: 'language', id: 'typescript-js' },
  { row: 'Languages', cellText: 'Python', kind: 'language', id: 'python' },
  { row: 'Languages', cellText: 'Java', kind: 'language', id: 'java' },
  { row: 'Languages', cellText: 'Kotlin', kind: 'language', id: 'kotlin' },
  { row: 'Languages', cellText: 'Go', kind: 'language', id: 'go' },
  { row: 'Languages', cellText: 'Rust', kind: 'language', id: 'rust' },
  { row: 'Languages', cellText: 'C#', kind: 'language', id: 'csharp' },
  { row: 'Languages', cellText: 'Ruby', kind: 'language', id: 'ruby' },
  { row: 'Languages', cellText: 'PHP', kind: 'language', id: 'php' },
  { row: 'Languages', cellText: 'Elixir', kind: 'language', id: 'elixir' },
  { row: 'Languages', cellText: 'Swift', kind: 'language', id: 'swift' },
  { row: 'Languages', cellText: 'Scala', kind: 'language', id: 'scala' },
  { row: 'Languages', cellText: 'C++', kind: 'language', id: 'cpp' },
  // Backend frameworks
  { row: 'Backend frameworks', cellText: 'Spring Boot', kind: 'framework', id: 'spring-boot' },
  { row: 'Backend frameworks', cellText: 'Quarkus', kind: 'framework', id: 'quarkus' },
  { row: 'Backend frameworks', cellText: 'Micronaut', kind: 'framework', id: 'micronaut' },
  { row: 'Backend frameworks', cellText: 'ASP.NET Core', kind: 'framework', id: 'aspnet-core' },
  { row: 'Backend frameworks', cellText: 'Django', kind: 'framework', id: 'django' },
  { row: 'Backend frameworks', cellText: 'FastAPI', kind: 'framework', id: 'fastapi' },
  { row: 'Backend frameworks', cellText: 'Flask', kind: 'framework', id: 'flask' },
  { row: 'Backend frameworks', cellText: 'Rails', kind: 'framework', id: 'rails' },
  { row: 'Backend frameworks', cellText: 'Laravel', kind: 'framework', id: 'laravel' },
  { row: 'Backend frameworks', cellText: 'Express', kind: 'framework', id: 'express' },
  { row: 'Backend frameworks', cellText: 'Fastify', kind: 'framework', id: 'fastify' },
  { row: 'Backend frameworks', cellText: 'NestJS', kind: 'framework', id: 'nestjs' },
  {
    row: 'Backend frameworks',
    cellText: 'Gin/Echo/Fiber',
    kind: 'framework',
    id: 'gin-echo-fiber',
  },
  { row: 'Backend frameworks', cellText: 'Axum/Actix', kind: 'framework', id: 'axum-actix' },
  { row: 'Backend frameworks', cellText: 'Phoenix', kind: 'framework', id: 'phoenix' },
  { row: 'Backend frameworks', cellText: 'Ktor', kind: 'framework', id: 'ktor' },
  // Frontend
  { row: 'Frontend', cellText: 'React', kind: 'frontend', id: 'react' },
  { row: 'Frontend', cellText: 'Next.js', kind: 'frontend', id: 'nextjs' },
  { row: 'Frontend', cellText: 'Remix', kind: 'frontend', id: 'remix' },
  { row: 'Frontend', cellText: 'Vue/Nuxt', kind: 'frontend', id: 'vue-nuxt' },
  { row: 'Frontend', cellText: 'Angular', kind: 'frontend', id: 'angular' },
  { row: 'Frontend', cellText: 'Svelte/SvelteKit', kind: 'frontend', id: 'svelte-sveltekit' },
  { row: 'Frontend', cellText: 'Solid', kind: 'frontend', id: 'solid' },
  { row: 'Frontend', cellText: 'Astro', kind: 'frontend', id: 'astro' },
  { row: 'Frontend', cellText: 'HTMX+server-rendered', kind: 'frontend', id: 'htmx-ssr' },
  { row: 'Frontend', cellText: 'Qwik', kind: 'frontend', id: 'qwik' },
  // Mobile/cross-platform
  { row: 'Mobile/cross-platform', cellText: 'Swift/SwiftUI', kind: 'mobile', id: 'swift-swiftui' },
  {
    row: 'Mobile/cross-platform',
    cellText: 'Kotlin/Compose',
    kind: 'mobile',
    id: 'kotlin-compose',
  },
  {
    row: 'Mobile/cross-platform',
    cellText: 'React Native/Expo',
    kind: 'mobile',
    id: 'react-native-expo',
  },
  { row: 'Mobile/cross-platform', cellText: 'Flutter', kind: 'mobile', id: 'flutter' },
  {
    row: 'Mobile/cross-platform',
    cellText: 'Ionic/Capacitor',
    kind: 'mobile',
    id: 'ionic-capacitor',
  },
  { row: 'Mobile/cross-platform', cellText: '.NET MAUI', kind: 'mobile', id: 'dotnet-maui' },
  { row: 'Mobile/cross-platform', cellText: 'Tauri', kind: 'mobile', id: 'tauri' },
  { row: 'Mobile/cross-platform', cellText: 'Electron', kind: 'mobile', id: 'electron' },
  // Stacks (as compositions)
  { row: 'Stacks (as compositions)', cellText: 'MERN/MEAN', kind: 'stack', id: 'mern-mean' },
  { row: 'Stacks (as compositions)', cellText: 'T3', kind: 'stack', id: 't3-stack' },
  { row: 'Stacks (as compositions)', cellText: '.NET stack', kind: 'stack', id: 'dotnet-stack' },
  { row: 'Stacks (as compositions)', cellText: 'JVM+React', kind: 'stack', id: 'jvm-react' },
  { row: 'Stacks (as compositions)', cellText: 'Django+HTMX', kind: 'stack', id: 'django-htmx' },
  {
    row: 'Stacks (as compositions)',
    cellText: 'Rails+Hotwire',
    kind: 'stack',
    id: 'rails-hotwire',
  },
  { row: 'Stacks (as compositions)', cellText: 'LAMP', kind: 'stack', id: 'lamp' },
  {
    row: 'Stacks (as compositions)',
    cellText: 'Serverless-first',
    kind: 'stack',
    id: 'serverless-first',
  },
  {
    row: 'Stacks (as compositions)',
    cellText: 'Phoenix LiveView',
    kind: 'stack',
    id: 'phoenix-liveview',
  },
];

function findSpecFile(): string {
  const specsDir = path.join(repoRoot, 'specs');
  const match = readdirSync(specsDir).find((name) => name.startsWith('12-'));
  if (match === undefined) throw new Error('specs/12-*.md not found');
  return path.join(specsDir, match);
}

describe("C2 completeness against 12 §12.2's own scope table", () => {
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

  it.each(['language', 'framework', 'frontend', 'mobile', 'stack'] as const)(
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
