/**
 * `forge spec interfaces --check-frozen` — `G-Design`'s `interfaces:frozen` check (`10` §10.3, `06` §6.6 rule 5:
 * "A gate check (`interfaces:frozen`) fails the design gate if any consumer references an undefined contract").
 *
 * **What is read.** Project documents only. The contracts are the files under `<specs>/interfaces/` (`09` §9.6): a
 * plain YAML contract carrying the artifact's front matter keys at its top level, or a front-matter document
 * (the same two forms the engine's output check accepts, `packages/engine/src/dispatch/outputs.ts`). The consumers
 * are the Stories under the specs root: each entry of `interfaces`, and each `context_refs` entry shaped like an
 * interface id (`INT-###`). No clock, no network, no model; the output is sorted, so a re-run is byte-identical.
 *
 * **What is judged.** A reference is defined when exactly one valid `InterfaceContract` carries its id. It is
 * undefined when no contract does, when the file that carries it is not a valid contract, or when two files claim
 * it. A contract file that is not a valid contract defines nothing, so it counts even when no Story names it:
 * `undefined_refs`, the one field the gate reads, counts EVERY such problem (the gate's own words are "undefined
 * interface refs", and a directory that cannot say what is defined cannot show that nothing is undefined). A
 * Story file that cannot be read may hold references nobody can see, so it counts too. No step fills `Story.interfaces`
 * (P18: `write-stories` writes `Needs interface: (operation), consumer (component)` lines instead), so each such line is
 * a reference too: it is covered when some valid contract's text (title, operations) contains the operation named in the
 * parentheses, case and spacing ignored, and undefined otherwise (`freeze-contracts`: "covered by a contract whose title or
 * operations name it").
 *
 * **What is not judged** (`Q228`): the contract's `status` (the template ships `draft` and no brief moves it, so
 * requiring another value would fail every project that follows the briefs), whether a story that lists no interface
 * and writes no `Needs interface:` line consumes one, whether a contract that names an operation specifies it well, and
 * whether a contract's body is complete (the advisory critic's).
 *
 * @see specs/06 §6.6
 * @see specs/09 §9.6
 * @see specs/10 §10.3
 * @see PLAN-M13.md P26
 */
import { ArtifactDocument, parseFrontMatterYaml } from '@forge/core/artifacts';
import { isForgeError } from '@forge/core/errors';
import { readTextFile } from '@forge/core/fs';
import { baseFrontMatterShape, interfaceContractSchema } from '@forge/schemas';

import type { GateCheckOutcome, GateViolation } from '../gate-check-output.ts';
import type { SpecCommandContext } from '../spec.ts';
import {
  MAX_FILES,
  compare,
  errorMessage,
  oneLine,
  readSpecDocuments,
  walkFiles,
} from './spec-files.ts';

const INTERFACES_DIR = 'interfaces';
const BASE_KEYS: readonly string[] = Object.keys(baseFrontMatterShape.shape);
/** An interface id as a Story lists it. Only used to pick `context_refs` entries that name a contract. */
const INTERFACE_ID = /^INT-\d{3,}$/;
/** The line `write-stories` writes for each interface a story consumes before any contract exists. */
const NEEDS_INTERFACE_LINES = /Needs interface:[ \t]*(.*)$/gim;
const BOM = '\uFEFF';

export type Contract =
  | {
      readonly kind: 'valid';
      readonly id: string;
      readonly path: string;
      /** The words of the record's own content (title, keys, values, body; not the standard front matter keys) and of
       * the notation files beside it: what a `Needs interface:` line is looked up in. */
      readonly words: Set<string>;
    }
  | {
      readonly kind: 'invalid';
      readonly path: string;
      readonly reason: string;
      readonly id?: string;
    };

/** One contract file as an artifact, or why it is not one. Mirrors the engine's `interfaceContractProblems`: a
 * front-matter document is judged whole; a plain YAML file (or a `---` that is only YAML's document-start marker,
 * with no closing line) is judged on its base keys only, because the rest is the machine-readable contract. */
