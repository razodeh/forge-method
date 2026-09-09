/**
 * `provisionSkills` — `15` §15.6's own native-skills path for an adapter reporting `skills: 'native'`
 * (`capabilities.ts`): real filesystem materialisation of resolved skills into Claude Code's own real,
 * confirmed skill-directory convention, confined to the step's lane worktree.
 *
 * `.claude/skills/<id>/SKILL.md` is confirmed directly against Anthropic's own official Claude Code
 * skills documentation (`code.claude.com/docs/en/skills`, fetched and read during this piece, not
 * assumed): "Directory Layout: `.claude/skills/<skill-name>/SKILL.md`... A skill can be just a single
 * `SKILL.md` file... `description` is recommended so Claude knows when to use the skill," with a
 * worked example showing a YAML frontmatter block (`---\ndescription: ...\n---`) followed by the
 * skill's own body content. `<skill-name>` is confirmed to be exactly one path segment directly under
 * `.claude/skills` -- a fresh critic round found the original draft never checked this, so a
 * plausible, non-adversarial multi-segment id (e.g. `'frontend/review'`) would resolve *inside*
 * `.claude/skills`, write successfully, and be reported as provisioned, while producing a file real
 * Claude Code's own one-level-deep skill discovery would never find at all -- a wrong-file bug, not a
 * boundary escape, but a real one; `resolveSkillFile` (below) now refuses any id containing a `/` or
 * `\` for exactly this reason.
 *
 * `description` is not the *only* real frontmatter field the official docs document -- there is also,
 * among others, `allowed-tools`/`disallowed-tools` (flagged directly in those same docs as security-
 * relevant: "a skill can grant itself broad tool access, so review the `allowed-tools` of skills
 * checked into a repository"). `ResolvedSkill` (`@forge/adapter-kit`, M4) carries no field for this at
 * all, so this piece has no data to act on even if it wanted to -- a real completeness gap in what
 * this milestone's own upstream type can express, not something `provisionSkills` silently drops.
 * `appliesTo` is the one `ResolvedSkill` field this file never reads either, but that one *is*
 * deliberate: per its own doc comment (`packages/adapter-kit/src/types/provisioning.ts`), `appliesTo`
 * exists to pick which skill bodies fit a step's own file-claim budget under the `skills: 'none'`
 * degradation strategy (`SkillProvisioning.strategy: 'bodies-injected'`) -- an adapter with no native
 * skill mechanism at all, forced to inject bodies directly into the prompt under a size limit. This
 * adapter reports `skills: 'native'` and materialises real files with no such budget to enforce, so
 * `appliesTo` has no role to play here.
 *
 * This package has no boundary-graph edge to `@forge/core`, confirmed directly (`adapter-claude-code:
 * ['adapter-kit', 'schemas', 'telemetry']`) -- resolved the same way every other no-edge gap this
 * milestone has hit was resolved: real `node:fs`/`node:fs/promises` calls directly, not
 * `@forge/core/fs`'s own `writeFileAtomic`/`ensureDir`, since that module's own containment/atomicity
 * guarantees exist to protect *host-project* artifact writes, not an adapter's own scratch,
 * materialised-skills directory inside a lane worktree it already has exclusive access to
 * (`PLAN-M7.md` P6's own text). The one real piece of `@forge/core/fs` machinery this file *does*
 * duplicate rather than skip is its symlink-escape defence -- see `realpathOfDeepestExistingAncestor`
 * below.
 *
 * @see specs/07 §7.3
 * @see specs/15 §15.6
 * @see SPEC-QUESTIONS.md Q118
 * @see PLAN-M7.md P6
 */
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { ResolvedSkill, SessionContext, SkillProvisioning } from '@forge/adapter-kit';

/**
 * Mirrors `@forge/core/src/fs/paths.ts`'s own identically-named, identically-motivated helper,
 * duplicated rather than imported (no boundary edge to `@forge/core` -- this file's own top-of-file
 * doc comment). Walks up to the deepest *existing* ancestor of `candidate` and resolves *that*
 * directory's real path, so a symlink escape is caught even for a write target whose own leaf file
 * (and possibly several of its parent directories) does not exist yet -- exactly this function's own
 * real situation, materialising a skill directory that has never existed before.
 *
 * A fresh critic round found the original draft had *no* symlink defence at all: a purely lexical
 * `path.resolve`/`path.relative` check (the one `@forge/testkit`'s own `resolveInsideCwd` uses) passes
 * for a path that is *textually* inside `.claude/skills` even when `.claude` or `.claude/skills`
 * itself is a symlink pointing somewhere else entirely -- and `resolveInsideCwd`'s own doc comment
 * explicitly disclaims exactly this ("the attacker this defends against is a script authored within
 * the same test process, not a hostile filesystem -- real adapters' own symlink-escape defence is
 * `@forge/core`'s job"). `ClaudeCodeAdapter` is a real adapter, and a lane worktree is not a trusted-
 * by-construction environment: an earlier step in the same lane can run arbitrary shell commands
 * against it, including planting a symlink before this step's own `provisionSkills` call ever runs.
 */
