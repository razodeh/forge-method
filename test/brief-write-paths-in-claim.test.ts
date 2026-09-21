/**
 * A step's brief may only tell its agent to write where the step's claim lets it write
 * (`PLAN-M13.md` P16; `SPEC-QUESTIONS.md` Q212, Q216; `06` §6.4, §6.7).
 *
 * After P14 an `agent` step that declares `outputs` has claim = `produces` UNION the `18` §18.7 registry
 * globs of those outputs, enforced `strict` at every autonomy level: whatever a session writes outside the
 * claim is reverted. Most steps declare no `produces`, and many briefs tell the agent to write a further
 * document (`docs/forge/kb/glossary.md`, `docs/forge/plans/stages.md`, ...) that is neither. Nothing failed:
 * the register entry satisfied the output check, the extra document was silently discarded. This test makes
 * the two halves agree. For EVERY shipped `agent` step (`WORKFLOW_INDEX` plus every
 * `modules/*\/workflows/*.workflow.yaml`, enumerated rather than named, compiled against the same fixture
 * context `agent-prompts-all-workflows.test.ts` uses so per-story `produces` templates resolve) it takes
 * the brief the run loads (`resolveContentReference`, the loader's own header stripping), extracts every
 * file path the brief instructs the agent to write, and asserts each one matches the step's claim, computed
 * by `resolveStepClaim` (P14's own derivation, not a copy) and matched with `minimatch` `{ dot: true }`,
 * the matcher `@forge/vcs`'s `enforceClaim` applies, so this test agrees with what enforcement will do.
 *
 * **The extractor** (`extractWritePaths`) is deliberately conservative and documented, because a false
 * positive costs an exemption and a false negative costs a silently discarded file:
 *
 * 1. Only BACKTICKED tokens are candidates; prose is never parsed for paths.
 * 2. A token is a path when it names a known root (`docs/`, `.forge/`, `kb/`, `specs/`, `plans/`,
 *    `reports/`, `sessions/`, a KB section such as `architecture/`, or a project directory such as `src/`,
 *    `test/`, `.github/`), or contains `/` and ends in a known file extension. `and/or`, `blue/green`,
 *    `Given/When/Then` are not paths. A bare file name (`problem.md`) is a path only inside a list item
 *    that names a KB section (`` `product/` ``) before it. `<placeholder>` / `{placeholder}` segments are
 *    filled from the fixture context (`<interfaceName>` becomes `orders-api`) else `x`; a `*` or `**`
 *    becomes `x`; a trailing `/` (a directory) is probed with a child file.
 * 3. KB paths resolve against the configured docs roots exactly as `outputGlob` does (`docRootsOf`):
 *    `docs/forge/kb/...` and the short forms `kb/...`, `architecture/...` (a KB section) are the same place.
 * 4. A token is a WRITE reference when its section is a producing one (`### Produce`, `### What to
 *    produce`, `### What to do`) and no read verb sits between the sentence start and the token, or when the
 *    last verb before the token in its sentence is a write verb (write, create, record, append, update,
 *    produce, save, register, add, draw, generate, store, extend, put), or when nothing precedes it and a
 *    passive write verb follows ("an `OpenQuestion` entry is created"). Only `Inputs` and `Do not` sections
 *    never yield writes (`Acceptance` sections do: a brief may state a duty only there). A path after a read
 *    verb (read, from, consult, see, cite, inspect, load, scan, survey) is a read. A negation ("do not",
 *    "never", "must not", "without") in the token's own clause (since the last `:` or `;`) makes it a
 *    prohibition, not a write.
 *
 * Known false positives live in `EXEMPT` (each tied to the sentence it excuses), and writes the extractor cannot
 * see (a path only inside a command, a file "beside" a named one, an edit to another artifact) are declared
 * in `IMPLIED_WRITES`, each with an anchor sentence that must still be in the brief. Both lists fail the test
 * when stale, so they cannot outlive their evidence.
 *
 * **What this does not cover** (each is recorded in `SPEC-QUESTIONS.md` Q216):
 * - A step with no `outputs` and no `produces` has no claim to compare a brief with (`KNOWN_EMPTY_CLAIM`).
 * - The `produces` globs are literal `docs/forge/...` paths, so the comparison holds for the default docs
 *   layout only; the registry-derived half of the claim follows a relocated `paths.kb` and these do not.
 * - Agent prompt specialisations (`prompts/<agent>.<brief>.md`) are not scanned, only the brief.
 * - A path the brief leaves to the agent (a component's KB entry, the app's release configuration) is
 *   represented by a chosen path or a hand-declared glob, so the test cannot say the glob is complete.
 * - The matcher is `minimatch` `{ dot: true }` as `enforceClaim` calls it; no real revert is exercised here.
 * - The extractor has a fixed verb list and is blind to a write duty stated inside a `### Do not` bullet
 *   ("... or state an assumption with `validate_by`": `model-data`, pinned in `IMPLIED_WRITES`), to un-backticked
 *   paths, to "except `X`" (an allowance reads as a prohibition), and to a negation whose verb list is
 *   comma-separated ("Do not write, update or record `X`" reads as a write). Steps with no brief
 *   (`build-stage:review`, `implement-story:review`) are scanned with empty text.
 * - No `produces` entry is checked for being needed: an unnecessary glob only widens a claim (a mutation run
 *   shows the mobile globs, the non-YAML contract notations and `delivery/views` are unpinned).
 *
 * @see specs/06 §6.4, §6.7
 * @see specs/10 §10.1
 * @see PLAN-M13.md P16
 */
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { ProjectPaths } from '@forge/core';
import {
  PROTECTED_CLAIM_EXCLUSION,
  docRootsOf,
  outputClaimGlobs,
  outputGlob,
  resolveStepClaim,
} from '@forge/engine/dispatch';
import type { DocRoots } from '@forge/engine/dispatch';
import { compileRunPlan } from '@forge/engine/plan';
import type { StepNode } from '@forge/engine/plan';
import { parseWorkflow, type Workflow, type WorkflowStep } from '@forge/engine/workflow';
import { KB_SECTIONS } from '@forge/kb/schema';
import { artifactTypeById } from '@forge/schemas/registry';
import { DEFAULT_CONFIG } from '@forge/schemas/config';
import { BRIEF_INDEX, WORKFLOW_INDEX } from '@forge/templates';

import { resolveContentReference } from '../packages/agents/src/prompt/index.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modulesDir = path.join(repoRoot, 'modules');
const templatesRoot = path.join(repoRoot, 'packages', 'templates');

/**
 * `minimatch` exactly as `@forge/vcs` resolves it (the package `enforceClaim` matches a claim with; the
 * repository root does not depend on it, so it is loaded through the vcs package's own resolution).
 */
const { minimatch } = createRequire(path.join(repoRoot, 'packages', 'vcs', 'package.json'))(
  'minimatch',
) as { minimatch: (file: string, glob: string, options: { dot: boolean }) => boolean };

