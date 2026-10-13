// A connection must never have two queries in flight at once ("pipelining"): Supabase's transaction
// pooler can lose the answer to a pipelined query and the page then waits forever (staging,
// 2026-10-13). A relay between the app and PostgreSQL reads the protocol and records, per
// connection, how many queries were sent before the database said it was ready again.
import net from "node:net";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SUPER = "6f1c2a3e-0000-4000-8000-0000000011c1";
const direct = postgres({ onnotice: () => {} });

// Splits a byte stream into PostgreSQL protocol messages and calls `seen` with each message type.
// The app's first message (startup) has no type byte.
function messages(seen: (type: string) => void, startup: boolean) {
  let buffer = Buffer.alloc(0);
  let first = startup;
  return (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      if (first) {
        if (buffer.length < 4) return;
        const length = buffer.readInt32BE(0);
        if (buffer.length < length) return;
        buffer = buffer.subarray(length);
        first = false;
        continue;
      }
      if (buffer.length < 5) return;
      const length = buffer.readInt32BE(1);
      if (buffer.length < 1 + length) return;
      seen(String.fromCharCode(buffer[0]));
      buffer = buffer.subarray(1 + length);
    }
  };
}

let mostInFlight = 0;
const relay = net.createServer((app) => {
  const db = net.connect({ path: `${process.env.PGHOST ?? "/tmp"}/.s.PGSQL.${process.env.PGPORT ?? "5432"}` });
  let inFlight = 0;            // queries sent (Sync / simple Query) minus answers finished (ReadyForQuery)
  let started = false;         // the server's first ReadyForQuery ends the login, not a query
  const fromApp = messages((type) => {
    if (type === "S" || type === "Q") mostInFlight = Math.max(mostInFlight, ++inFlight);
  }, true);
  app.on("data", (chunk) => { fromApp(chunk); db.write(chunk); });
  const fromDb = messages((type) => {
    if (type !== "Z") return;
    if (started) inFlight--;
    started = true;
  }, false);
  db.on("data", (chunk) => { fromDb(chunk); app.write(chunk); });
  app.on("error", () => db.destroy());
  db.on("error", () => app.destroy());
  app.on("close", () => db.destroy());
  db.on("close", () => app.destroy());
});

beforeAll(async () => {
  await new Promise<void>((resolve) => relay.listen(0, "127.0.0.1", resolve));
  const { port } = relay.address() as net.AddressInfo;
  // a small pool, so the many requests below compete for connections
  (globalThis as { mrdSql?: unknown }).mrdSql = postgres({
    host: "127.0.0.1", port, database: process.env.PGDATABASE, prepare: false, max: 2, onnotice: () => {},
  });
  await direct`insert into auth.users (id) values (${SUPER})`;
  await direct`insert into users (id, email, full_name, role, status)
               values (${SUPER}, 'no-pipe@moonrock.om', 'No Pipelining', 'super_admin', 'approved')`;
});

afterAll(async () => {
  await (globalThis as { mrdSql?: postgres.Sql }).mrdSql?.end();
  await direct.end();
  relay.close();
});

describe("database work never pipelines queries on one connection", () => {
  it("many pages' worth of reads and a save at the same time: at most one query in flight per connection", async () => {
    const { dashboardPanels } = await import("@/server/queries/dashboard");
    const { dashboardSummary, listUnits, stockOverview } = await import("@/server/queries/inventory");
    const { lookups } = await import("@/server/queries/places");
    const { getPermissions } = await import("@/server/session");
    const { createRecord } = await import("@/server/catalogue/catalogue");
    await Promise.all(Array.from({ length: 6 }, (_, i) => [
      dashboardPanels(SUPER), dashboardSummary(SUPER), stockOverview(SUPER), listUnits(SUPER, {}),
      lookups(SUPER), getPermissions(SUPER), createRecord(SUPER, "category", { name: `No pipelining ${i}` }),
    ]).flat());
    expect(mostInFlight).toBeGreaterThan(0);   // the relay really saw the queries
    expect(mostInFlight).toBe(1);
  });
});
