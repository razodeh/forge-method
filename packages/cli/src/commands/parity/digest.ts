/**
 * `computeParityDeclarationDigest` — the sha256 that binds a capture to the declaration it was taken
 * against (`13` F-TEST-9): "a sha256 over the whole declaration in canonical form, except `review`,
 * `expires` and `unobservable`, joined with the content hashes of the files it overlays and the
 * bytes of the probes it names, so renewing a review does not invalidate a capture and changing
 * anything that determines what is observed, or how, does."
 *
 * **Why `review`/`expires`/`unobservable` are excluded.** Renewing a review (a new `by`/`basis`/`at`)
 * or pushing out `expires` is a human re-attesting to the SAME behaviour, never a change to what is
 * observed; excusing (or un-excusing) a surface via `unobservable` changes what gets COMPARED, not
 * what the surfaces that ARE compared mean. Binding the digest to any of the three would force a
 * pointless re-capture on every renewal — exactly the "renewing a review must not invalidate a
 * capture" guarantee the spec names.
 *
 * **The join algorithm is this module's own call** (`PLAN-M16.md` P2's own Mandate says so
 * explicitly): canonicalise the digestable fields, hash that once; feed in each overlay file's OWN
 * content hash (never its raw bytes — an overlay's digest-relevant fact is "these exact bytes are
 * what the harness copied in," which its own hash already states, so the final digest need not also
 * carry the bytes themselves) in a fixed, path-sorted order; feed in each probe's RAW bytes (not a
 * hash of them first) in the identical fixed order — this one, deliberate asymmetry mirrors the
 * declaration's own wording ("content hashes of the... files", "bytes of the probes") rather than
 * treating the two identically out of convenience. Sorting both lists by `path` makes the result
 * independent of the order a caller happens to pass them in, not only of the order the declaration's
 * own object keys enumerate (`QUALITY-BAR.md` R10).
 *
 * **Why each entry is canonical-JSON-encoded, never raw-delimited text.** This module does not, and
 * cannot, validate `DigestFile.path` itself (a caller-supplied identifier — see that type's own doc
 * comment); `paths.ts`'s own R11 checks, which DO apply to a declaration's `inputs`/`outputs` fields,
 * do not forbid a space or an embedded newline in a path segment. A first version of this function
 * joined entries as raw text (`` `overlay ${path} ${hash}\n` ``), which let a crafted `path`
 * reproduce another, structurally different (path, hash) list's exact bytes — found and reproduced
 * live by a fresh-context critic: `[{path:'a', hash:H}, {path:'b', hash:K}]` and
 * `[{path:'a H\\noverlay b', hash:K}]` both joined to the identical string
 * `"overlay a H\\noverlay b K\\n"`, so two declarations with genuinely different overlaid content
 * could carry the identical digest, defeating the one guarantee the whole oracle rests on. Each
 * entry below is instead fed in as `toCanonicalJson` of a small fixed-shape object: JSON's own
 * string escaping (every `"` and `\` inside a string value is escaped) makes the encoding of a
 * `{overlay, sha256}` or `{probe, bytes}` object self-delimiting — a crafted `path` can embed the
 * literal text of a false object boundary, but only in its ESCAPED form (`\"` or `\\`), never as the
 * UNESCAPED bytes a real boundary needs, so no value of `path` can make two different entries, or
 * entry lists, encode to the same bytes. The probe's raw bytes are fed in immediately after a header
 * that states their own length, so the stream is a standard length-prefixed framing, not a delimited
 * one: `JSON.stringify`-level escaping protects the header text, and an explicit byte count protects
 * the raw payload that follows it.
 *
 * @see specs/13 F-TEST-9
 * @see process/plans/PLAN-M16.md P2
 */
import { createHash } from 'node:crypto';

import type { CanonicalValue } from './canonical-json.ts';
import { toCanonicalJson } from './canonical-json.ts';
import type {
  NormalizeRule,
  ParityCase,
  ParityDeclaration,
  SurfaceDeclaration,
} from './declaration-types.ts';
import { SURFACE_KINDS } from './declaration-types.ts';

/** One overlaid file or probe the digest must bind to: `path` is only an identifier used to sort the
 * join into a fixed order (`QUALITY-BAR.md` R10) — it is never itself hashed or stored. */