/** The same fixture every shipped workflow compiles against in `agent-prompts-all-workflows.test.ts`. */
const FIXTURE_CONTEXT = {
  stage: {
    stories: [
      {
        id: 'story-1',
        owner_role: 'backend',
        test_paths: 'test/story-1.test.ts',
        files_expected: 'src/story-1.ts',
      },
    ],
  },
  run: {
    findings: [{ id: 'defect-1' }],
    testPaths: 'test/story-1.test.ts',
    filesExpected: 'src/story-1.ts',
  },
  vars: { integration_branch: 'forge/integration/stage-1' },
  stageId: 'stage-1',
  storyId: 'story-1',
  ownerRole: 'backend',
  defectId: 'defect-1',
  migrationGoal: 'expand the users table',
  changeSummary: 'add a new field',
  goal: 'extract a shared helper',
  interfaceName: 'orders-api',
  buildTarget: 'ios',
} as const;

/** The docs roots claim derivation resolves against (`docRootsOf` with no configured override = defaults). */
const ROOTS: DocRoots = docRootsOf({});
const PLANS_ROOT = DEFAULT_CONFIG.paths.plans;

// ---------------------------------------------------------------------------------------------------
// The extractor
// ---------------------------------------------------------------------------------------------------

/** Directories at the top of the docs tree or the project a backticked token may open with. */
const PROJECT_DIRS: readonly string[] = [
  'docs',
  '.forge',
  '.github',
  'ci',
  'src',
  'test',
  'tests',
  'scripts',
  'config',
  'packages',
  'app',
  'lib',
];
/** KB sections a `kb`-relative path may open with: `08` §8.2's, plus the two module-owned ones the briefs use. */
const KB_SECTION_NAMES: readonly string[] = [...KB_SECTIONS, 'mobile', 'security'];
const DOC_ROOT_SHORTS: readonly string[] = ['kb', 'specs', 'plans', 'reports', 'sessions'];
const FILE_EXTENSIONS = /\.(md|yaml|yml|mmd|json|proto|graphql|ts|tsx|js|toml|sh)$/i;

const WRITE_VERB =
  /\b(writ(?:e|es|ing|ten)|creat(?:e|es|ing|ed)|record(?:s|ed|ing)?|append(?:s|ed|ing)?|updat(?:e|es|ing|ed)|produc(?:e|es|ing|ed)|sav(?:e|es|ing|ed)|register(?:s|ed|ing)?|add(?:s|ed|ing)?|draw(?:s|n|ing)?|emit(?:s)?|generat(?:e|es|ing|ed)|stor(?:e|es|ed|ing)|extend(?:s|ed|ing)?|put|persist(?:s|ed)?|captur(?:e|es|ed|ing)|revis(?:e|es|ed|ing)|edit(?:s|ed|ing)?|bump(?:s|ed|ing)?|overwrit(?:e|es|ing)|modif(?:y|ies|ied|ying)|chang(?:e|es|ed|ing)|renam(?:e|es|ed|ing)|remov(?:e|es|ed|ing)|delet(?:e|es|ed|ing))\b/gi;
/** A negation turns the write verb it governs into a prohibition ("Do not write ..."). */
const NEGATION = /\b(?:do not|don't|never|must not|may not|should not|without)\b/i;
/** Where a negation stops governing: a clause boundary between it and the write verb ("Do not overwrite
 * the glossary, but add ..."; "must not disappear: record it as ..."). */
const CLAUSE_BOUNDARY = /[,:;]|\b(?:but|then|instead|so)\b/gi;
/** A read verb followed by a destination preposition still ends in a write ("record the findings from the
 * survey in `kb/risks.md`"). */
const DESTINATION = /\b(?:in|into|to|under|at|inside)\b/i;
/** A duty to keep a register entry, stated in prose without a backticked type ("record an open question
 * instead of inventing ..."): the register it means. Only a write verb triggers it; "X is an open question"
 * is a classification, and the briefs that use it are pinned in `IMPLIED_WRITES` where they mean a record. */
const PROSE_REGISTER = /\b(?:record|capture|log)\b[^.;:]*?\b(open questions?|assumptions?)\b/gi;
/** "... an `OpenQuestion` entry is created": the verb follows the token. */
const PASSIVE_WRITE =
  /^[^.]*?\b(?:is|are|be|been)\s+(?:\w+\s+)?(?:created|recorded|written|added|registered|saved|appended|updated|produced)\b/i;
const READ_VERB =
  /\b(read(?:s|ing)?|from|consult(?:s|ing)?|see|cite[sd]?|inspect(?:s|ing)?|load(?:s|ed|ing)?|scan(?:s|ned|ning)?|survey(?:s|ed)?)\b/gi;

type SectionKind = 'write' | 'read' | 'neutral';

/** What a `###` heading means for the items under it (see the module comment, point 4). */
function sectionKind(heading: string): SectionKind {
  const text = heading.toLowerCase();
  if (/^(produce|what to produce|what to do)/.test(text)) return 'write';
  if (/^(inputs?|do not)/.test(text)) return 'read';
  return 'neutral';
}

interface RawItem {
  readonly section: SectionKind;
  readonly text: string;
}

/** The brief split into list items and paragraphs, each tagged with its section's kind. */
function itemsOf(brief: string): readonly RawItem[] {
  const items: RawItem[] = [];
  let section: SectionKind = 'neutral';
  let current: string[] = [];
  const flush = (): void => {
    if (current.length > 0) items.push({ section, text: current.join(' ') });
    current = [];
  };
  for (const line of brief.split('\n')) {
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading !== null) {
      flush();
      section = sectionKind(heading[1] ?? '');
    } else if (line.trim() === '') {
      flush();
    } else if (/^\s*(?:[-*]|\d+\.)\s+/.test(line)) {
      flush();
      current.push(line.trim());
    } else {
      current.push(line.trim());
    }
  }
  flush();
  return items;
}

