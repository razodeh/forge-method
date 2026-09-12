/**
 * `scanBundleForSafety` — `19` §19.5 step 4's own literal "skill and template bodies scanned for
 * injection-shaped content and grant-widening attempts," run as a real, blocking pre-install gate:
 * a bundle this function refuses is never written to `.forge/` at all, because it throws before any
 * caller reaches that step.
 *
 * Real gaps existed before this piece and are closed here, not merely documented (this piece's own
 * mandate explicitly authorizes fixing them, matching `PLAN-M11.md` P1/P9/P10's precedent):
 *
 * 1. **Templates (and prompts) were never scanned.** `@forge/extensions/skills`' own `validateSkill`
 *    (`PLAN-M2.md` P4) already applies `INJECTION_PATTERNS`/`SECRET_PATTERNS` to a `SKILL.md` body, and
 *    `@forge/extensions/invariants`' own `checkNoInjectionContent`/`checkNoSecretLiterals` (I9/I8,
 *    `PLAN-M2.md` P8) re-assert the same two pattern sets over the whole resolved compile set — but
 *    neither ever reads a `templates/**\/*.hbs` or `prompts/*.md` file (`19` §19.1's own module
 *    layout), and no third call site did either (confirmed against `compile/types.ts`'s own
 *    `DOCUMENT_KINDS`, which never lists `prompts` either). Both are exactly the kind of
 *    externally-supplied content I9's own paragraph is about — `19` §19.2 states plainly that "the
 *    same engine renders agent briefs and system prompts" from `prompts/*.md`, so an unscanned prompt
 *    file is at least as sensitive as an unscanned template, not a lesser case of it. Confirmed by
 *    reading `skills/validate.ts` and `invariants/security.ts` directly rather than trusting this
 *    plan's own characterization of the gap — and a first draft of this piece under-scoped the fix to
 *    templates only, which a critic round caught by reading `19` §19.1's own layout table in full.
 * 2. **The only enforcement point was `forge compile`, run on content already installed.** Both
 *    `validateSkill` and the I8/I9 invariants run over content already sitting inside `.forge/` —
 *    real checks, but never a *pre-install* gate. `19` §19.5's own step ordering puts the safety scan
 *    at step 4, strictly before step 5's install — this function is the first thing in this package
 *    that actually runs there, reusing (not re-deriving) the same two pattern sets so a skill body
 *    can never be judged safe by this gate and unsafe by `forge compile`'s own re-check, or the
 *    reverse.
 *
 * Grant-widening detection is scoped to **module** bundles only, not overlays: `moduleSchema`'s own
 * `ceilings` field (`19` §19.1, already real and committed) is the only declared-capability schema
 * that exists anywhere in this codebase as of this piece. `overlay.yaml`'s own `requestsCapabilities`
 * field (`15` §15.11) has no committed schema yet — `PLAN-M11.md` P3 (building concurrently in this
 * same working directory) is introducing a first, deliberately partial one for its own consent-screen
 * purpose, uncommitted at the time this piece was built, and is not depended on here. An overlay
 * bundle still gets the full injection/secret scan; only the grant-widening check is module-only.
 * Recorded as a real, disclosed scope decision in `SPEC-QUESTIONS.md` (see the citation below), not a
 * silent gap. `mcp/`, the third directory `15` §19.1's overlay tree names alongside `skills/`/
 * `templates/`, is left unscanned by this piece: it is a server manifest, not prose rendering into
 * agent context the way a skill/template/prompt body does, so it is a materially different surface
 * than the one I9 names — also recorded, as a residual scope note, not silently.
 *
 * Every scanned file is read only after a real byte-size check (`MAX_SCANNED_FILE_BYTES`): the local
 * and git install channels apply no size cap of their own (verified directly — neither `fetch-local.ts`
 * nor `fetch-git.ts` names a byte limit anywhere), so without a cap *here* a single oversized template,
 * prompt, or `SKILL.md` in an otherwise-ordinary local or git bundle would be read fully into memory
 * before this gate, or `consent`, or install, ever run — a real, accidental-reachable resource
 * exhaustion a critic round found this piece's own first draft left both unmitigated and undisclosed.
 *
 * @see specs/19 §19.5
 * @see specs/19 §19.1
 * @see specs/19 §19.2
 * @see specs/15 §15.10 (I9)
 * @see specs/20 §20.6
 * @see PLAN-M11.md P4
 * @see SPEC-QUESTIONS.md Q175
 */
