/**
 * `KB_SECTIONS`, `sectionIdToken` — `08` §8.2's eight KB subdirectories plus `glossary` (its own
 * root-level pseudo-section — see `SPEC-QUESTIONS.md` Q51), and the short uppercase token each one's
 * own `KB-{SECTION}-####` id embeds.
 *
 * Only four of these nine tokens are directly evidenced by a real id in the spec pack
 * (`grep -rohn "KB-[A-Z]+-[0-9]+" specs/*.md`): `product`→`PROD`, `architecture`→`ARCH`,
 * `data`→`DATA`, `constraints`→`CON` (three letters, not four — confirming this is a hand-chosen
 * table, not a fixed-width rule derivable mechanically). The other five have no spec-pack precedent
 * at all and are this piece's own reasonable choice, flagged below — see `SPEC-QUESTIONS.md` Q51.
 *
 * @see specs/08 §8.2
 * @see specs/08 §8.3
 * @see SPEC-QUESTIONS.md Q51
 */

export const KB_SECTIONS = [
  'product',
  'constraints',
  'architecture',
  'domain',
  'data',
  'delivery',
  'ops',
  'engineering',
  'glossary',
] as const;

export type KbSection = (typeof KB_SECTIONS)[number];

/** Spec-confirmed (see this file's doc comment): `product`, `constraints`, `architecture`, `data`. */
const SECTION_ID_TOKENS: Record<KbSection, string> = {
  product: 'PROD',
  constraints: 'CON',
  architecture: 'ARCH',
  // Not spec-confirmed — this piece's own choice; see SPEC-QUESTIONS.md Q51.
  domain: 'DOM',
  data: 'DATA',
  delivery: 'DELIV',
  ops: 'OPS',
  engineering: 'ENG',
  glossary: 'GLOSS',
};

/** The uppercase token `section`'s own `KB-{token}-####` id embeds. */
export function sectionIdToken(section: KbSection): string {
  return SECTION_ID_TOKENS[section];
}

/** The section whose own token is `token` (case-sensitive, as ids themselves are), or `undefined` if
 * no registered section uses it — `@forge/kb/write`'s `KbIdAllocator` scan reads this back off a raw
 * id's own embedded token. */
export function sectionForIdToken(token: string): KbSection | undefined {
  return KB_SECTIONS.find((section) => SECTION_ID_TOKENS[section] === token);
}