function readContract(path: string, source: string, withWords: boolean): Contract {
  const body = source.startsWith(BOM) ? source.slice(BOM.length) : source;
  let data: Record<string, unknown> | undefined;
  let prose = '';
  if (body.startsWith('---')) {
    try {
      const doc = ArtifactDocument.parse(source, path);
      data = doc.frontMatter as Record<string, unknown>;
      prose = doc.body.slice(0, MAX_LOOKUP_CHARS);
    } catch (cause) {
      if (!isForgeError(cause) || cause.code !== 'CFG-006') {
        return { kind: 'invalid', path, reason: oneLine(errorMessage(cause)) };
      }
    }
  }
  const framed = data !== undefined;
  if (data === undefined) {
    try {
      data = parseFrontMatterYaml(source, path);
    } catch (cause) {
      return { kind: 'invalid', path, reason: oneLine(errorMessage(cause)) };
    }
  }
  const own = framed
    ? data
    : Object.fromEntries(Object.entries(data).filter(([key]) => BASE_KEYS.includes(key)));
  const parsed = interfaceContractSchema.safeParse(own);
  const id = typeof data['id'] === 'string' ? data['id'] : undefined;
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first === undefined ? '' : `${first.path.join('.')}: ${first.message}`;
    return {
      kind: 'invalid',
      path,
      reason: oneLine(`it is not a valid InterfaceContract (${where})`),
      ...(id === undefined ? {} : { id }),
    };
  }
  const words = new Set<string>();
  if (withWords) {
    collectWords(data, words);
    wordsOf(prose, words, true);
  }
  return { kind: 'valid', id: parsed.data.id, path, words };
}

/** A contract larger than this is looked up in its first characters only (its title and leading operations). */
const MAX_LOOKUP_CHARS = 1024 * 1024;
const MAX_WORDS = 20_000;
/** The contract set is read up to this many characters in all: memory and time stay bounded on a hostile tree. */
const MAX_TOTAL_CHARS = 32 * 1024 * 1024;
/** An operation shorter than this is not a name (`(a)`, `(id)`): it would match by accident. */
const MIN_OPERATION_CHARS = 3;
/** A `Needs interface:` line is read up to here: the operation is at its start, and a hostile line must not cost more. */
const MAX_LINE_CHARS = 300;

/** The words of `text`, lower-cased. An identifier is split at case boundaries and separators (`createOrder`,
 * `list_orders`, `CreateOrder`): its parts are words; with `joined` (a contract's own text) the whole identifier is a
 * word too, so both `(create order)` and `(createorder)` find `createOrder`. */
function wordsOf(text: string, into: Set<string>, joined = false): void {
  for (const token of text.match(/[A-Za-z0-9]+/g) ?? []) {
    if (into.size >= MAX_WORDS) return;
    if (joined) into.add(token.toLowerCase());
    for (const part of token.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|[0-9]+/g) ?? []) {
      into.add(part.toLowerCase());
    }
  }
}

/** Every key and scalar of a parsed record, except the standard front matter keys (`status: draft` and `author: ...`
 * are about the record, not the interface); the title is the one standard key that names it. */
function collectWords(value: unknown, into: Set<string>, depth = 0): void {
  if (depth > 20 || into.size >= MAX_WORDS) return;
  if (typeof value === 'string') {
    wordsOf(value, into, true);
  } else if (typeof value === 'number') {
    wordsOf(String(value), into, true);
  } else if (Array.isArray(value)) {
    for (const item of value) collectWords(item, into, depth + 1);
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      if (depth === 0 && BASE_KEYS.includes(key) && key !== 'title') continue;
      wordsOf(key, into, true);
      collectWords(child, into, depth + 1);
    }
  }
}

/** The operation a `Needs interface: (operation), consumer (component)` line names: the parenthesised text that opens
 * the line, or else everything before the first comma (a consumer's own parentheses are not the operation), as words. */
function neededOperation(rest: string): readonly string[] {
  const line = rest.slice(0, MAX_LINE_CHARS).trim();
  const close = line.startsWith('(') ? line.indexOf(')') : -1;
  const named = close === -1 ? (line.split(',')[0] ?? '') : line.slice(1, close);
  const words = new Set<string>();
  wordsOf(named, words);
  return [...words].join('').length >= MIN_OPERATION_CHARS ? [...words] : [];
}

/** Every file under `<specs>/interfaces/` read as a contract, and the problems that stopped the listing being
 * complete. Exported for `./integration-rules.ts`, which needs the same set of defined ids. */
