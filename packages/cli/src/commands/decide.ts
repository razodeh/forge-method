/**
 * `forge decide <framework>` — `03` §3.2.2: "Run a decision framework interactively." This
 * milestone builds no TUI (`22`'s own "Do not build" line), so this is the real, non-interactive
 * equivalent `03` §3.1's own "every interactive flow MUST have a --yes-able non-interactive
 * equivalent" rule requires — the caller supplies the evidence a human would otherwise be prompted
 * for, this runs `@forge/methods`' own real rules→score→rank pipeline (`11` §11.0's execution
 * contract) end to end.
 *
 * @see specs/03 §3.2.2
 * @see specs/11 §11.0
 */
import { readFramework } from '@forge/methods/schema';
import { applyRules, killerRisk, score, type EvidenceCell, type ScoredOption } from '@forge/methods/score';
import { ProjectPaths } from '@forge/core/fs';

import { resolvePackageRoot } from '../init/package-root.ts';

const REAL_FRAMEWORKS_ROOT = resolvePackageRoot('@forge/templates');

export interface DecideInput {
  readonly frameworkId: string;
  readonly derivedValues?: Readonly<Record<string, unknown>>;
  readonly cells: readonly EvidenceCell[];
  /** Overrides where framework definitions are read from — defaults to the real, shipped
   * `@forge/templates` content every real caller uses. Only ever supplied by a test exercising a
   * deliberately-invalid framework file, which cannot use the real (read-only, always-valid)
   * shipped content to do that. */
  readonly frameworksRoot?: string;
}

export interface DecideResult {
  readonly ranked: readonly ScoredOption[];
  readonly topOptionKillerRisk: string | undefined;
}

/** Reads `frameworkId`'s real, shipped definition (`@forge/templates`' own `templates/frameworks/
 * <id>.framework.yaml`, the identical content `forge init` copies into `.forge/frameworks/`). */
async function readRealFramework(frameworkId: string, frameworksRoot: string) {
  const relPath = `templates/frameworks/${frameworkId}.framework.yaml`;
  const result = await readFramework(new ProjectPaths(frameworksRoot), relPath);
  if (!result.success) {
    throw new Error(`${relPath}: ${result.issues.map((issue) => issue.message).join('; ')}`);
  }
  return result.framework;
}

export async function decide(input: DecideInput): Promise<DecideResult> {
  const framework = await readRealFramework(
    input.frameworkId,
    input.frameworksRoot ?? REAL_FRAMEWORKS_ROOT,
  );
  const { eliminated, preferred } = applyRules(framework, input.derivedValues ?? {});
  // `preferred` (a rule's own `then.prefer`) outranks score entirely, the same "a hard rule beats a
  // raw score" precedence `@forge/catalog`'s own `selectStack` already establishes for mandated
  // entries — a rule that names a preferred option is a stronger signal than any evidence cell, not
  // a tie-breaker among otherwise-equal scores.
  const ranked = [...score(framework, input.cells, eliminated)].sort((a, b) => {
    if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1;
    if (preferred !== undefined && a.optionId === preferred) return -1;
    if (preferred !== undefined && b.optionId === preferred) return 1;
    return b.totalScore - a.totalScore;
  });
  const top = ranked.find((option) => !option.eliminated);
  return {
    ranked,
    topOptionKillerRisk: top !== undefined ? killerRisk(top, framework) : undefined,
  };
}