function realpathOfDeepestExistingAncestor(candidate: string): string {
  let probe = candidate;
  while (!existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  const realAncestor = realpathSync(probe);
  const suffix = path.relative(probe, candidate);
  return suffix === '' ? realAncestor : path.join(realAncestor, suffix);
}

/**
 * Resolves `<cwd>/.claude/skills/<skillId>/SKILL.md`, or `undefined` when `skillId` would not stay
 * inside that one directory -- by traversal (e.g. `'../../etc'`), by being empty (which `path.join`
 * would otherwise silently collapse away rather than giving the skill its own real subdirectory), by
 * containing a `/` or `\` (a multi-segment id -- see this file's own top-of-file doc comment for why
 * that is refused, not merely unusual), or by a symlink escape a purely lexical check cannot see
 * (`realpathOfDeepestExistingAncestor`, above). Checked against `.claude/skills` itself, not merely
 * `cwd` -- `07` §7.6's own C15 ("does not leak into other lanes") is about the *lane*, but a skill id
 * that escapes its own skill directory while technically staying inside `cwd` is still a real
 * boundary violation this function exists to prevent, not merely the narrower one C15 names.
 */
function resolveSkillFile(cwd: string, skillId: string): string | undefined {
  if (
    skillId.length === 0 ||
    !path.isAbsolute(cwd) ||
    skillId.includes('/') ||
    skillId.includes('\\')
  ) {
    return undefined;
  }
  const skillsRoot = path.join(cwd, '.claude', 'skills');
  const resolved = path.resolve(skillsRoot, skillId);
  const relative = path.relative(skillsRoot, resolved);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return undefined;

  try {
    // Anchored at `cwd` itself, not at `skillsRoot` -- a first draft of this check compared the real
    // resolved target against a *real* (symlink-followed) version of `skillsRoot` too, which a fresh
    // critic round's own new symlink test caught failing to catch anything at all: if `.claude/skills`
    // itself is the planted symlink, resolving *both* sides of the comparison through that same
    // symlink means the escaped target is always still trivially "inside" the escaped root -- the
    // check can never see the escape, no matter where the symlink points. `@forge/core/src/fs/
    // paths.ts`'s own `resolveWithin` anchors at the real *project root* for the identical reason;
    // `cwd` (the lane worktree) is this function's own equivalent trust boundary.
    const realCwd = realpathOfDeepestExistingAncestor(cwd);
    const realResolved = realpathOfDeepestExistingAncestor(resolved);
    const realRelative = path.relative(realCwd, realResolved);
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
      return undefined;
    }
  } catch {
    // A real filesystem error while probing for a symlink (a permission error, an unreadable
    // ancestor, ...) is exactly the kind of genuine uncertainty this whole package resolves by
    // refusing rather than guessing it is probably fine.
    return undefined;
  }

  return path.join(resolved, 'SKILL.md');
}

/**
 * The three real Unicode line-terminator-like code points `JSON.stringify` leaves unescaped (see
 * `yamlSafeQuoted`'s own doc comment below) -- named as plain hex numbers, deliberately, rather than
 * as literal characters anywhere in this file's own source text. U+2028, U+2029, and U+0085 render as
 * invisible or near-invisible glyphs in an editor; a literal character here would be unverifiable by
 * reading the source and one stray keystroke away from silently being some *other* invisible
 * character instead. Every use below derives the real character and its escape sequence from these
 * numbers, never types either directly.
 */
const YAML_UNSAFE_LINE_BREAK_CODE_POINTS = [0x2028, 0x2029, 0x0085] as const;

