import "server-only";
import { z } from "zod";
import { requirePermission, requireSuperAdmin, withActor } from "../actor";
import type { Tx } from "../db";
import { ForbiddenError, parseInput, ValidationError } from "../errors";

// Managing people after approval (D8, P1):
//   listUsers        — everyone, with role, status and (for Admins) their individual permissions
//   changeUserRole   — Editor ↔ Viewer for "users.manage"; anything involving Admins: Super Admin only
//   setUserDisabled  — disable (they can no longer use the app) or enable again; never deleted
//   setAdminPermission — a Super Admin gives an Admin one permission, or takes it back
// The database repeats the important rules (migration 0005): nobody changes their own role or
// status, only a Super Admin touches Admins, and the last Super Admin cannot be demoted or disabled.

export type UserRow = {
  id: string; email: string; fullName: string; role: string | null; status: string; createdAt: Date;
  approvedAt: Date | null; approvedBy: string | null; permissions: string[];
};
export type PermissionInfo = { key: string; description: string };

async function requireUserAdmin(tx: Tx, actorId: string) {
  const [row] = await tx<{ ok: boolean }[]>`
    select has_permission(${actorId}, 'users.manage') or has_permission(${actorId}, 'users.approve') as ok`;
  if (!row?.ok) throw new ForbiddenError("You do not have permission to manage users");
}

export async function listUsers(actorId: string): Promise<{ users: UserRow[]; permissions: PermissionInfo[] }> {
  return withActor(actorId, async (tx) => {
    await requireUserAdmin(tx, actorId);
    const users = await tx<UserRow[]>`
      select u.id, u.email, u.full_name as "fullName", u.role::text as role, u.status::text as status,
             u.created_at as "createdAt", u.approved_at as "approvedAt", a.full_name as "approvedBy",
             coalesce((select array_agg(up.permission_key order by up.permission_key) from user_permissions up
                       where up.user_id = u.id), '{}') as permissions
      from users u left join users a on a.id = u.approved_by
      order by case u.status when 'pending' then 0 when 'approved' then 1 else 2 end, u.full_name`;
    const permissions = await tx<PermissionInfo[]>`select key, description from permissions order by key`;
    return { users, permissions };
  });
}

const userId = z.uuid();

export async function changeUserRole(actorId: string, rawInput: unknown): Promise<void> {
  const input = parseInput(z.object({ userId, role: z.enum(["super_admin", "admin", "editor", "viewer"]) }), rawInput);
  await withActor(actorId, async (tx) => {
    await requirePermission(tx, actorId, "users.manage");
    const [target] = await tx<{ status: string }[]>`select status::text from users where id = ${input.userId}`;
    if (!target) throw new ValidationError("That user does not exist");
    if (target.status !== "approved") throw new ValidationError("Only an approved user's role can change — approve or enable them first");
    await tx`update users set role = ${input.role} where id = ${input.userId}`;
    // permissions given to an Admin mean nothing for another role; take them away
    if (input.role !== "admin") await tx`delete from user_permissions where user_id = ${input.userId}`;
  });
}

export async function setUserDisabled(actorId: string, rawInput: unknown): Promise<void> {
  const input = parseInput(z.object({ userId, disabled: z.boolean() }), rawInput);
  await withActor(actorId, async (tx) => {
    await requirePermission(tx, actorId, "users.manage");
    const [target] = await tx<{ status: string; role: string | null }[]>`
      select status::text, role::text from users where id = ${input.userId}`;
    if (!target) throw new ValidationError("That user does not exist");
    if (input.disabled) {
      if (target.status !== "approved") throw new ValidationError("Only an active user can be disabled");
      await tx`update users set status = 'disabled' where id = ${input.userId}`;
    } else {
      if (target.status !== "disabled") throw new ValidationError("This user is not disabled");
      if (!target.role) throw new ValidationError("This user has no role; approve them instead");
      await tx`update users set status = 'approved' where id = ${input.userId}`;
    }
  });
}

export async function setAdminPermission(actorId: string, rawInput: unknown): Promise<void> {
  const input = parseInput(z.object({ userId, permission: z.string().regex(/^[a-z_]+\.[a-z_]+$/), granted: z.boolean() }), rawInput);
  await withActor(actorId, async (tx) => {
    await requireSuperAdmin(tx, actorId);
    if (input.granted) {
      await tx`insert into user_permissions (user_id, permission_key, granted_by)
               values (${input.userId}, ${input.permission}, ${actorId}) on conflict do nothing`;
    } else {
      await tx`delete from user_permissions where user_id = ${input.userId} and permission_key = ${input.permission}`;
    }
  });
}