/** A placeholder's fixture value, else `x`. */
function fill(name: string): string {
  const value = (FIXTURE_CONTEXT as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : 'x';
}

/** Whether `token` (already unwrapped from its backticks) names a file or directory, and how to read it. */
function looksLikePath(token: string, hasSectionContext: boolean): boolean {
  if (/\s/.test(token) || token.includes('://') || token === '') return false;
  if (!/^[\w.<>{}*/@-]+$/.test(token)) return false;
  const first = token.split('/')[0] ?? '';
  if (token.includes('/')) {
    if (
      PROJECT_DIRS.includes(first) ||
      DOC_ROOT_SHORTS.includes(first) ||
      KB_SECTION_NAMES.includes(first)
    ) {
      return true;
    }
    return FILE_EXTENSIONS.test(token);
  }
  return hasSectionContext && FILE_EXTENSIONS.test(token);
}

/** Resolves a brief's spelling to the repo-relative path (or a directory prefix ending `/`) it means. */
function resolvePath(raw: string, sectionContext: string | undefined, roots: DocRoots): string {
  let p = raw
    .replace(/<([\w-]+)>|\{(\w+)\}/g, (_match, a: string | undefined, b: string | undefined) =>
      fill(a ?? b ?? ''),
    )
    .replace(/^\.\//, '');
  const isDir = p.endsWith('/');
  const bare = !p.includes('/');
  if (bare && sectionContext !== undefined) p = `${sectionContext}/${p}`;
  const first = p.split('/')[0] ?? '';
  const rest = p.split('/').slice(1).join('/');
  const docs = DEFAULT_CONFIG.paths;
  const prefixes: readonly [string, string][] = [
    [docs.kb, roots.kb],
    [docs.specs, roots.specs],
    [PLANS_ROOT, PLANS_ROOT],
    [docs.sessions, roots.sessions],
    [docs.reports, roots.reports],
  ];
  const hit = prefixes.find(([from]) => p === from || p.startsWith(`${from}/`));
  if (hit !== undefined) {
    p = `${hit[1]}${p.slice(hit[0].length)}`;
  } else if (first === 'kb') p = `${roots.kb}/${rest}`;
  else if (first === 'specs') p = `${roots.specs}/${rest}`;
  else if (first === 'plans') p = `${PLANS_ROOT}/${rest}`;
  else if (first === 'reports') p = `${roots.reports}/${rest}`;
  else if (first === 'sessions') p = `${roots.sessions}/${rest}`;
  else if (KB_SECTION_NAMES.includes(first)) p = `${roots.kb}/${p}`;
  // A directory is probed with a child file, a glob with a concrete member.
  if (isDir && !p.endsWith('/')) p += '/';
  if (p.endsWith('/')) p += 'x';
  return p
    .replace(/\*\*\/?/g, 'x/')
    .replace(/\/x\/$/, '/x')
    .replace(/\*/g, 'x');
}

/** Whether the token that follows `before` in its sentence is being written (see the module comment). */
function isWriteContext(
  before: string,
  after: string,
  section: SectionKind,
  lastWrite: number,
  lastRead: number,
): boolean {
  if (lastWrite >= 0) {
    // The negation that matters is one in the same clause as the write verb, not one an earlier clause left behind.
    const head = before.slice(0, lastWrite);
    let start = 0;
    for (const boundary of head.matchAll(CLAUSE_BOUNDARY))
      start = boundary.index + boundary[0].length;
    if (NEGATION.test(head.slice(start))) return false;
    if (lastWrite > lastRead) return true;
    return DESTINATION.test(before.slice(lastRead));
  }
  const clause = before.slice(Math.max(before.lastIndexOf(':'), before.lastIndexOf(';')) + 1);
  if (NEGATION.test(clause)) return false;
  return lastRead < 0 && (section === 'write' || PASSIVE_WRITE.test(after));
}

export interface WriteReference {
  /** The spelling in the brief, backticks removed. */
  readonly raw: string;
  /** The concrete repo-relative path the claim must cover. */
  readonly resolved: string;
  /** The sentence that made it a write reference (for a failure message). */
  readonly sentence: string;
}

/** Every path `brief` instructs its agent to write (see the module comment for the rules). */
export function extractWritePaths(
  brief: string,
  roots: DocRoots = ROOTS,
): readonly WriteReference[] {
  const found = new Map<string, WriteReference>();
  const keep = (ref: WriteReference): void => {
    const key = `${ref.resolved}|${ref.sentence}`;
    if (!found.has(key)) found.set(key, ref);
  };
  for (const item of itemsOf(brief)) {
    if (item.section === 'read') continue;
    // Mask backticked spans so their dots and colons do not split sentences or read as verbs, and drop the
    // dots of `e.g.` / `i.e.` for the same reason.
    const spans: string[] = [];
    const masked = item.text
      .replace(/\b(e\.g|i\.e)\./gi, (m) => m.replace(/\./g, ''))
      .replace(/`([^`]*)`/g, (_m, inner: string) => {
        spans.push(inner);
        return `%%TOK${String(spans.length - 1)}%%`;
      });
    // The KB section a bare file name resolves against: the last `section/` token seen so far.
    let sectionContext: string | undefined;
    for (const sentence of masked.split(/(?<=[.;])\s+/)) {
      const tokens = [...sentence.matchAll(/%%TOK(\d+)%%/g)];
      for (const match of tokens) {
        const raw = spans[Number(match[1])] ?? '';
        const before = sentence.slice(0, match.index);
        if (/^[a-z]+\/$/.test(raw) && KB_SECTION_NAMES.includes(raw.slice(0, -1))) {
          sectionContext = raw.slice(0, -1);
        }
        // A bare KB section (`product/`) only sets the context bare file names in this item resolve against.
        if (/^[a-z]+\/$/.test(raw) && KB_SECTION_NAMES.includes(raw.slice(0, -1))) continue;
        const typed = artifactTypeById(raw);
        if (typed === undefined && !looksLikePath(raw, sectionContext !== undefined)) continue;
        const lastWrite = lastIndex(before, WRITE_VERB);
        const lastRead = lastIndex(before, READ_VERB);
        const after = sentence.slice(match.index + match[0].length);
        const isWrite = isWriteContext(before, after, item.section, lastWrite, lastRead);
        if (!isWrite) continue;
        let resolved: string;
        if (typed !== undefined) {
          // A backticked artifact type (`Risk`, `ADR`) written in this sentence: its registry location.
          // `Diagram` lives at `<any section>/views/...`, which no single probe path can stand for; the
          // `.mmd` path the same item names is what is checked.
          const glob = outputGlob(typed.id, roots).replace(/\\/g, '');
          if (glob.slice(0, glob.lastIndexOf('/')).includes('*')) continue;
          resolved = glob.replace(/\*/g, 'x');
        } else {
          resolved = resolvePath(raw, sectionContext, roots);
        }
        keep({
          raw,
          resolved,
          sentence: sentence.replace(
            /%%TOK(\d+)%%/g,
            (_m, n: string) => `\`${spans[Number(n)] ?? ''}\``,
          ),
        });
      }
      // A register duty stated in prose, with no backticked type.
      for (const duty of sentence.matchAll(PROSE_REGISTER)) {
        const phrase = (duty[1] ?? '').toLowerCase();
        const before = sentence.slice(0, duty.index);
        const head = before.slice(Math.max(before.lastIndexOf(':'), before.lastIndexOf(';')) + 1);
        if (NEGATION.test(head)) continue;
        const type = phrase.startsWith('open') ? 'OpenQuestion' : 'Assumption';
        keep({
          raw: `${phrase} (prose)`,
          resolved: outputGlob(type, roots).replace(/\\/g, ''),
          sentence: sentence.replace(
            /%%TOK(\d+)%%/g,
            (_m, n: string) => `\`${spans[Number(n)] ?? ''}\``,
          ),
        });
      }
    }
  }
  return [...found.values()];
}

function lastIndex(text: string, pattern: RegExp): number {
  let index = -1;
  for (const match of text.matchAll(pattern)) index = match.index;
  return index;
}

// ---------------------------------------------------------------------------------------------------
// The shipped steps
// ---------------------------------------------------------------------------------------------------

/** What the claim derivation and the brief loader need of a step: a compiled node, or a hook step. */
type StepShape = Pick<StepNode, 'kind' | 'outputs' | 'produces' | 'brief'>;

