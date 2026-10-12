import "server-only";
import type { Tx } from "../db";
import { ValidationError } from "../errors";

// Friendly "is there enough?" check before a document moves counted stock. The database repeats the
// check at the moment of saving (with the stock locked) and has the final say.
export async function assertEnoughStock(
  tx: Tx, locationId: number | null, items: { name: string; productId: number; quantity: number }[],
): Promise<void> {
  const needed = new Map<number, { name: string; quantity: number }>();
  for (const i of items) {
    const n = needed.get(i.productId);
    needed.set(i.productId, { name: i.name, quantity: (n?.quantity ?? 0) + i.quantity });
  }
  if (needed.size === 0) return;

  const levels = await tx<{ productId: number; quantity: number }[]>`
    select product_id::int as "productId", quantity from stock_levels
    where location_id = ${locationId} and product_id in ${tx([...needed.keys()])}`;
  const have = new Map(levels.map((l) => [l.productId, l.quantity]));
  const short = [...needed].filter(([id, n]) => n.quantity > (have.get(id) ?? 0));
  if (short.length) {
    throw new ValidationError("Not enough stock: " +
      short.map(([id, n]) => `${n.name} (need ${n.quantity}, have ${have.get(id) ?? 0})`).join("; "));
  }
}

// A SIM inside a router travels with that router automatically, so it is never a line of its own.
// A loose SIM (e.g. sent abroad for the partner to configure) can be.
export async function assertSimNotInRouter(tx: Tx, simUnitId: number, serial: string): Promise<void> {
  const [inside] = await tx<{ router: string }[]>`
    select r.serial_number as router from sim_assignments a join units r on r.id = a.router_unit_id
    where a.sim_unit_id = ${simUnitId} and a.ended_at is null`;
  if (inside) throw new ValidationError(`SIM ${serial} is inside router ${inside.router} and travels with it — add the router instead`);
}