import {
  ForgeError,
  listDirEntriesSorted,
  pathExists,
  readTextFile,
  type AbsolutePath,
} from '@forge/core';
import { stat } from 'node:fs/promises';
import path from 'node:path';

import { checkToolCeiling } from '../agents/index.ts';
import type { ToolGrant } from '../agents/index.ts';
import { parseModule } from '../module/index.ts';
import type { ModuleDefinition } from '../module/index.ts';
import { parseSkillPackage } from '../skills/parse.ts';
import { INJECTION_PATTERNS, SECRET_PATTERNS } from '../skills/patterns.ts';
import { skillFrontMatterSchema } from '../skills/schema.ts';
import type { ParsedSkill } from '../skills/types.ts';
import { findManifestKind } from './manifest.ts';
import { DEFAULT_MAX_DECOMPRESSED_BYTES } from './tar-extract.ts';

export type SafetyScanFindingCode = 'injection' | 'secret' | 'grant-widening';

export interface SafetyScanFinding {
  readonly code: SafetyScanFindingCode;
  /** A path relative to the bundle root, e.g. `"skills/deploy-helper/SKILL.md"` or
   * `"templates/service/README.md.hbs"`. */
  readonly location: string;
  readonly message: string;
}

/** No install channel in this codebase caps an individual file's byte size on its own (`fetch-local.ts`
 * and `fetch-git.ts` were both read directly to confirm this — only the npm channel's `tar-extract.ts`
 * enforces a decompressed-size cap, and only on the whole archive). Reusing that same cap's value here,
 * rather than inventing a new number, gives every channel the identical effective per-file ceiling this
 * gate ever enforces, and a bundle already accepted by the npm channel can never fail this check purely
 * for being large in a way that channel already tolerated. */
const MAX_SCANNED_FILE_BYTES = DEFAULT_MAX_DECOMPRESSED_BYTES;

/**
 * Refuses outright — never silently skips — a file this scan is about to read in full if it exceeds
 * `MAX_SCANNED_FILE_BYTES`. Without this, a single oversized `SKILL.md`, template, or prompt file in an
 * otherwise-ordinary local- or git-channel bundle (which apply no size cap of their own) would be read
 * entirely into memory by this gate before consent or install ever run — a real, accidental-reachable
 * resource-exhaustion gap a critic round found this piece's own first draft left both unmitigated and
 * undisclosed.
 *
 * @throws {ForgeError} `CFG-038` if `absPath`'s size exceeds the cap.
 */
async function assertWithinScanCap(absPath: AbsolutePath, location: string): Promise<void> {
  const stats = await stat(absPath);
  if (stats.size > MAX_SCANNED_FILE_BYTES) {
    throw new ForgeError('CFG-038', { location, size: stats.size, limit: MAX_SCANNED_FILE_BYTES });
  }
}

function child(dir: AbsolutePath, ...segments: string[]): AbsolutePath {
  return path.join(dir, ...segments) as AbsolutePath;
}

/** `pattern`, widened to also carry the `g` flag if it does not already — a fresh `RegExp` instance
 * each call, so this never mutates (or reads stale `lastIndex` state from) `INJECTION_PATTERNS`/
 * `SECRET_PATTERNS`' own shared, non-global module-level regexes. */