export async function loadContracts(
  ctx: SpecCommandContext,
  withWords = false,
): Promise<{
  readonly contracts: readonly Contract[];
  readonly problems: readonly GateViolation[];
}> {
  const problems: GateViolation[] = [];
  const contracts: Contract[] = [];
  const interfacesRoot = `${ctx.specsRoot}/${INTERFACES_DIR}`;
  const listing = await walkFiles(ctx, interfacesRoot);
  if (listing.capped) {
    problems.push({
      subject: interfacesRoot,
      message: `More than ${String(MAX_FILES)} files under ${interfacesRoot}: the contract set cannot be read in full.`,
      remedy: `Move what is not a contract out of ${interfacesRoot}, then run the check again.`,
    });
  }
  let total = 0;
  for (const path of listing.files) {
    // Only the record files: `.proto`, `.graphql`, `.ts` and other notations sit beside their YAML record.
    if (!/\.(?:ya?ml|md)$/i.test(path)) continue;
    try {
      const source = await readTextFile(ctx.paths.resolveWithin(path));
      total += source.length;
      if (total > MAX_TOTAL_CHARS) {
        problems.push({
          subject: interfacesRoot,
          message: `The contracts under ${interfacesRoot} are over ${String(MAX_TOTAL_CHARS)} characters in all: the set cannot be read in full.`,
          remedy: `Split the machine-readable contracts out of ${interfacesRoot}, or keep only the records there.`,
        });
        break;
      }
      // A Markdown file with no front matter (a README) is not a contract record.
      if (/\.md$/i.test(path) && !source.replace(/^\uFEFF/, '').startsWith('---')) continue;
      contracts.push(readContract(path, source, withWords));
    } catch (cause) {
      contracts.push({ kind: 'invalid', path, reason: oneLine(errorMessage(cause)) });
    }
  }
  // The notation files beside a record (`orders.proto`, `orders.graphql`) hold the operations when the YAML record only
  // carries an id, a title and a reference (`freeze-contracts`): their words count for that record.
  if (withWords) {
    const byStem = new Map<string, string[]>();
    for (const file of listing.files) {
      if (/\.(?:ya?ml|md)$/i.test(file)) continue;
      const stem = file.replace(/\.[^./]+$/, '');
      byStem.set(stem, [...(byStem.get(stem) ?? []), file]);
    }
    for (const contract of contracts) {
      if (contract.kind !== 'valid') continue;
      for (const other of byStem.get(contract.path.replace(/\.[^./]+$/, '')) ?? []) {
        if (total > MAX_TOTAL_CHARS) break;
        try {
          const text = (await readTextFile(ctx.paths.resolveWithin(other))).slice(
            0,
            MAX_LOOKUP_CHARS,
          );
          total += text.length;
          wordsOf(text, contract.words, true);
        } catch {
          // an unreadable notation file only means its words are not there to match
        }
      }
    }
  }
  return { contracts, problems };
}

/** `forge spec interfaces --check-frozen`: the outcome a gate reads. `undefined_refs` counts every problem listed in
 * `violations`; `contracts`, `references`, `unresolved_refs`, `invalid_contracts` and `duplicate_ids` say which
 * kind, so a reader can tell "no contract exists" from "a contract file is broken". */
