/**
 * A minimal, real caller around `isSupportedNodeVersion`: prints the ENV-005 message and exits 5
 * when unsupported, exits 0 otherwise. `argv[2]` is the `process.version`-shaped string to check —
 * passed explicitly rather than read from the real `process.version`, since a subprocess cannot
 * genuinely run under an old Node just to be tested (see `../node-version.subprocess.test.ts`'s own
 * doc comment for why this is still a real, unmocked check).
 */
import { ForgeError } from '@forge/core/errors';

import { isSupportedNodeVersion, MIN_NODE_VERSION } from '../../../src/entry/node-version.ts';

const candidate = process.argv[2] ?? '';

if (!isSupportedNodeVersion(candidate)) {
  const error = new ForgeError('ENV-005', { required: MIN_NODE_VERSION, actual: candidate });
  process.stderr.write(`${error.message}\n`);
  process.exit(5);
}

process.stdout.write('OK\n');
process.exit(0);