export interface DigestFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function byPath(a: DigestFile, b: DigestFile): number {
  if (a.path < b.path) return -1;
  if (a.path > b.path) return 1;
  return 0;
}

function canonicalNormalizeRule(rule: NormalizeRule): CanonicalValue {
  if (rule.rule === 'ignore-json-pointers') {
    return { rule: rule.rule, pointers: [...rule.pointers] };
  }
  if (rule.rule === 'replace') {
    return {
      rule: rule.rule,
      pattern: rule.pattern,
      replacement: rule.replacement,
      stream: rule.stream,
      file: rule.file,
    };
  }
  return { rule: rule.rule };
}

function canonicalCase(parityCase: ParityCase): CanonicalValue {
  return {
    args: parityCase.args === undefined ? undefined : [...parityCase.args],
    inputs:
      parityCase.inputs === undefined
        ? undefined
        : parityCase.inputs.map((input) => ({ from: input.from, to: input.to })),
    outputs:
      parityCase.outputs === undefined
        ? undefined
        : parityCase.outputs.map((output) => ({ path: output.path, mode: output.mode })),
    normalize:
      parityCase.normalize === undefined
        ? undefined
        : parityCase.normalize.map(canonicalNormalizeRule),
    timeoutMs: parityCase.timeoutMs,
    outputCapBytes: parityCase.outputCapBytes,
    expect: parityCase.expect,
  };
}

function canonicalSurface(surface: SurfaceDeclaration): CanonicalValue {
  return {
    run: surface.run,
    setup: surface.setup === undefined ? undefined : [...surface.setup],
    streams: surface.streams === undefined ? undefined : [...surface.streams],
    network: surface.network,
    stability: { runs: surface.stability.runs },
    cases: surface.cases.map(canonicalCase),
  };
}

/**
 * The declaration fields `13` F-TEST-9 digests — every field EXCEPT `review`, `expires` and
 * `unobservable` — rebuilt as a plain {@link CanonicalValue} tree (never the typed `ParityDeclaration`
 * itself passed through a cast: every field is named here explicitly, so a field this function
 * forgets to carry is a visible omission in a diff, not a silent `as` that happened to compile).
 *
 * Exported so a test can assert directly on what is, and is not, in the digested shape, independent
 * of the hashing in {@link computeParityDeclarationDigest}.
 */
export function digestableDeclarationFields(declaration: ParityDeclaration): CanonicalValue {
  const surfaces: Record<string, CanonicalValue | undefined> = {};
  for (const kind of SURFACE_KINDS) {
    const surface = declaration.surfaces[kind];
    if (surface !== undefined) surfaces[kind] = canonicalSurface(surface);
  }
  return {
    name: declaration.name,
    reference: { ref: declaration.reference.ref },
    surfaces,
  };
}

/**
 * The declaration's own digest: a sha256 over its canonical, digestable fields, joined with every
 * overlay file's content hash and every probe's raw bytes, both in a fixed path-sorted order. See
 * this module's own doc comment for the algorithm and why it is shaped this way.
 *
 * `overlays`/`probes` default to empty: a declaration with no case that overlays anything, and no
 * `library` surface, digests from its own fields alone.
 */
export function computeParityDeclarationDigest(
  declaration: ParityDeclaration,
  overlays: readonly DigestFile[] = [],
  probes: readonly DigestFile[] = [],
): string {
  const hasher = createHash('sha256');
  hasher.update('forge-parity-declaration-digest/v2\n', 'utf8');
  hasher.update(sha256Hex(toCanonicalJson(digestableDeclarationFields(declaration))));
  hasher.update('\n', 'utf8');
  for (const overlay of [...overlays].sort(byPath)) {
    // Self-delimiting: see this module's own doc comment for why a canonical-JSON object, not
    // raw-delimited text, is what makes this entry unable to collide with a different one.
    hasher.update(
      toCanonicalJson({ overlay: overlay.path, sha256: sha256Hex(overlay.bytes) }),
      'utf8',
    );
  }
  for (const probe of [...probes].sort(byPath)) {
    // Length-prefixed: the header states exactly how many raw bytes follow it, so the boundary
    // between this probe's payload and the next entry's own header is never ambiguous.
    hasher.update(toCanonicalJson({ probe: probe.path, bytes: probe.bytes.length }), 'utf8');
    hasher.update(probe.bytes);
  }
  return hasher.digest('hex');
}
