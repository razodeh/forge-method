#!/usr/bin/env node
'use strict';

/**
 * `02` §2.7's own literal requirement: "Node engine check with a friendly message before any import
 * that requires modern syntax (use a tiny CJS preflight shim)." This file is that shim — the real
 * `bin` target this package's own `package.json` now points at, instead of `dist/forge.mjs` directly.
 *
 * Deliberately plain CommonJS, ES5-only syntax (`var`, no arrow functions, no template literals, no
 * optional chaining, no destructuring): the whole point is that this file must itself *parse* on a
 * Node runtime too old to run the real, modern-syntax bundle it guards — a syntax error in the guard
 * itself would defeat it, producing the identical unfriendly parse-error stack trace `02` §2.7 asks
 * this shim to prevent. Found missing entirely by a round-2 critic on `PLAN-M12.md` P8 (its own first
 * pass covered the publish *decision* and the build/bundling mechanics but missed this one further,
 * concrete §2.7 requirement) — see `SPEC-QUESTIONS.md` Q189.
 *
 * `parseNodeVersion`/`isTooOld`/`friendlyMessage` are exported (plain `module.exports`, no ES2015
 * `export`) so `test/preflight.test.ts` can exercise the real decision logic directly, in-process, with
 * no risk of a real `process.exit(1)` call inside a test worker — the entry-point side effects below
 * (the version check and the real dynamic `import()`) only run when this file is Node's own actual
 * entry point (`require.main === module`), exactly the same guard a plain CommonJS script uses to stay
 * safely `require()`-able as a library from a test.
 */

var REQUIRED_MAJOR = 20;
var REQUIRED_MINOR = 19;

function parseNodeVersion(raw) {
  var parts = raw.replace(/^v/, '').split('.');
  return {
    major: parseInt(parts[0], 10),
    minor: parseInt(parts[1], 10),
  };
}

function isTooOld(version) {
  return (
    version.major < REQUIRED_MAJOR ||
    (version.major === REQUIRED_MAJOR && version.minor < REQUIRED_MINOR)
  );
}

function friendlyMessage(rawVersion) {
  // Plain string concatenation, not a template literal, for the identical reason the rest of this
  // file avoids modern syntax: this branch must run correctly on the exact runtimes it exists to catch.
  return (
    'forge-method requires Node.js >= ' +
    REQUIRED_MAJOR +
    '.' +
    REQUIRED_MINOR +
    ', but this process is running Node.js ' +
    rawVersion +
    '.\n' +
    'Install a supported Node.js version (https://nodejs.org) and try again.'
  );
}

module.exports = {
  REQUIRED_MAJOR: REQUIRED_MAJOR,
  REQUIRED_MINOR: REQUIRED_MINOR,
  parseNodeVersion: parseNodeVersion,
  isTooOld: isTooOld,
  friendlyMessage: friendlyMessage,
};

if (require.main === module) {
  var current = parseNodeVersion(process.version);
  if (isTooOld(current)) {
    console.error(friendlyMessage(process.version));
    process.exit(1);
  }

  // Past this point, the running Node is new enough for the real, modern-syntax bundle — a dynamic
  // `import()` (valid in CommonJS, unlike a static `import`) loads it. `dist/forge.mjs` sets
  // `process.exitCode` itself (never calls `process.exit` directly, so buffered stdio always flushes
  // first) and its own top-level `await main()` means this returned promise does not resolve until
  // that work is fully done — Node's normal event-loop-drain exit then uses the real, already-set code.
  import(require('node:path').join(__dirname, '..', 'dist', 'forge.mjs')).catch(function (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}
