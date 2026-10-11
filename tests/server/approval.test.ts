// Backend tests for approving and rejecting sign-ups (D1b, P1), against a real database.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSql } from "@/server/db";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { approveUser, listPendingUsers, rejectUser } from "@/server/users/approval";

const sql = getSql();

const SUPER = "6f1c2a3e-0000-4000-8000-0000000000f1";
const ADMIN = "6f1c2a3e-0000-4000-8000-0000000000f2";
const EDITOR = "6f1c2a3e-0000-4000-8000-0000000000f3";
const NEW1 = "6f1c2a3e-0000-4000-8000-0000000000f4";
const NEW2 = "6f1c2a3e-0000-4000-8000-0000000000f5";
const NEW3 = "6f1c2a3e-0000-4000-8000-0000000000f6";

beforeAll(async () => {
  // New sign-ups arrive through Supabase Auth; migration 0006 turns them into pending users.
  await sql`insert into auth.users (id, email, raw_user_meta_data) values
    (${SUPER}, 'appr-super@moonrock.om', '{"full_name":"Super"}'),
    (${ADMIN}, 'appr-admin@moonrock.om', '{"full_name":"Admin"}'),
    (${EDITOR}, 'appr-editor@moonrock.om', '{"full_name":"Editor"}'),
    (${NEW1}, 'tech1@gmail.com', '{"full_name":"Tech One"}'),
    (${NEW2}, 'tech2@gmail.com', '{"full_name":"Tech Two"}'),
    (${NEW3}, 'spam@example.com', '{"full_name":"Unknown"}')`;
  await sql`update users set status = 'approved', role = 'super_admin' where id = ${SUPER}`;
  await sql`update users set status = 'approved', role = 'admin' where id = ${ADMIN}`;
  await sql`update users set status = 'approved', role = 'editor' where id = ${EDITOR}`;
  await sql`insert into user_permissions (user_id, permission_key, granted_by) values (${ADMIN}, 'users.approve', ${SUPER})`;
});

afterAll(async () => {
  await sql.end();
});

const statusOf = async (id: string) =>
  (await sql`select status::text, role::text from users where id = ${id}`)[0] as { status: string; role: string | null };

describe("approving sign-ups", () => {
  it("new sign-ups appear in the pending list", async () => {
    const emails = (await listPendingUsers(SUPER)).map((p) => p.email);
    expect(emails).toEqual(expect.arrayContaining(["tech1@gmail.com", "tech2@gmail.com", "spam@example.com"]));
  });

  it("an Editor cannot see or approve the list", async () => {
    await expect(listPendingUsers(EDITOR)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(approveUser(EDITOR, { userId: NEW1, role: "viewer" })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await statusOf(NEW1)).status).toBe("pending");
  });

  it("an Admin with approval permission can approve someone as Editor", async () => {
    await approveUser(ADMIN, { userId: NEW1, role: "editor" });
    expect(await statusOf(NEW1)).toEqual({ status: "approved", role: "editor" });
  });

  it("an Admin cannot make someone an Admin (P1)", async () => {
    await expect(approveUser(ADMIN, { userId: NEW2, role: "admin" })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await statusOf(NEW2)).status).toBe("pending");
  });

  it("a Super Admin can make someone an Admin", async () => {
    await approveUser(SUPER, { userId: NEW2, role: "admin" });
    expect(await statusOf(NEW2)).toEqual({ status: "approved", role: "admin" });
  });

  it("someone already approved cannot be 'approved' again with a different role", async () => {
    await expect(approveUser(SUPER, { userId: NEW1, role: "viewer" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("a sign-up can be rejected, and is then out of the list", async () => {
    await rejectUser(ADMIN, NEW3);
    expect((await statusOf(NEW3)).status).toBe("rejected");
    expect((await listPendingUsers(SUPER)).map((p) => p.email)).not.toContain("spam@example.com");
  });

  it("the approval is recorded in the audit log with who approved", async () => {
    const [row] = await sql`select actor_id from audit_log
      where entity_type = 'users' and entity_id = ${NEW1} and after ->> 'status' = 'approved'`;
    expect(row.actor_id).toBe(ADMIN);
  });

  it("rejects malformed input", async () => {
    await expect(approveUser(SUPER, { userId: "not-a-uuid", role: "viewer" })).rejects.toBeInstanceOf(ValidationError);
    await expect(approveUser(SUPER, { userId: NEW1, role: "owner" })).rejects.toBeInstanceOf(ValidationError);
  });
});