/**
 * `JSON.stringify` escapes every quote, backslash, and C0 control character (including `\n`/`\r`),
 * but a fresh critic round found -- by actually running it, not just reading the JSON spec -- that it
 * leaves three real Unicode line-terminator-like code points as literal characters: U+2028 (LINE
 * SEPARATOR), U+2029 (PARAGRAPH SEPARATOR), and U+0085 (NEXT LINE). These are exactly the additional
 * line breaks YAML 1.1-flavored parsers (still common in real-world YAML libraries) recognise beyond
 * `\n`/`\r`, including inside a double-quoted scalar -- so a summary containing one of them could
 * still inject a real line break into the frontmatter block, undermining the exact property this
 * function's own caller (`skillMdContent`, below) claims to guarantee. Escaped explicitly here, using
 * the same `\uXXXX` form YAML's own double-quoted scalar syntax already supports (a documented
 * superset of JSON's own escape grammar) -- closing the gap `JSON.stringify` alone does not.
 */
function yamlSafeQuoted(value: string): string {
  let jsonQuoted = JSON.stringify(value);
  for (const codePoint of YAML_UNSAFE_LINE_BREAK_CODE_POINTS) {
    const literalChar = String.fromCodePoint(codePoint);
    const escapeSequence = `\\u${codePoint.toString(16).padStart(4, '0')}`;
    jsonQuoted = jsonQuoted.split(literalChar).join(escapeSequence);
  }
  return jsonQuoted;
}

/**
 * `description: ${yamlSafeQuoted(skill.summary)}` -- not a raw, unescaped interpolation. Matches
 * `@forge/adapter-kit/grants`'s own already-gauntlet-tested `describeGrant` convention (a gauntlet
 * critic there found a raw-joined string let a crafted value's own text look like it closed one field
 * and started a different one, `SPEC-QUESTIONS.md` Q58) -- extended past plain `JSON.stringify` by
 * `yamlSafeQuoted` (above) once a fresh critic round found `JSON.stringify` alone does not cover every
 * character a real YAML parser can treat as a line break. `body` needs no equivalent escaping: it is
 * the skill's own real content, placed *after* the one frontmatter block a real SKILL.md file ever
 * has (a `---` inside `body` is ordinary Markdown, e.g. a horizontal rule -- every frontmatter-aware
 * parser, this one included per its own documented behaviour, treats only the first `---`-delimited
 * block at the very start of the file as metadata).
 */
function skillMdContent(skill: ResolvedSkill): string {
  return `---\ndescription: ${yamlSafeQuoted(skill.summary)}\n---\n\n${skill.body}\n`;
}

/**
 * Writes each real, valid skill to its own `SKILL.md`; a skill is silently skipped -- never written,
 * and never counted in the returned `provisionedSkillIds` -- when its `id` fails `resolveSkillFile`'s
 * own boundary check, when its `id` duplicates one already provisioned earlier in this same call (the
 * first occurrence wins; a fresh critic round found the original draft let two same-id entries both
 * report success while only the second's content actually survived on disk), or when the real
 * `mkdir`/`writeFile` call itself fails (a fresh critic round found the original draft had no
 * `try`/`catch` here at all, so one bad id -- a NUL byte, a Windows-reserved device name, a path too
 * long for the filesystem -- threw and aborted the *whole* call, silently leaving whichever earlier
 * skills had already been written with no way for the caller to know). None of these ever fail every
 * *other*, unrelated skill in the same call. A caller that needs to know a specific skill failed to
 * provision can already tell, by comparing its own input `skills` against this return value's own
 * `provisionedSkillIds` (the same "caller compares its own request against what actually happened"
 * shape `07` §7.3's own MCP load-verification design, P7, already uses for a sibling concern).
 *
 * Silent overwrite *across* separate calls (a step re-run provisioning the same skill id into the
 * same `cwd` a second time) is a real, deliberately accepted gap, not fixed here: nothing in this
 * package's own scope names a versioning or staleness concept for a materialised skill file, and no
 * real caller of this method exists yet in this codebase to say what the right behaviour would even
 * be. `SPEC-QUESTIONS.md` Q118 has the full record.
 */
export async function provisionSkills(
  skills: readonly ResolvedSkill[],
  ctx: SessionContext,
): Promise<SkillProvisioning> {
  const provisionedSkillIds: string[] = [];
  const seenIds = new Set<string>();
  for (const skill of skills) {
    if (seenIds.has(skill.id)) continue;
    const skillFile = resolveSkillFile(ctx.cwd, skill.id);
    if (skillFile === undefined) continue;
    try {
      await mkdir(path.dirname(skillFile), { recursive: true });
      await writeFile(skillFile, skillMdContent(skill), 'utf8');
    } catch {
      continue;
    }
    seenIds.add(skill.id);
    provisionedSkillIds.push(skill.id);
  }
  return { strategy: 'native', provisionedSkillIds };
}
