import "server-only";
import { z } from "zod";
import { requirePermission, withActor } from "../actor";
import { ForbiddenError, ValidationError } from "../errors";

// Approving and rejecting sign-ups (D1b, P1).
// Admins with "users.approve" may approve people as Editor or Viewer; only a Super Admin may create
// Admins. The database enforces the same rules (migration 0005) — this is the first layer.

export type PendingUser = { id: string; email: string; fullName: string; createdAt: Date };

export async function listPendingUsers(actorId: string): Promise<PendingUser[]> {
  return withActor(actorId, async (tx) => {
    await requirePermission(tx, actorId, "users.approve");
    return tx<PendingUser[]>`
      select id, email, full_name as "fullName", created_at as "createdAt"
      from users where status = 'pending' order by created_at`;
  });
}

const ApproveInput = z.object({
  userId: z.uuid(),
  role: z.enum(["super_admin", "admin", "editor", "viewer"]),
});

export async function approveUser(actorId: string, rawInput: unknown): Promise<void> {
  const parsed = ApproveInput.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError("Choose a valid user and role");
  const { userId, role } = parsed.data;

  await withActor(actorId, async (tx) => {
    await requirePermission(tx, actorId, "users.approve");
    const [actor] = await tx`select role::text as role from users where id = ${actorId}`;
    if ((role === "admin" || role === "super_admin") && actor.role !== "super_admin") {
      throw new ForbiddenError("Only a Super Admin can make someone an Admin");
    }
    const updated = await tx`
      update users set status = 'approved', role = ${role}
      where id = ${userId} and status = 'pending'`;
    if (updated.count === 0) throw new ValidationError("This person is not waiting for approval");
  });
}

export async function rejectUser(actorId: string, rawUserId: unknown): Promise<void> {
  const parsed = z.uuid().safeParse(rawUserId);
  if (!parsed.success) throw new ValidationError("Choose a valid user");

  await withActor(actorId, async (tx) => {
    await requirePermission(tx, actorId, "users.approve");
    const updated = await tx`
      update users set status = 'rejected' where id = ${parsed.data} and status = 'pending'`;
    if (updated.count === 0) throw new ValidationError("This person is not waiting for approval");
  });
}
