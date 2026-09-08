/** A deterministic content hash for a regenerable file — `03` §3.3's own header needs a real,
 * verifiable `hash=<sha>`, and a hand-modified copy must produce a different one on the next run. */
import { createHash } from 'node:crypto';

export function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