interface ShippedStep {
  /** `<origin>:<stepId>`: origin is the workflow id, or `<module>/<file>` for a module workflow. A step of
   * `onComplete` / `onFailure.escalations` is `<origin>:onComplete[0]` / `<origin>:onFailure[0]`. */
  readonly key: string;
  readonly node: StepShape;
}

interface LoadedWorkflow {
  readonly origin: string;
  readonly workflow: Workflow;
  /** The file's own text: the count of `kind: agent` is taken from it, independently of the parser. */
  readonly source: string;
}

function loadWorkflows(): readonly LoadedWorkflow[] {
  const loaded: LoadedWorkflow[] = [];
  const parse = (file: string, origin: string): void => {
    const source = readFileSync(file, 'utf8');
    const parsed = parseWorkflow(source);
    if (!parsed.success)
      throw new Error(`${origin} does not parse: ${JSON.stringify(parsed.issues)}`);
    loaded.push({ origin, workflow: parsed.workflow, source });
  };
  for (const [id, relative] of Object.entries(WORKFLOW_INDEX)) {
    parse(path.join(templatesRoot, relative), id);
  }
  for (const moduleName of readdirSync(modulesDir).sort()) {
    const dir = path.join(modulesDir, moduleName, 'workflows');
    let files: string[];
    try {
      files = readdirSync(dir).filter((file) => file.endsWith('.workflow.yaml'));
    } catch {
      continue;
    }
    for (const file of files.sort()) parse(path.join(dir, file), `${moduleName}/${file}`);
  }
  return loaded;
}

const workflows = loadWorkflows();

/** The agent steps a workflow declares outside `steps:`: `onComplete`, and the `do` of each failure
 * escalation. The compiler leaves both out of the plan (`compilePlan`'s doc comment), so nothing runs them
 * yet, but the first run that wires them would dispatch these briefs with their declared claim. */
function hookAgentSteps(workflow: Workflow): readonly { name: string; step: WorkflowStep }[] {
  const found: { name: string; step: WorkflowStep }[] = [];
  (workflow.onComplete ?? []).forEach((step, index) => {
    if (step.kind === 'agent') found.push({ name: `onComplete[${String(index)}]`, step });
  });
  (workflow.onFailure?.escalations ?? []).forEach((escalation, index) => {
    const step = escalation.do;
    if (step.kind === 'agent') found.push({ name: `onFailure[${String(index)}]`, step });
  });
  return found;
}

/**
 * Independent of the parser and of compilation: the number of `kind: agent` occurrences in the workflow
 * files' own text (comments removed), which counts every agent step wherever it sits: `steps:`, a fanout's
 * template, `onComplete`, an escalation's `do`.
 */
