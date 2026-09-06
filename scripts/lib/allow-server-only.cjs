/**
 * Let an operator script import modules marked `server-only`.
 *
 * `src/lib/security/crypto.ts` and `src/lib/env.ts` both start with
 * `import "server-only"`. That package throws on import outside a React Server
 * Component build, which is exactly what we want in the application: it is the
 * guard that stops a module holding encryption keys from being pulled into a
 * client bundle.
 *
 * A migration script is neither a server component nor a client bundle. It is
 * a one-off Node process run by an operator on a trusted machine, and it needs
 * the very functions the guard protects — encryptSecret, activeEncryptionKey.
 * Without this shim `npx tsx scripts/migrate-owner-data.ts` dies on its first
 * import, before printing anything.
 *
 * The shim is deliberately narrow: it neutralises exactly one module specifier
 * and leaves every other import alone, so nothing else about the guard
 * changes. Load it with `tsx --require`, never from application code.
 */
const Module = require("node:module");

const load = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return load.call(this, request, parent, isMain);
};
