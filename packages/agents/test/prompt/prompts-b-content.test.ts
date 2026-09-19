/**
 * Content-quality invariants for `PROMPTS_B` (`PLAN-M13.md` P3b) — the 31 `prompt.system` /
 * `prompt.briefs.*` files of agents integration-architect..ux.
 *
 * `content-index.test.ts` proves each index entry names a real, non-empty file. This file proves the
 * content is what P5 will splice into a compiled prompt: not a placeholder, not front matter, not a
 * copy of another role's text, not a restatement of the agent's own rendered role fields, and not text
 * that imitates the constant blocks ([1] operating contract, [6] constraints) the compiler owns.
 * Vocabulary is derived from each agent's own definition, never hard-coded per role.
 *
 * @see specs/05 §5.3, §5.5
 * @see PLAN-M13.md P3b
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { PROMPT_INDEX } from '@forge/templates';

import { loadAgentDefinition } from '../../src/schema/load.ts';
import type { AgentDefinition } from '../../src/schema/types.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const templatesRoot = path.join(repoRoot, 'packages', 'templates');
const modulesDir = path.join(repoRoot, 'modules');

function readPrompt(key: string): string {
  return readFileSync(path.join(templatesRoot, 'templates', 'prompts', `${key}.md`), 'utf8');
}

/** The registry's own precedence: a later module directory (alphabetical) wins for a shared id. */
function loadAgent(id: string): AgentDefinition {
  const candidates = readdirSync(modulesDir)
    .sort()
    .map((moduleName) => path.join(modulesDir, moduleName, 'agents', `${id}.agent.yaml`))
    .filter((file) => {
      try {
        readFileSync(file);
        return true;
      } catch {
        return false;
      }
    });
  const file = candidates.at(-1);
  if (file === undefined) throw new Error(`no agent definition found for ${id}`);
  const result = loadAgentDefinition(readFileSync(file, 'utf8'), path.basename(file));
  if (!result.success) throw new Error(`${id} failed to load: ${JSON.stringify(result.issues)}`);
  return result.agent;
}

const norm = (text: string): string => text.replace(/\s+/g, ' ').trim().toLowerCase();

/** Every run of `n` consecutive words of `source` that appears verbatim in `haystack`. */
function sharedWordRun(source: string, haystack: string, n: number): string | undefined {
  const words = norm(source).split(' ');
  const hay = ` ${norm(haystack)} `;
  for (let i = 0; i + n <= words.length; i++) {
    const run = words.slice(i, i + n).join(' ');
    if (hay.includes(` ${run} `)) return run;
  }
  return undefined;
}

function roleVocabulary(agent: AgentDefinition, briefKey: string | undefined): string[] {
  const terms = new Set<string>();
  for (const output of agent.outputs) terms.add(output.type.toLowerCase());
  for (const decision of agent.decisions_owned)
    for (const part of decision.split(/[._]/)) if (part.length > 3) terms.add(part.toLowerCase());
  for (const word of agent.name.split(/[^A-Za-z]+/))
    if (word.length > 3) terms.add(word.toLowerCase());
  if (briefKey !== undefined)
    for (const part of briefKey.split('-')) if (part.length > 3) terms.add(part.toLowerCase());
  return [...terms];
}

/** The 15 agents whose prompt files this batch (`PLAN-M13.md` P3b) owns; every other key in the shared
 * index belongs to another batch and is covered by that batch's own test. */
const BATCH_AGENTS: ReadonlySet<string> = new Set([
  'integration-architect',
  'ml-engineer',
  'mobile',
  'orchestrator',
  'platform',
  'pm',
  'po',
  'release',
  'reviewer',
  'sdet',
  'security',
  'sre',
  'techwriter',
  'test-architect',
  'ux',
]);

const entries = Object.keys(PROMPT_INDEX)
  .filter((key) => BATCH_AGENTS.has(key.slice(0, key.indexOf('.'))))
  .map((key) => {
    const dot = key.indexOf('.');
    return { key, agentId: key.slice(0, dot), part: key.slice(dot + 1) };
  });