export async function specInterfacesCheck(ctx: SpecCommandContext): Promise<GateCheckOutcome> {
  const loaded = await loadContracts(ctx, true);
  const violations: GateViolation[] = [...loaded.problems];
  const contracts = loaded.contracts;

  const byId = new Map<string, string[]>();
  let invalid = 0;
  for (const contract of contracts) {
    if (contract.kind === 'valid') {
      byId.set(contract.id, [...(byId.get(contract.id) ?? []), contract.path]);
    } else {
      invalid += 1;
      violations.push({
        subject: contract.path,
        message: `${contract.path} does not define an interface contract: ${contract.reason}.`,
        remedy: `Repair ${contract.path} so it carries valid InterfaceContract front matter keys (id, type, title and the rest of the standard ones), or delete it if it is not a contract.`,
      });
    }
  }
  let duplicates = 0;
  for (const [id, files] of [...byId].sort(([a], [b]) => compare(a, b))) {
    if (files.length < 2) continue;
    duplicates += 1;
    violations.push({
      subject: id,
      message: `${id} is defined by ${String(files.length)} files (${files.slice(0, 5).join(', ')}${files.length > 5 ? ', ...' : ''}); a reference to it is ambiguous.`,
      remedy:
        'Give each contract its own id: keep one file per INT-### and renumber or remove the others.',
    });
  }

  let references = 0;
  let unresolved = 0;
  let needing = 0;
  let needLines = 0;
  const covers = (operation: readonly string[]): boolean =>
    operation.length > 0 &&
    contracts.some(
      (contract) =>
        contract.kind === 'valid' && operation.every((word) => contract.words.has(word)),
    );
  const specs = await readSpecDocuments(
    ctx,
    ctx.specsRoot,
    'the interfaces the stories reference',
    INTERFACES_DIR,
    (path) => /(?:^|\/)stories\//.test(path) && !/(?:^|\/)README\.md$/i.test(path),
  );
  violations.push(...specs.unreadable);
  for (const doc of specs.docs) {
    const frontMatter = doc.frontMatter as Record<string, unknown>;
    if (frontMatter['type'] !== 'Story') continue;
    const story = typeof frontMatter['id'] === 'string' ? frontMatter['id'] : doc.path;
    const listed = frontMatter['interfaces'];
    const refs: string[] = [];
    if (listed !== undefined) {
      if (!Array.isArray(listed) || listed.some((item) => typeof item !== 'string')) {
        violations.push({
          subject: story,
          message: `${story}: "interfaces" is not a list of interface ids (${oneLine(listed, 80)}), so what it references cannot be checked.`,
          remedy: `Make "interfaces" in ${doc.path} a list of INT-### ids.`,
        });
      } else {
        refs.push(...(listed as string[]));
      }
    }
    let lines = 0;
    for (const match of doc.body.matchAll(NEEDS_INTERFACE_LINES)) {
      lines += 1;
      needLines += 1;
      const operation = neededOperation(match[1] ?? '');
      // `freeze-contracts`: every line is "covered by a contract whose title or operations name it". A contract's own
      // words (title, keys, values, body, the notation files beside it) containing every word of the operation is the
      // one mechanical reading of that; whether it names it WELL is the critic's.
      if (covers(operation)) continue;
      const said = oneLine(operation.join(' '), 60);
      violations.push({
        subject: `${story} needs ${operation.length === 0 ? '(no operation named)' : said}`,
        message: `${story} says it needs an interface ("Needs interface: ${oneLine(match[1] ?? '', 80)}") and no interface contract's own text contains ${operation.length === 0 ? 'a named operation of at least three characters' : `every word of "${said}"`}.`,
        remedy: `Name the operation in a contract under ${ctx.specsRoot}/${INTERFACES_DIR}/ (the freeze-contracts step does this), or correct the "Needs interface:" line in ${doc.path}.`,
      });
    }
    if (lines > 0) needing += 1;
    const context = frontMatter['context_refs'];
    if (Array.isArray(context)) {
      refs.push(
        ...context.filter(
          (item): item is string => typeof item === 'string' && INTERFACE_ID.test(item),
        ),
      );
    }
    for (const ref of [...new Set(refs)].sort(compare)) {
      references += 1;
      if ((byId.get(ref)?.length ?? 0) > 0) continue;
      unresolved += 1;
      violations.push({
        subject: `${story} -> ${oneLine(ref, 60)}`,
        message: `${story} references interface ${oneLine(ref, 60)}, which no interface contract defines.`,
        remedy: `Write the missing InterfaceContract under ${ctx.specsRoot}/${INTERFACES_DIR}/ (the freeze-contracts step does this), or remove the id from the story.`,
      });
    }
  }

  violations.sort((a, b) => compare(a.subject, b.subject) || compare(a.message, b.message));
  return {
    fields: {
      check: 'interfaces-frozen',
      contracts: byId.size,
      references,
      unresolved_refs: unresolved,
      stories_needing_interfaces: needing,
      needs_interface_lines: needLines,
      invalid_contracts: invalid,
      duplicate_ids: duplicates,
      undefined_refs: violations.length,
    },
    violations,
  };
}
