/**
 * `INJECTION_PATTERNS`, `SECRET_PATTERNS` — the concrete content `15` §15.4.5/§15.10's I9 name by
 * example, shared (not re-derived) by this piece's own `validateSkill` and `PLAN-M2.md` P8's I9
 * invariant, so the two can never drift into checking two different things under the same name.
 *
 * @see specs/15 §15.4.5
 * @see specs/15 §15.10
 * @see PLAN-M2.md P4
 */

/**
 * `15` §15.10's I9 paragraph names these by example: "patterns like 'ignore previous instructions',
 * 'you may write to', 'approve the gate', `FORGE_*` tokens." Case-insensitive, since prompt-injection
 * text has no reason to respect casing.
 */
export const INJECTION_PATTERNS: readonly RegExp[] = [
  /ignore (all )?previous instructions/i,
  /you may write to/i,
  /approve the gate/i,
  /\bFORGE_[A-Z_]+\b/,
];

/**
 * Well-known secret shapes, per `15` §15.4.5's "no secrets" line — a bounded, named set of concrete
 * patterns real secret-scanning tools flag, not an entropy heuristic: `15` gives no spec source for a
 * broader rule, and guessing one would be exactly the kind of invented scope this project's own
 * calibration notes (`GAUNTLET-LOG.md`) warn against.
 */
export const SECRET_PATTERNS: readonly RegExp[] = [
  /AKIA[0-9A-Z]{16}/, // AWS access key id
  /ghp_[A-Za-z0-9]{36}/, // GitHub personal access token
  /xox[baprs]-[A-Za-z0-9-]{10,}/, // Slack token
  /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, // PEM private key block
  /Bearer\s+[A-Za-z0-9\-_.]{20,}/, // a literal bearer token, not a ${secret:...} reference
];
