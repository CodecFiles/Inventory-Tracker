import "server-only";
import { getSql, withRetry, type Sql, type Tx } from "./db";
import { ForbiddenError, fromDatabaseError } from "./errors";

// Every action a person takes runs through withActor:
//   1. one transaction — all of the action's changes are saved together, or none are
//   2. the database is told who is acting (audit log + user-change rules read app.user_id)
//   3. the person must be an approved user
//
// userId must come from the verified login session (Stage 5.3), never from form input.

export async function withActor<T>(userId: string, action: (tx: Tx) => Promise<T>): Promise<T> {
  // A save is repeated after a lost connection only if its first step never got an answer: then
  // nothing was changed. Later on, the outcome is unknown (it may have been saved), so the error
  // is shown instead of risking a double entry.
  let started = false;
  try {
    return await withRetry(async () => {
      started = false;
      return (await getSql().begin(async (tx) => {
        // one round trip for both steps: the database is far away, so each extra query costs time
        const [user] = await tx`
          select set_config('app.user_id', ${userId}, true), (select status::text from users where id = ${userId}) as status`;
        started = true;
        if (user?.status !== "approved") {
          throw new ForbiddenError("Your account has not been approved yet");
        }
        return action(tx);
      })) as T;
    }, () => !started);
  } catch (error) {
    throw fromDatabaseError(error);
  }
}

// Reading changes nothing, so it needs no transaction and no app.user_id: one query checks the
// account is approved and has the permission, then the reading starts. (Each query is a round trip
// to the database, so this saves four per screen panel compared with withActor.)
export async function withReader<T>(userId: string, permission: string, action: (sql: Sql) => Promise<T>): Promise<T> {
  try {
    return await withRetry(async () => {   // reading twice is harmless
      const sql = getSql();
      const [row] = await sql`
        select (select status::text from users where id = ${userId}) as status, has_permission(${userId}, ${permission}) as allowed`;
      if (row?.status !== "approved") throw new ForbiddenError("Your account has not been approved yet");
      if (!row.allowed) throw new ForbiddenError(`You do not have permission: ${permission}`);
      return await action(sql);
    });
  } catch (error) {
    throw fromDatabaseError(error);
  }
}

// Asks the database's has_permission() — the same rules the tests in supabase/tests prove.
export async function requirePermission(tx: Tx, userId: string, permission: string): Promise<void> {
  const [row] = await tx`select has_permission(${userId}, ${permission}) as allowed`;
  if (!row?.allowed) {
    throw new ForbiddenError(`You do not have permission: ${permission}`);
  }
}

// Corrections can move anything anywhere, so they are for the Super Admin alone (not delegable).
export async function requireSuperAdmin(tx: Tx, userId: string): Promise<void> {
  const [row] = await tx`select role from users where id = ${userId} and status = 'approved'`;
  if (row?.role !== "super_admin") throw new ForbiddenError("Only a Super Admin can do this");
}