function agentKindsInText(source: string): number {
  const code = source
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .map((line) => line.replace(/\s#.*$/, ''))
    .join('\n');
  return (code.match(/\bkind:\s*agent\b/g) ?? []).length;
}
const AGENT_KINDS_IN_TEXT = workflows.reduce(
  (sum, { source }) => sum + agentKindsInText(source),
  0,
);

const steps: ShippedStep[] = [];
for (const { origin, workflow } of workflows) {
  const compiled = compileRunPlan(workflow, FIXTURE_CONTEXT);
  if (!compiled.success) {
    throw new Error(`${origin} fails to compile: ${JSON.stringify(compiled.issues)}`);
  }
  for (const node of compiled.nodes) {
    if (node.kind !== 'agent') continue;
    const rest = node.id.slice(workflow.id.length + 1).split(':')[0] ?? node.id;
    steps.push({ key: `${origin}:${rest}`, node });
  }
  for (const { name, step } of hookAgentSteps(workflow)) {
    const declared = step as {
      brief?: string;
      outputs?: readonly { type: string }[];
      produces?: string | readonly string[];
    };
    steps.push({
      key: `${origin}:${name}`,
      node: {
        kind: 'agent',
        brief: declared.brief,
        outputs: declared.outputs ?? [],
        produces:
          typeof declared.produces === 'string' ? [declared.produces] : (declared.produces ?? []),
      },
    });
  }
}

/** The brief text as the run loads it: through `resolveContentReference` over a materialised `.forge/briefs`. */
const briefRoot = mkdtempSync(path.join(tmpdir(), 'forge-p16-briefs-'));
afterAll(() => {
  rmSync(briefRoot, { recursive: true, force: true });
});
mkdirSync(path.join(briefRoot, '.forge', 'briefs'), { recursive: true });
for (const [key, relative] of Object.entries(BRIEF_INDEX)) {
  writeFileSync(
    path.join(briefRoot, '.forge', 'briefs', `${key}.md`),
    readFileSync(path.join(templatesRoot, relative), 'utf8'),
  );
}
const briefPaths = new ProjectPaths(briefRoot);

async function briefOf(node: Pick<StepNode, 'brief'>): Promise<string> {
  if (node.brief === undefined) return '';
  return resolveContentReference(briefPaths, node.brief);
}

/** `enforceClaim`'s own matcher (`packages/vcs/src/claims.ts`, `matchesAnyGlob`). */
function inClaim(
  file: string,
  globs: readonly string[],
  excluded: readonly string[] = [],
): boolean {
  return (
    globs.some((glob) => minimatch(file, glob, { dot: true })) &&
    !excluded.some((glob) => minimatch(file, glob, { dot: true }))
  );
}

/**
 * Whether the claim covers what a brief names. A path ending `/x` stands for "a file in this directory"
 * (the extractor's probe for a directory or a glob member): the claim covers it when it covers a typical
 * member, an extensionless file, a `.md`, a `.yaml` or a `.mmd`. A claim of one exact file does not.
 */
function claimCovers(
  file: string,
  globs: readonly string[],
  excluded: readonly string[] = [],
): boolean {
  if (!file.endsWith('/x')) return inClaim(file, globs, excluded);
  return ['', '.md', '.yaml', '.mmd'].some((extension) =>
    inClaim(`${file}${extension}`, globs, excluded),
  );
}

// ---------------------------------------------------------------------------------------------------
// Exemptions and allowances
// ---------------------------------------------------------------------------------------------------

/**
 * Brief-named paths the agent is NOT told to write, though the extractor reads them as writes. An entry
 * applies only to the `sentence` it names (a pattern the brief's sentence must match), so a later, real
 * write to the same path elsewhere in the brief is not silently exempted. An entry that matches no
 * extracted reference, or whose path the claim already covers, fails the test.
 */
const EXEMPT: readonly {
  readonly step: string;
  readonly path: string;
  readonly sentence: RegExp;
  readonly why: string;
}[] = [
  {
    step: 'initialize-project:scaffold-ci',
    path: 'docs/forge/reports/test-results.json',
    sentence: /Test\s+results\s+go\s+to\s+`docs\/forge\/reports\/test-results\.json`/,
    why: 'what the CI configuration the step writes will do at run time (the pipeline writes the results file); the agent never writes it',
  },
  {
    step: 'initialize-project:scaffold-ci',
    path: 'docs/forge/reports/x',
    sentence:
      /write\s+lint\s+and\s+coverage\s+results\s+elsewhere\s+under\s+`docs\/forge\/reports\/`/,
    why: 'the same: it instructs the pipeline configuration, not the agent',
  },
  {
    step: 'deliver-stage:design-pipeline',
    path: 'docs/forge/reports/x',
    sentence:
      /Every\s+stage\s+writes\s+machine-readable\s+results\s+under\s+`docs\/forge\/reports\/`/,
    why: 'an acceptance criterion on the designed pipeline ("every stage writes results"), stating what the ADR must say; the ADR does not write reports',
  },
  {
    step: 'initialize-project:scaffold-ci',
    path: 'docs/forge/reports/deployments/x.json',
    sentence: /A\s+record\s+of\s+that\s+deployment/,
    why: '"the deploy job writes" the record: it is what the CI configuration the step writes will do at run time, not a file the agent writes (the brief says a hand-written record is never the way through)',
  },
  {
    step: 'initialize-project:scaffold-ci',
    path: 'docs/forge/kb/delivery/environments.md',
    sentence: /A\s+record\s+of\s+that\s+deployment/,
    why: 'the sentence only names the development `Environment` entry whose id the record carries; the entry is written by scaffold-project',
  },
  {
    step: 'retro:run-retro',
    path: 'docs/forge/kb/delivery/sequencing/x',
    sentence: /your\s+role\s+may\s+write\s+only\s+`delivery\/sequencing\/\*\*`/,
    why: 'a statement of what the role is allowed to write, inside the KB write-back that is otherwise proposals; the brief never tells the agent to write there, so the claim is not widened for it',
  },
  {
    step: 'build-stage:onComplete[0]',
    path: 'docs/forge/kb/engineering/ways-of-working.md',
    sentence:
      /KB\s+write-back\s+lists\s+what\s+should\s+change\s+in\s+`engineering\/ways-of-working\.md`/,
    why: '"write-back" is a section name; the retro lists changes to the KB page as proposals and states them as such',
  },
  {
    step: 'build-stage:onComplete[0]',
    path: 'docs/forge/kb/risks.md',
    sentence:
      /Record\s+the\s+risks\s+you\s+saw\s+that\s+were\s+never\s+owned,\s+as\s+proposed\s+`Risk`\s+entries/,
    why: '"proposed" Risk entries are proposals in the retro record (the same brief states its KB write-back as proposals); no lane writes the register',
  },
  {
    step: 'shape-solution:select-stack',
    path: 'docs/forge/kb/data/migrations.md',
    sentence: /recorded\s+against\s+the\s+strategy\s+in\s+`data\/migrations\.md`/,
    why: 'a cross-reference; model-data writes that file, this step names the tool it points at',
  },
  {
    step: 'implement-story:document',
    path: 'docs/forge/kb/engineering/standards.md',
    sentence: /becomes\s+a\s+KB\s+proposal\s+for\s+`engineering\/standards\.md`/,
    why: 'a decision "becomes a KB proposal": proposals go through the KB channel and the supervisor applies them (06 section 6.4), the lane never writes it',
  },
  {
    step: 'harden:security-pass',
    path: 'docs/forge/kb/constraints/x',
    sentence: /follow\s+any\s+severity\s+policy\s+in\s+the\s+KB's\s+`constraints\/\*\*`/,
    why: 'the constraints directory is read for a severity policy',
  },
  {
    step: 'harden:performance-pass',
    path: 'docs/forge/kb/constraints/x',
    sentence: /follow\s+any\s+severity\s+policy\s+in\s+the\s+KB's\s+`constraints\/\*\*`/,
    why: 'the constraints directory is read for a severity policy',
  },
  {
    step: 'fm-mobile/store-release.workflow.yaml:prepare-release-build',
    path: 'docs/forge/kb/mobile/device-matrix.md',
    sentence:
      /the\s+device\s+rows\s+still\s+to\s+be\s+run\s+for\s+`docs\/forge\/kb\/mobile\/device-matrix\.md`/,
    why: 'the Task record only lists the rows a person must add there; the same brief says "Do not write results into device-matrix.md"',
  },
];

/**
 * Writes the extractor cannot see, declared by hand from reading the brief, so the claim is still checked
 * against them. Every entry names a sentence of the brief (`anchor`) that must still be present: a
 * reworded brief makes the entry stale and fails the test, so this list cannot outlive its evidence.
 * Two shapes recur: a path only inside a command token (`pnpm test -- <file>`, which is not a path token)
 * and a file "beside" one the brief does name.
 */
const IMPLIED_WRITES: readonly {
  readonly step: string;
  readonly path: string;
  readonly anchor: RegExp;
  readonly why: string;
}[] = [
  {
    step: 'fm-mobile/store-release.workflow.yaml:prepare-release-build',
    path: 'test/device-matrix/ios.test.ts',
    anchor: /If\s+that\s+file\s+does\s+not\s+exist,\s+create\s+it/,
    why: 'the suite file is named only inside the command `pnpm test -- test/device-matrix/<buildTarget>.test.ts`',
  },
  {
    step: 'fm-service/contract-test-cycle.workflow.yaml:draft-contract',
    path: 'docs/forge/specs/interfaces/orders-api.proto',
    anchor: /put\s+that\s+source\s+beside\s+it\s+in\s+its\s+own\s+notation/,
    why: 'a non-YAML notation (protobuf, GraphQL SDL, TypeScript types) sits beside the named YAML file',
  },
  {
    step: 'build-stage:freeze-contracts',
    path: 'docs/forge/specs/interfaces/orders-api.proto',
    anchor: /put\s+that\s+source\s+beside\s+it\s+in\s+its\s+own\s+notation/,
    why: 'a non-YAML notation sits beside the YAML record in the same directory',
  },
  {
    step: 'plan-stages:decompose-stages',
    path: 'docs/forge/specs/capabilities/CAP-x.md',
    anchor: /Update\s+each\s+non-`wont`\s+capability's\s+`stage`\s+field/,
    why: 'the step edits each Capability (its `stage`, `revision`, `changelog`); the item names no path',
  },
  {
    step: 'initialize-project:scaffold-ci',
    path: 'docs/forge/kb/delivery/pipeline.md',
    anchor: /`delivery\/pipeline\.md`\s+in\s+the\s+KB\s+\(a\s+KB\s+entry\)\s+lists\s+the\s+stages/,
    why: 'an acceptance criterion states the KB entry the step must leave ("lists the stages"); no write verb governs the path',
  },
  {
    step: 'shape-solution:model-data',
    path: 'docs/forge/kb/domain/views/state-x.mmd',
    anchor: /a\s+`stateDiagram-v2`\s+for\s+every\s+entity/,
    why: 'state diagrams are asked for with no path; 08 section 8.11.3 puts them at `domain/views/state-<entity>.mmd`',
  },
  {
    step: 'shape-solution:model-data',
    path: 'docs/forge/kb/assumptions.md',
    anchor: /state\s+an\s+assumption\s+with\s+`validate_by`/,
    why: 'volumes and growth rates the inputs lack are stated as an Assumption (`validate_by` is its field); the sentence sits in a `Do not` bullet the extractor skips',
  },
  {
    step: 'migrate:plan-migration',
    path: 'docs/forge/kb/open-questions.md',
    anchor: /are\s+open\s+questions\s+or\s+explicit\s+assumptions/,
    why: 'unknowns are recorded as open questions; the prose names no register file',
  },
  {
    step: 'adopt:reverse-derive-specs',
    path: 'docs/forge/kb/open-questions.md',
    anchor: /explicit\s+open\s+question\s+or\s+a\s+`FORGE_ASSUME:`/,
    why: 'anything the step cannot evidence is an explicit open question; the prose names no register file',
  },
  {
    step: 'migrate:plan-migration',
    path: 'docs/forge/kb/assumptions.md',
    anchor: /explicit\s+assumptions\s+with\s+a\s+validation\s+method/,
    why: 'unknowns are recorded as explicit assumptions; the prose names no register file',
  },
  {
    step: 'plan-stage:write-epics',
    path: 'docs/forge/specs/capabilities/CAP-x.md',
    anchor: /add\s+each\s+new\s+epic's\s+id\s+to\s+its\s+capability's\s+`epics`\s+list/,
    why: 'the step edits the Capability records; the sentence names no path',
  },
  {
    step: 'plan-stage:write-stories',
    path: 'docs/forge/specs/epics/EPIC-x.md',
    anchor: /an\s+update\s+of\s+each\s+epic's\s+`stories`\s+list/,
    why: 'the step edits the Epic records; the sentence names no path',
  },
  {
    step: 'debug:run-rca',
    path: 'docs/forge/reports/defects/DEF-x.md',
    anchor: /record\s+the\s+outcome\s+in\s+the\s+Defect's\s+"Reproduction"\s+section/,
    why: 'the step edits the Defect record (its Reproduction section); no path is named',
  },
  {
    step: 'shape-solution:select-architecture',
    path: 'docs/forge/kb/architecture/component-x.md',
    anchor: /one\s+active\s+KB\s+entry,\s+a\s+file\s+under\s+`architecture\/`/,
    why: 'one KB entry per component, a file under architecture/ whose name the brief leaves to the agent (a representative path)',
  },
];

/**
 * `produces` entries allowed to be broad (`**`, `**\/*`, a docs-root prefix), each with why. Everything else
 * must name a directory below a docs section, or a project directory.
 */
const BROAD_PRODUCES_ALLOWED: Readonly<Record<string, string>> = {
  'initialize-project:scaffold-project|**/*':
    'the scaffold creates the whole repository skeleton (sources, manifests, configs, docs stubs); its claim is the project, by design (10 section 10.2 P4)',
  'fm-mobile/store-release.workflow.yaml:prepare-release-build|**/ios/**':
    'the brief names no app path and the native project may sit at any depth (a monorepo keeps it under apps/<name>/); the directory name is the anchor',
  'fm-mobile/store-release.workflow.yaml:prepare-release-build|**/android/**':
    'the same, for the Android project',
};

/**
 * Whether a `produces` glob claims a whole docs root or the whole project. An exact file names one path and
 * is never broad. A wildcard glob is broad when the directory it is anchored at (the segments before the
 * first wildcard segment) is the project, `docs`, `docs/forge`, `.forge`, or a configured docs root
 * itself (`docs/forge/kb`): `**`, `**\/*`, `docs/**`, `docs/forge/kb/*.md`.
 */
function isBroadProduces(glob: string): boolean {
  const docsRoots = [ROOTS.kb, ROOTS.specs, ROOTS.sessions, ROOTS.reports, PLANS_ROOT].map((root) =>
    root.replace(/^\.\//, ''),
  );
  const literal: string[] = [];
  for (const segment of glob.replace(/^\.\//, '').split('/').slice(0, -1)) {
    if (/[*?[\]{}!]/.test(segment)) break;
    literal.push(segment);
  }
  const prefix = literal.join('/');
  if (!/[*?[\]{}]/.test(glob)) return false;
  if (prefix === '') {
    // Anchored at the project root: broad when a directory segment is a wildcard (`**/*`, `*/x`) or the
    // file part is only a wildcard and an extension (`**`, `*.md`); `app.config.*` names one file family.
    const segments = glob.replace(/^\.\//, '').split('/');
    const last = segments[segments.length - 1] ?? '';
    return (
      segments.slice(0, -1).some((segment) => /[*?[\]{}!]/.test(segment)) ||
      /^\*+(\.\w+)?$/.test(last)
    );
  }
  return (
    prefix === 'docs' ||
    prefix === 'docs/forge' ||
    prefix === '.forge' ||
    docsRoots.includes(prefix)
  );
}

// ---------------------------------------------------------------------------------------------------
// The tests
// ---------------------------------------------------------------------------------------------------

/**
 * The number of shipped agent steps whose brief the extractor finds at least one write in, minus a little
 * slack. A regression that halves the extractor's recall drops below it.
 */
const WITH_WRITES_FLOOR = 36;

describe('the extractor (guards against a vacuously passing test)', () => {
  it('finds the paths a known brief tells its agent to write, and not the ones it reads', async () => {
    const step = steps.find((candidate) => candidate.key === 'plan-stages:decompose-stages');
    expect(step).toBeDefined();
    const paths = extractWritePaths(await briefOf(step!.node)).map((ref) => ref.resolved);
    expect(paths).toEqual(
      expect.arrayContaining(['docs/forge/plans/stages.md', 'docs/forge/plans/views/stages.mmd']),
    );
    // `constraints/**` is an input of that brief: read, never written.
    expect(paths.some((p) => p.includes('constraints'))).toBe(false);
  });

  it('reads verbs, sections and placeholders as documented', () => {
    const brief = [
      'Intro `docs/forge/kb/ignored.md`.',
      '',
      '### Inputs',
      '',
      '- Write `docs/forge/kb/input-section.md` (an Inputs section never yields a write).',
      '',
      '### Produce',
      '',
      '- The plan at `docs/forge/plans/a.md`, and read `docs/forge/plans/b.md` for context.',
      '- Update `kb/risks.md` and write `<interfaceName>.yaml` under `specs/interfaces/`.',
      '- Problem framing in the `product/` section: `problem.md`.',
      '- A diagram file under `docs/forge/kb/delivery/pipeline/`.',
      '- Do not treat `and/or` or `blue/green` as paths.',
      '',
      '### Do not',
      '',
      '- Do not write `docs/forge/kb/forbidden.md`.',
    ].join('\n');
    const resolved = extractWritePaths(brief).map((ref) => ref.resolved);
    expect(resolved).toContain('docs/forge/plans/a.md');
    expect(resolved).toContain('docs/forge/kb/risks.md');
    expect(resolved).toContain('docs/forge/kb/product/problem.md');
    expect(resolved).toContain('docs/forge/kb/delivery/pipeline/x');
    expect(resolved).not.toContain('docs/forge/plans/b.md');
    expect(resolved).not.toContain('docs/forge/kb/ignored.md');
    expect(resolved).not.toContain('docs/forge/kb/input-section.md');
    expect(resolved).not.toContain('docs/forge/kb/forbidden.md');
    expect(resolved.some((p) => p.includes('blue') || p.includes('and/or'))).toBe(false);
  });

  it('sees a duty stated in an Acceptance section, after a negation in another clause, or in the passive', () => {
    const brief = [
      '### Acceptance',
      '',
      '- A gap must not disappear: record it as an `OpenQuestion` with status open.',
      '- An `Assumption` entry is created for each inferred claim.',
      '- Do not record `docs/forge/kb/forbidden.md` here.',
      '- Never write `docs/forge/kb/never.md`, only `docs/forge/kb/never-either.md`.',
    ].join('\n');
    const resolved = extractWritePaths(brief).map((ref) => ref.resolved);
    expect(resolved).toContain('docs/forge/kb/open-questions.md');
    expect(resolved).toContain('docs/forge/kb/assumptions.md');
    expect(resolved).not.toContain('docs/forge/kb/forbidden.md');
    expect(resolved).not.toContain('docs/forge/kb/never.md');
  });

  it('keeps recall on the phrasings a first version dropped (corpus-derived negative controls)', () => {
    const cases: readonly (readonly [string, string])[] = [
      [
        'Do not overwrite the glossary, but add the terms to `docs/forge/kb/glossary.md`.',
        'docs/forge/kb/glossary.md',
      ],
      [
        'Only if it cannot be approved without its answer, recorded as an `OpenQuestion` in `kb/open-questions.md`.',
        'docs/forge/kb/open-questions.md',
      ],
      ['Record the findings from the survey in `kb/risks.md`.', 'docs/forge/kb/risks.md'],
      [
        'Write the summary from the inputs to `docs/forge/reports/summary.md`.',
        'docs/forge/reports/summary.md',
      ],
      ['Write a file (e.g. the plan) under `docs/forge/plans/z.md`.', 'docs/forge/plans/z.md'],
      [
        'Where you could not find one, record an open question instead of inventing one.',
        'docs/forge/kb/open-questions.md',
      ],
      [
        'Record what you assume as an assumption for the human to confirm.',
        'docs/forge/kb/assumptions.md',
      ],
      ['Revise `docs/forge/specs/vision.md` and bump its revision.', 'docs/forge/specs/vision.md'],
    ];
    for (const [text, expected] of cases) {
      const resolved = extractWritePaths(['### Method', '', text].join('\n')).map(
        (ref) => ref.resolved,
      );
      expect(resolved, text).toContain(expected);
    }
  });

  it('keeps a real write to a path after an earlier sentence that only mentions it', () => {
    const brief = [
      '### Produce',
      '',
      '- Test results go to `docs/forge/reports/test-results.json`, the file the pipeline writes.',
      '- Also write the summary to `docs/forge/reports/test-results.json` yourself.',
    ].join('\n');
    const refs = extractWritePaths(brief).filter(
      (ref) => ref.resolved === 'docs/forge/reports/test-results.json',
    );
    expect(refs.map((ref) => ref.sentence.includes('yourself'))).toContain(true);
    expect(refs.length).toBe(2);
  });

  it('resolves the docs roots as the claim derivation does (a relocated layout moves the path)', () => {
    const moved: DocRoots = { ...ROOTS, kb: 'knowledge', specs: 'spec' };
    const refs = extractWritePaths(
      ['### Produce', '', '- Write `docs/forge/kb/glossary.md` and `architecture/x.md`.'].join(
        '\n',
      ),
      moved,
    );
    expect(refs.map((ref) => ref.resolved)).toEqual([
      'knowledge/glossary.md',
      'knowledge/architecture/x.md',
    ]);
  });

  it('is proven against the real corpus: it scans every enumerated step and finds writes in most briefs', async () => {
    let withWrites = 0;
    for (const step of steps) {
      if (extractWritePaths(await briefOf(step.node)).length > 0) withWrites += 1;
    }
    // A vacuous extractor would find none; the shipped corpus has dozens of briefs that name a document (38
    // when the floor was set).
    expect(withWrites).toBeGreaterThanOrEqual(WITH_WRITES_FLOOR);
  });
});

describe('enumeration is real', () => {
  it('scans exactly the agent steps the workflow sources declare, hooks included', () => {
    // `steps` is built from the parser, the compiler and the hook walk; the other side is a count of
    // `kind: agent` in the raw text of the same files, which none of those touch.
    expect(AGENT_KINDS_IN_TEXT).toBeGreaterThan(50);
    expect(steps.length).toBe(AGENT_KINDS_IN_TEXT);
  });

  it('covers every workflow file on disk, core and module', () => {
    const onDisk = (dir: string): string[] =>
      readdirSync(dir)
        .filter((file) => file.endsWith('.workflow.yaml'))
        .sort();
    const core = onDisk(path.join(templatesRoot, 'templates', 'workflows'));
    expect(core).toEqual(
      Object.values(WORKFLOW_INDEX)
        .map((relative) => path.basename(relative))
        .sort(),
    );
    const modulesOnDisk = readdirSync(modulesDir)
      .sort()
      .flatMap((name) => {
        try {
          return onDisk(path.join(modulesDir, name, 'workflows')).map((file) => `${name}/${file}`);
        } catch {
          return [];
        }
      });
    expect(modulesOnDisk.length).toBeGreaterThan(0);
    expect(workflows.map(({ origin }) => origin).filter((origin) => origin.includes('/'))).toEqual(
      modulesOnDisk,
    );
  });

  it('includes the agent steps of onComplete and failure escalations (nothing runs them yet)', () => {
    expect(steps.some((step) => step.key === 'build-stage:onComplete[0]')).toBe(true);
    expect(steps.some((step) => step.key === 'build-stage:onFailure[0]')).toBe(true);
  });

  it('has a resolvable brief for every agent step that names one', async () => {
    for (const { key, node } of steps) {
      if (node.brief === undefined) continue;
      await expect(briefOf(node), key).resolves.not.toBe('');
    }
  });
});

describe('every path a brief tells the agent to write lies in the step claim', () => {
  it('holds for every shipped agent step', async () => {
    const problems: string[] = [];
    const seenExempt = new Set<(typeof EXEMPT)[number]>();
    for (const { key, node } of steps) {
      const { globs: claim, exclude } = resolveStepClaim(node, ROOTS, 'strict');
      const brief = await briefOf(node);
      const refs: { raw: string; resolved: string; sentence: string }[] = [
        ...extractWritePaths(brief),
      ];
      for (const implied of IMPLIED_WRITES.filter((entry) => entry.step === key)) {
        expect(brief, `stale IMPLIED_WRITES entry for ${key}: ${implied.why}`).toMatch(
          implied.anchor,
        );
        refs.push({ raw: implied.path, resolved: implied.path, sentence: implied.why });
      }
      // A Diagram is registered through a `<file>.mmd.yaml` sidecar, so writing the view means writing it too.
      for (const ref of [...refs]) {
        if (ref.resolved.endsWith('.mmd')) {
          refs.push({ ...ref, raw: `${ref.raw}.yaml`, resolved: `${ref.resolved}.yaml` });
        }
      }
      for (const ref of refs) {
        const covered = claimCovers(ref.resolved, claim, exclude);
        const exempt = EXEMPT.find(
          (entry) =>
            entry.step === key && entry.path === ref.resolved && entry.sentence.test(ref.sentence),
        );
        if (exempt !== undefined) {
          seenExempt.add(exempt);
          if (covered)
            problems.push(
              `${key}: exemption for ${ref.resolved} is unnecessary, the claim covers it`,
            );
          continue;
        }
        if (!covered) {
          problems.push(
            `${key}: the brief tells the agent to write \`${ref.raw}\` (${ref.resolved}), outside its claim [${claim.join(', ')}]. ` +
              `Sentence: "${ref.sentence.trim().slice(0, 140)}"`,
          );
        }
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
    for (const entry of EXEMPT) {
      expect(seenExempt.has(entry), `stale exemption: ${entry.step} | ${entry.path}`).toBe(true);
    }
    for (const implied of IMPLIED_WRITES) {
      expect(
        steps.some((step) => step.key === implied.step),
        `IMPLIED_WRITES names an unknown step: ${implied.step}`,
      ).toBe(true);
    }
  });

  it('pins the instances the P14 and P11 reviews named, so an extractor regression cannot hide them', async () => {
    const expected: Readonly<Record<string, readonly string[]>> = {
      'intake:seed-glossary': ['docs/forge/kb/glossary.md'],
      'discover:frame-problem': [
        'docs/forge/kb/product/problem.md',
        'docs/forge/kb/product/users.md',
        'docs/forge/kb/product/scope.md',
      ],
      'shape-solution:threat-model': [
        'docs/forge/kb/architecture/threat-model.md',
        'docs/forge/kb/architecture/views/threat-model.mmd',
      ],
      'plan-stages:decompose-stages': [
        'docs/forge/plans/stages.md',
        'docs/forge/plans/views/stages.mmd',
      ],
      'initialize-project:decide-repo-strategy': ['docs/forge/kb/delivery/repo-strategy.md'],
      'deliver-stage:design-pipeline': ['docs/forge/kb/delivery/pipeline/x'],
      'deliver-stage:design-deployment': ['docs/forge/kb/delivery/pipeline/x'],
      'fm-service/contract-test-cycle.workflow.yaml:draft-contract': [
        'docs/forge/specs/interfaces/orders-api.yaml',
      ],
      'define-product:write-ux-spec': ['docs/forge/kb/product/ux-spec.md'],
      'plan-stage:write-test-plan': ['docs/forge/specs/test-plan.md'],
    };
    for (const [key, paths] of Object.entries(expected)) {
      const step = steps.find((candidate) => candidate.key === key);
      expect(step, `no such step: ${key}`).toBeDefined();
      const found = extractWritePaths(await briefOf(step!.node)).map((ref) => ref.resolved);
      for (const wanted of paths) expect(found, `${key} should name ${wanted}`).toContain(wanted);
    }
  });
});

/**
 * Agent steps whose claim is EMPTY (no `outputs`, no `produces`). None is allowed any more (`PLAN-M13.md` P36,
 * `SPEC-QUESTIONS.md` Q216 and the P36 entry): an agent session's `write` grant is the agent's own AND a non-empty claim
 * (`assembleAgentSession`), so an empty-claim step cannot write at all, and the nine steps that legitimately write code, tests or
 * documents (`debug:fix`, `harden:fix-findings`, `implement-story:{document,refactor}`, `migrate:{expand,contract}`,
 * `quick-fix:{write-failing-test,fix}`, `refactor:refactor-code`) now declare a claim. An empty-claim step appearing here is a
 * step whose brief tells it to write nothing (a read-only critic), and would have to be added with a reason.
 */
const KNOWN_EMPTY_CLAIM: readonly string[] = [];

describe('steps with no claim at all', () => {
  it('are exactly the pinned set', () => {
    const empty = steps
      .filter(({ node }) => resolveStepClaim(node, ROOTS, 'strict').globs.length === 0)
      .map(({ key }) => key)
      .sort();
    expect(empty).toEqual([...KNOWN_EMPTY_CLAIM].sort());
  });
});

describe('claim hygiene', () => {
  it('reads a produces glob as broad or narrow as documented', () => {
    for (const broad of [
      '**',
      '**/*',
      '*',
      '*.md',
      'docs/**',
      'docs/forge/**',
      'docs/forge/kb/*.md',
      '.forge/**',
      'docs/forge/kb/*/x.md',
    ]) {
      expect(isBroadProduces(broad), broad).toBe(true);
    }
    for (const narrow of [
      'docs/forge/kb/glossary.md',
      'docs/forge/kb/product/*.md',
      'docs/forge/kb/decisions/ADR-*.md',
      'docs/forge/kb/delivery/pipeline/**',
      '.github/**',
      'ios/**',
      'app.config.*',
      'README.md',
    ]) {
      expect(isBroadProduces(narrow), narrow).toBe(false);
    }
  });

  it('every declared output of every step is inside its claim (P14 sanity)', () => {
    for (const { key, node } of steps) {
      if (node.outputs.length === 0) continue;
      const claim = resolveStepClaim(node, ROOTS, 'strict').globs;
      for (const output of node.outputs) {
        const definition = artifactTypeById(output.type);
        expect(definition, `${key}: unknown output type ${output.type}`).toBeDefined();
        const globs = outputClaimGlobs([output], ROOTS);
        expect(globs.length, `${key}: ${output.type} contributes no claim glob`).toBeGreaterThan(0);
        for (const glob of globs) expect(claim, `${key}: ${glob}`).toContain(glob);
      }
    }
  });

  it('no produces glob escapes the project or swallows a docs root', () => {
    const problems: string[] = [];
    for (const { key, node } of steps) {
      for (const glob of node.produces) {
        // `!<glob>` is an exclusion (`resolveStepClaim` moves it out of the claim globs, `06` §6.7); `#` is still a comment.
        if (glob === PROTECTED_CLAIM_EXCLUSION || glob.startsWith('!')) continue;
        if (glob.startsWith('#')) {
          problems.push(
            `${key}: produces "${glob}" starts with "#": the claim matcher reads it as a comment`,
          );
          continue;
        }
        if (glob.startsWith('/') || /^[A-Za-z]:/.test(glob) || glob.split('/').includes('..')) {
          problems.push(`${key}: produces "${glob}" leaves the project root`);
          continue;
        }
        if (BROAD_PRODUCES_ALLOWED[`${key}|${glob}`] !== undefined) continue;
        // A project-wide claim is fine when the step also excludes the protected set (`!@protected`, P36).
        if (node.produces.includes(PROTECTED_CLAIM_EXCLUSION)) continue;
        const broad = isBroadProduces(glob);
        if (broad) {
          problems.push(
            `${key}: produces "${glob}" is broader than one docs section or project directory; ` +
              `narrow it, or allow it in BROAD_PRODUCES_ALLOWED with a reason`,
          );
        }
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
    for (const entry of Object.keys(BROAD_PRODUCES_ALLOWED)) {
      const [key = '', glob = ''] = entry.split('|');
      expect(
        steps.some((step) => step.key === key && step.node.produces.includes(glob)),
        `stale allowance: ${entry}`,
      ).toBe(true);
    }
  });
});
