// A database connection that dies under us (seen on Vercel: "write CONNECTION_CLOSED … pooler…").
// A small relay sits between the app and PostgreSQL and cuts the connection at a chosen moment,
// the way a pooler drops a connection while the hosted function is paused.
//   - reads are tried again on a fresh connection, so the page still opens
//   - a save cut before anything reached the database is tried again and saved exactly once
//   - a save cut half-way is NOT repeated (it might have been saved); it fails and nothing is kept
import net from "node:net";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ADMIN = "6f1c2a3e-0000-4000-8000-0000000010c1";
const direct = postgres({ onnotice: () => {} });   // for setting up and checking, not through the relay

// The relay: forwards bytes both ways; when armed, the first message from the app that contains
// the chosen text (e.g. "begin", "insert into") kills the connection instead of reaching PostgreSQL.
let cutOn: string | null = null;
const relay = net.createServer((app) => {
  const db = net.connect({ path: `${process.env.PGHOST ?? "/tmp"}/.s.PGSQL.${process.env.PGPORT ?? "5432"}` });
  app.on("data", (chunk) => {
    if (cutOn !== null && chunk.toString("latin1").includes(cutOn)) {
      cutOn = null;
      app.destroy();
      db.destroy();
      return;
    }
    db.write(chunk);
  });
  db.on("data", (chunk) => app.write(chunk));
  app.on("error", () => db.destroy());
  db.on("error", () => app.destroy());
  app.on("close", () => db.destroy());
  db.on("close", () => app.destroy());
});
const cutWhenSending = (text: string) => { cutOn = text; };

let readStock: typeof import("@/server/queries/inventory").stockOverview;
let createRecord: typeof import("@/server/catalogue/catalogue").createRecord;

beforeAll(async () => {
  await new Promise<void>((resolve) => relay.listen(0, "127.0.0.1", resolve));
  const { port } = relay.address() as net.AddressInfo;
  // the app's shared pool goes through the relay (db.ts reuses an existing global pool)
  (globalThis as { mrdSql?: unknown }).mrdSql = postgres({
    // the user and database come from the same PG* settings as every other test
    host: "127.0.0.1", port, database: process.env.PGDATABASE, prepare: false, max: 1, onnotice: () => {},
  });
  await direct`insert into auth.users (id) values (${ADMIN})`;
  await direct`insert into users (id, email, full_name, role, status)
               values (${ADMIN}, 'lost-conn@moonrock.om', 'Lost Connection', 'super_admin', 'approved')`;
  ({ stockOverview: readStock } = await import("@/server/queries/inventory"));
  ({ createRecord } = await import("@/server/catalogue/catalogue"));
  await readStock(ADMIN);   // opens the one connection
});

afterAll(async () => {
  await (globalThis as { mrdSql?: postgres.Sql }).mrdSql?.end();
  await direct.end();
  relay.close();
});

const categories = async (name: string) => (await direct`select count(*)::int as n from categories where name = ${name}`)[0].n;

describe("a connection lost under a request", () => {
  it("a read is tried again and works", async () => {
    cutWhenSending("has_permission");   // the first query of a read
    await expect(readStock(ADMIN)).resolves.toBeInstanceOf(Array);
    expect(cutOn).toBeNull();   // the cut really happened
  });

  it("a save cut before anything reached the database is tried again and saved once", async () => {
    cutWhenSending("begin");   // nothing has reached the database yet
    await createRecord(ADMIN, "category", { name: "Lost conn early" });
    expect(cutOn).toBeNull();   // the cut really happened
    expect(await categories("Lost conn early")).toBe(1);
  });

  it("a save cut half-way is not repeated: it fails and nothing is kept", async () => {
    cutWhenSending("insert into");   // begun, and who is acting already recorded
    await expect(createRecord(ADMIN, "category", { name: "Lost conn late" })).rejects.toThrow();
    expect(cutOn).toBeNull();   // the cut really happened
    expect(await categories("Lost conn late")).toBe(0);
    await expect(readStock(ADMIN)).resolves.toBeInstanceOf(Array);   // and the next request works
  });
});