function globalOf(pattern: RegExp): RegExp {
  return new RegExp(
    pattern.source,
    pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`,
  );
}

/**
 * Every match of every pattern in `patterns` against `text` — not merely the first match of the first
 * pattern to hit, which a critic round found the first draft (inherited from `skills/validate.ts`'s
 * own single-`exec`-per-pattern `checkPatterns`) under-reported: two distinct secret-shaped literals
 * of the identical pattern in one file produced only one finding. `describe` never has to be a
 * one-to-one function of `code` here — the same pattern can be matched more than once in `text`, each
 * occurrence producing its own finding.
 */
function scanTextForPatterns(
  text: string,
  patterns: readonly RegExp[],
  code: 'injection' | 'secret',
  location: string,
  describe: (match: string) => string,
): SafetyScanFinding[] {
  const findings: SafetyScanFinding[] = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(globalOf(pattern))) {
      findings.push({ code, location, message: describe(match[0]) });
    }
  }
  return findings;
}

function scanInjectionAndSecrets(text: string, location: string): SafetyScanFinding[] {
  return [
    ...scanTextForPatterns(
      text,
      INJECTION_PATTERNS,
      'injection',
      location,
      (match) =>
        `contains instruction-shaped content targeting the operating contract: "${match}".`,
    ),
    ...scanTextForPatterns(
      text,
      SECRET_PATTERNS,
      'secret',
      location,
      (match) => `contains a secret-shaped literal: "${match.slice(0, 12)}…".`,
    ),
  ];
}

/** Every direct subdirectory name of `skillsDir` — `19` §19.1's own `skills/<id>/SKILL.md` layout —
 * `[]` if `skillsDir` does not exist at all (a bundle need not carry any skill). */
async function listSkillIds(skillsDir: AbsolutePath): Promise<readonly string[]> {
  if (!(await pathExists(skillsDir))) return [];
  const entries = await listDirEntriesSorted(skillsDir);
  return entries.filter((entry) => entry.isDirectory).map((entry) => entry.name);
}

interface ScannedFile {
  readonly absPath: AbsolutePath;
  /** Relative to `dir` (the directory `collectFilesByExtension` was originally called with),
   * POSIX-separated regardless of host platform. */
  readonly relPath: string;
}

/**
 * Every file ending in `extension` anywhere under `dir`, found by a recursive walk — `[]` if `dir`
 * does not exist at all (a bundle need not carry any template or prompt override). Bundle content has
 * already passed `tar-extract.ts`'s own symlink/hard-link refusal (the npm channel) or the git/local
 * channels' own containment (`@forge/vcs`), so this walk never needs its own symlink guard — it is
 * reading content the earlier channel step already accepted as a plain, real directory tree.
 *
 * Recursive even for `prompts/`, whose own `19` §19.1 layout tree shows as flat (`prompts/*.md`, not
 * `prompts/**\/*.md`): scanning subdirectories a real module never nests content under costs nothing,
 * while trusting the tree diagram literally would let a hostile bundle simply nest its `prompts/`
 * override one directory deeper to evade this exact gate — the same reasoning `templates/**\/*.hbs`
 * already gets applied for real here, extended rather than only half-applied.
 */
async function collectFilesByExtension(
  dir: AbsolutePath,
  relBase: string,
  extension: string,
): Promise<readonly ScannedFile[]> {
  if (!(await pathExists(dir))) return [];
  const entries = await listDirEntriesSorted(dir);
  const results: ScannedFile[] = [];
  for (const entry of entries) {
    const absPath = child(dir, entry.name);
    const relPath = relBase === '' ? entry.name : `${relBase}/${entry.name}`;
    if (entry.isDirectory) {
      results.push(...(await collectFilesByExtension(absPath, relPath, extension)));
    } else if (entry.name.endsWith(extension)) {
      results.push({ absPath, relPath });
    }
  }
  return results;
}

/**
 * A bounded, disclosed heuristic for "this skill body's own prose asks for a grant its own declared
 * ceiling does not cover" — `15` §15.10 I9's own "attempts" framing already concedes this class of
 * check is adversarial pattern-matching, not a proof, the identical stance `INJECTION_PATTERNS`'
 * own doc comment takes for its own, narrower surface. Each entry names the literal `ToolGrant`
 * dimension its phrasing implies, so the comparison below can reuse `checkToolCeiling` (`PLAN-M10.md`
 * P2's own real ceiling-comparison logic) directly rather than re-deriving a second grant-diffing
 * routine for this one caller.
 */
const WIDENING_PATTERNS: readonly {
  readonly pattern: RegExp;
  readonly implies: ToolGrant;
  readonly describe: string;
}[] = [
  {
    pattern: /\bwrite (access )?to (any|arbitrary|all) files?\b/i,
    implies: { write: true },
    describe: 'unrestricted write access',
  },
  {
    pattern: /\b(run|execute) (any|arbitrary) (shell )?commands?\b/i,
    implies: { exec: ['*'] },
    describe: 'unrestricted command execution',
  },
  {
    pattern: /\bfull network access\b|\bconnect to any (host|server)\b/i,
    implies: { network: 'full' },
    describe: 'full network access',
  },
  {
    pattern: /\bdeploy (directly )?to production\b|\bfull deploy access\b/i,
    implies: { deploy: true },
    describe: 'production deploy access',
  },
];

/**
 * Which module-declared roles a skill's own widened-grant claim is checked against: the skill's own
 * `applies_to.agents` (`15` §15.4.2) when it names any, so a skill explicitly scoped to one role is
 * only compared against that role's own ceiling — otherwise every role the module itself declares a
 * ceiling for, on the reasoning that an unscoped skill can run under any of them. A scoped skill
 * naming a role the module never declared a ceiling for still gets a real check: the ceiling for an
 * undeclared role is treated as the empty grant (nothing permitted), the same fail-closed direction
 * `isModuleEscalationActive`'s own doc comment already takes for a lapsed escalation. An empty result
 * (an unscoped skill in a module that declares no ceilings at all) is handled by `scanGrantWidening`
 * itself, which flags directly rather than iterating zero roles.
 */
function targetRolesFor(skill: ParsedSkill, moduleDef: ModuleDefinition): readonly string[] {
  const schemaResult = skillFrontMatterSchema.safeParse(skill.frontMatter);
  const explicitRoles = schemaResult.success ? (schemaResult.data.applies_to?.agents ?? []) : [];
  if (explicitRoles.length > 0) return explicitRoles;
  return Object.keys(moduleDef.ceilings);
}

/**
 * `moduleCeilingGrantSchema`'s own `z.infer` type (unlike `ToolGrant`) types every optional field as
 * `T | undefined`, not merely "key may be absent" — a real, `exactOptionalPropertyTypes`-visible
 * mismatch `module/schema.ts`'s own doc comment already flags as the reason `ceilings` uses a
 * deliberately separate schema from `agents/schema.ts`'s `toolGrantSchema` in the first place. Strips
 * any key whose value is a literal `undefined` (the identical filter `agents/ceiling.ts`'s own
 * `mergeGrants` already applies for the same reason at its own call site) so the result satisfies
 * `ToolGrant` for real, not via a cast papering over the difference.
 */
function toToolGrant(grant: ModuleDefinition['ceilings'][string] | undefined): ToolGrant {
  if (grant === undefined) return {};
  return Object.fromEntries(Object.entries(grant).filter(([, value]) => value !== undefined));
}

function scanGrantWidening(
  skillId: string,
  skill: ParsedSkill,
  moduleDef: ModuleDefinition,
): SafetyScanFinding[] {
  const findings: SafetyScanFinding[] = [];
  const location = `skills/${skillId}/SKILL.md`;
  const roles = targetRolesFor(skill, moduleDef);
  for (const { pattern, implies, describe } of WIDENING_PATTERNS) {
    if (!pattern.test(skill.body)) continue;
    if (roles.length === 0) {
      // The module declares no ceiling for any role at all, and this skill does not scope itself to
      // one either — there is nothing this claim could legitimately run under, so it is flagged
      // directly rather than iterating an empty role list (which would silently find nothing) or
      // naming a synthetic placeholder role in the user-facing message.
      findings.push({
        code: 'grant-widening',
        location,
        message: `its own prose implies ${describe}, but this module declares no ceiling for any role, so nothing permits it.`,
      });
      continue;
    }
    for (const role of roles) {
      const ceiling = toToolGrant(moduleDef.ceilings[role]);
      const result = checkToolCeiling(
        role,
        { isReviewOrCritic: false, isOps: false },
        ceiling,
        implies,
        [],
      );
      if (result.allowed) continue;
      for (const violation of result.violations) {
        findings.push({
          code: 'grant-widening',
          location,
          message: `its own prose implies ${describe}, which role "${role}"'s declared ceiling does not grant (${violation.detail}).`,
        });
      }
    }
  }
  return findings;
}

/**
 * Every safety finding a real, fetched-but-not-yet-installed bundle at `bundlePath` produces — never
 * throws itself, matching `@forge/schemas`' own "boundary input produces a typed outcome" convention
 * (`SPEC-QUESTIONS.md` Q3) and `validateSkill`'s own identical non-throwing shape. `scanBundleForSafety`
 * below is the thin, throwing gate built on top of this for the install pipeline.
 *
 * @throws {ForgeError} `CFG-038` if any scanned `SKILL.md`, template, or prompt file exceeds
 * `MAX_SCANNED_FILE_BYTES` — checked, and thrown, before that file's content is ever read.
 * @throws {ForgeError} whatever `parseSkillPackage` throws (`CFG-005`/`CFG-006`/`CFG-007`) if a
 * `SKILL.md` itself is too malformed to even read — a bundle that broken has nothing for this
 * function's own checks to run against either.
 * @throws {ForgeError} `CFG-021` if a module bundle's own `module.yaml` fails `moduleSchema`.
 */
export async function findBundleSafetyFindings(
  bundlePath: string,
): Promise<readonly SafetyScanFinding[]> {
  const root = path.resolve(bundlePath) as AbsolutePath;
  const findings: SafetyScanFinding[] = [];

  const skillsDir = child(root, 'skills');
  const skillIds = await listSkillIds(skillsDir);
  const parsedSkills: { readonly id: string; readonly skill: ParsedSkill }[] = [];
  for (const id of skillIds) {
    const location = `skills/${id}/SKILL.md`;
    await assertWithinScanCap(child(skillsDir, id, 'SKILL.md'), location);
    const skill = await parseSkillPackage(child(skillsDir, id));
    parsedSkills.push({ id, skill });
    findings.push(...scanInjectionAndSecrets(skill.body, location));
  }

  const templateFiles = await collectFilesByExtension(child(root, 'templates'), '', '.hbs');
  for (const file of templateFiles) {
    const location = `templates/${file.relPath}`;
    await assertWithinScanCap(file.absPath, location);
    const text = await readTextFile(file.absPath);
    findings.push(...scanInjectionAndSecrets(text, location));
  }

  // `19` §19.1's own module layout, `19` §19.2's own "the same engine renders agent briefs and
  // system prompts": a `prompts/*.md` override renders directly into a live system prompt, exactly
  // the class of content I9 targets — as sensitive as a template body, not a lesser case of it, so it
  // gets the identical injection/secret scan (never grant-widening, which is scoped to skill bodies
  // read against `applies_to.agents`; a prompt override has no such per-role scoping to check against).
  const promptFiles = await collectFilesByExtension(child(root, 'prompts'), '', '.md');
  for (const file of promptFiles) {
    const location = `prompts/${file.relPath}`;
    await assertWithinScanCap(file.absPath, location);
    const text = await readTextFile(file.absPath);
    findings.push(...scanInjectionAndSecrets(text, location));
  }

  const manifestKind = await findManifestKind(root);
  if (manifestKind === 'module') {
    const moduleDef = await parseModule(child(root, 'module.yaml'));
    for (const { id, skill } of parsedSkills) {
      findings.push(...scanGrantWidening(id, skill, moduleDef));
    }
  }

  return findings;
}

/**
 * The real, blocking pre-install gate (`19` §19.5 step 4): throws `CFG-037` — refusing installation
 * outright — if `bundlePath` has any safety finding, and returns normally (writing nothing itself)
 * otherwise. Callers wire this in strictly before whatever performs step 5's `.forge/` install (this
 * piece's own P5 dependent, `moduleAdd`/`overlayAdd`): a bundle this function refuses is never
 * written to disk, because the throw happens before that step is ever reached.
 *
 * @throws {ForgeError} `CFG-037` if `bundlePath` has any injection, secret, or grant-widening finding.
 * @throws {ForgeError} `CFG-038` if any scanned file exceeds this scan's own size cap.
 * @throws {ForgeError} whatever `findBundleSafetyFindings` itself throws for a malformed `SKILL.md`
 * or `module.yaml` (`CFG-005`/`CFG-006`/`CFG-007`/`CFG-021`).
 */
export async function scanBundleForSafety(bundlePath: string): Promise<void> {
  const findings = await findBundleSafetyFindings(bundlePath);
  if (findings.length === 0) return;
  throw new ForgeError('CFG-037', {
    bundlePath,
    findings: findings.map((finding) => `${finding.location}: ${finding.message}`),
  });
}