describe('PROMPTS_B content', () => {
  it('covers exactly the 31 keys of the 15 agents assigned to this batch, in the index', () => {
    expect(entries).toHaveLength(31);
    expect(new Set(entries.map((entry) => entry.agentId)).size).toBe(15);
    for (const { key } of entries)
      expect(PROMPT_INDEX[key], key).toBe(`templates/prompts/${key}.md`);
  });

  it('has, for each agent, exactly the system file and briefs its definition references', () => {
    for (const agentId of new Set(entries.map((entry) => entry.agentId))) {
      const agent = loadAgent(agentId);
      const expected = [
        `${agentId}.system`,
        ...Object.keys(agent.prompt.briefs ?? {}).map((brief) => `${agentId}.${brief}`),
      ].sort();
      const actual = entries
        .filter((entry) => entry.agentId === agentId)
        .map((entry) => entry.key)
        .sort();
      expect(actual, agentId).toEqual(expected);
    }
  });

  describe.each(entries)('$key', ({ key, agentId, part }) => {
    const text = readPrompt(key);
    const agent = loadAgent(agentId);
    const isSystem = part === 'system';

    it('is substantive and sized for its kind', () => {
      const lines = text.split('\n').filter((line) => line.trim() !== '').length;
      expect(lines).toBeGreaterThanOrEqual(isSystem ? 20 : 8);
      expect(text.length).toBeGreaterThan(isSystem ? 3000 : 1500);
    });

    it('has no placeholder markers, front matter, template syntax or scaffold text', () => {
      expect(text).not.toMatch(/\b(TODO|FIXME|TBD|XXX|lorem ipsum)\b/i);
      expect(text).not.toMatch(/Describe .* here\./);
      expect(text).not.toMatch(/\{\{|\}\}|<placeholder>|\[insert /i);
      expect(text.trimStart().startsWith('---')).toBe(false);
    });

    it('does not imitate the compiler-owned constant blocks or their headings', () => {
      expect(text).not.toMatch(/^#{1,2} \[\d\]/m);
      expect(text).not.toMatch(/operating contract/i);
      expect(text).not.toMatch(/^#+ +(Constraints|Tool grants|Forbidden actions)\b/im);
      expect(text).not.toMatch(/^(Constraints|Tool grants|Forbidden actions):/im);
      expect(text).not.toMatch(/^\d+\. You are operating inside FORGE/m);
    });

    it('speaks the vocabulary of its own agent definition', () => {
      const lower = text.toLowerCase();
      const terms = roleVocabulary(agent, isSystem ? undefined : part);
      const hits = terms.filter((term) => lower.includes(term));
      expect(hits.length, `none of ${terms.join(', ')} appear`).toBeGreaterThanOrEqual(2);
    });

    if (isSystem) {
      it("does not restate the agent's own mandate or persona stance verbatim", () => {
        expect(sharedWordRun(agent.mandate, text, 9)).toBeUndefined();
        expect(sharedWordRun(agent.persona.stance, text, 9)).toBeUndefined();
      });
    }

    it('does not tell the agent to bypass gates, edit frozen artifacts or widen its own grant', () => {
      expect(text).not.toMatch(
        /\b(skip|bypass|ignore|disable|waive)\b[^.\n]{0,40}\b(gate|check|validation)s?\b/i,
      );
      expect(text).not.toMatch(/\bedit\b[^.\n]{0,30}\bfrozen\b/i);
      expect(text).not.toMatch(
        /\b(grant yourself|escalate your (own )?permissions|--no-verify)\b/i,
      );
    });
  });

  describe.each(entries)('grant consistency: $key', ({ key, agentId }) => {
    const text = readPrompt(key);
    const agent = loadAgent(agentId);

    it('never instructs an action the agent’s own tool grant forbids', () => {
      if (!agent.tools.write) {
        expect(text).not.toMatch(
          /\byou (should|must|will|can) (fix|patch|edit|rewrite|refactor)\b/i,
        );
      }
      if (agent.tools.git_commit === 'none') {
        expect(text).not.toMatch(/\byou (should|must|will|can) (commit|push|merge)\b/i);
      }
      if (!agent.tools.deploy) {
        expect(text).not.toMatch(/\byou (should|must|will|can) (deploy|release to production)\b/i);
      }
      if (agent.tools.network === false) {
        expect(text).not.toMatch(/\byou (should|must|will|can) (download|curl|fetch from)\b/i);
      }
    });
  });

  it('keeps the read-only critics and the orchestrator from taking over the work they judge or route', () => {
    for (const agentId of ['reviewer', 'security', 'orchestrator']) {
      const agent = loadAgent(agentId);
      expect(agent.tools.write, `${agentId} is read-only`).toBe(false);
      const text = readPrompt(`${agentId}.system`);
      expect(text, agentId).toMatch(/read-only/i);
    }
    expect(norm(readPrompt('reviewer.system'))).toMatch(/you do not fix/i);
    expect(norm(readPrompt('orchestrator.system'))).toMatch(/you do not produce the work/i);
  });

  it('is not a byte-identical (or whitespace-identical) copy of any other file in PROMPT_INDEX', () => {
    const seen = new Map<string, string>();
    for (const [key, relPath] of Object.entries(PROMPT_INDEX)) {
      const text = readFileSync(path.join(templatesRoot, relPath), 'utf8');
      const digest = createHash('sha256').update(norm(text)).digest('hex');
      const earlier = seen.get(digest);
      expect(earlier, `${key} duplicates ${earlier ?? ''}`).toBeUndefined();
      seen.set(digest, key);
    }
  });

  it('is role-specific: no system file shares a long verbatim run with another role', () => {
    const systems = entries.filter((entry) => entry.part === 'system');
    const texts = new Map(systems.map((entry) => [entry.agentId, readPrompt(entry.key)]));
    for (const [a, textA] of texts)
      for (const [b, textB] of texts) {
        if (a >= b) continue;
        expect(sharedWordRun(textA, textB, 14), `${a} and ${b} share text`).toBeUndefined();
      }
  });
});
