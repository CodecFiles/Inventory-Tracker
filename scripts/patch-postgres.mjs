// Fixes a bug in postgres.js 3.4.9 (the latest version) after every install — `npm install` runs
// this as "postinstall", locally, on GitHub and on Vercel.
//
// The bug: when a connection is cut in the middle of a transaction (e.g. the Supabase pooler drops
// it), postgres.js still tries to write to the dead socket (an uncaught TypeError) and parks the
// dead connection, so every later query on that server hangs. Seen on staging 2026-10-13; reproduced
// and covered by tests/server/lost-connection.test.ts.
//
// The fix: a query on a closed connection fails at once with CONNECTION_CLOSED, and the connection
// stays in the pool's "closed" list, where the pool reconnects it for the next query.
//
// Written as a plain text replacement (not a diff) so it gives the same result whatever state the
// files are in — fresh, or already patched by an older version of this fix (Vercel reuses its
// cached node_modules between builds, which made a diff-based patch fail).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "3.4.9";
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "node_modules", "postgres");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (version !== VERSION) {
  console.error(`patch-postgres: expected postgres ${VERSION}, found ${version}. Check whether the bug is fixed upstream, then update or remove this script.`);
  process.exit(1);
}

const FIX = `    if (q.cancelled)
      return

    // MRD patch (scripts/patch-postgres.mjs): the connection closed (e.g. mid-transaction) and the
    // socket is gone. Fail this query now instead of writing to a null socket, and return true so
    // callers leave the connection in "closed", where the pool reconnects it.
    if (!socket) {
      queryError(q, Errors.connection('CONNECTION_CLOSED', options))
      return true
    }

    try {
      q.state = backend`;

// The original code, or the original plus any earlier version of the MRD patch
const TARGET = /    if \(q\.cancelled\)\n      return\n\n(?:    \/\/ MRD patch[\s\S]*?\n\n)?    try \{\n      q\.state = backend/;

for (const file of ["src/connection.js", "cjs/src/connection.js", "cf/src/connection.js"]) {
  const path = join(root, file);
  const code = readFileSync(path, "utf8");
  const matches = code.match(new RegExp(TARGET, "g")) ?? [];
  if (matches.length !== 1) {
    console.error(`patch-postgres: the code to patch was not found exactly once in ${file} (found ${matches.length}).`);
    process.exit(1);
  }
  const patched = code.replace(TARGET, FIX);
  if (patched !== code) writeFileSync(path, patched);
}
console.log(`patch-postgres: postgres ${VERSION} patched (lost connections fail cleanly)`);
