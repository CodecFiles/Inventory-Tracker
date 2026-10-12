import "server-only";
import { getSql, type Tx } from "./db";
import { ForbiddenError, fromDatabaseError } from "./errors";

// Every action a person takes runs through withActor:
//   1. one transaction — all of the action's changes are saved together, or none are
//   2. the database is told who is acting (audit log + user-change rules read app.user_id)
//   3. the person must be an approved user
//
// userId must come from the verified login session (Stage 5.3), never from form input.

export async function withActor<T>(userId: string, action: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return (await getSql().begin(async (tx) => {
      await tx`select set_config('app.user_id', ${userId}, true)`;
      const [user] = await tx`select status from users where id = ${userId}`;
      if (!user || user.status !== "approved") {
        throw new ForbiddenError("Your account has not been approved yet");
      }
      return action(tx);
    })) as T;
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
