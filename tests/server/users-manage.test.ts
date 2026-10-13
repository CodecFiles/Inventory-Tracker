// Backend tests for managing users: who may list and change people, roles, disabling, and the
// permissions a Super Admin gives an Admin.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSql } from "@/server/db";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { changeUserRole, listUsers, setAdminPermission, setUserDisabled } from "@/server/users/manage";

const sql = getSql();
const SUPER = "6f1c2a3e-0000-4000-8000-0000000008a1";
const ADMIN = "6f1c2a3e-0000-4000-8000-0000000008a2";
const EDITOR = "6f1c2a3e-0000-4000-8000-0000000008a3";
const VIEWER = "6f1c2a3e-0000-4000-8000-0000000008a4";
const allowed = async (id: string, key: string) =>
  (await sql`select has_permission(${id}, ${key}) as ok`)[0].ok as boolean;
const statusOf = async (id: string) => (await sql`select status::text, role::text from users where id = ${id}`)[0];

beforeAll(async () => {
  await sql`insert into auth.users (id) values (${SUPER}), (${ADMIN}), (${EDITOR}), (${VIEWER})`;
  await sql`insert into users (id, email, full_name, role, status) values
    (${SUPER}, 'um-super@moonrock.om', 'UM Super', 'super_admin', 'approved'),
    (${ADMIN}, 'um-admin@moonrock.om', 'UM Admin', 'admin', 'approved'),
    (${EDITOR}, 'um-editor@moonrock.om', 'UM Editor', 'editor', 'approved'),
    (${VIEWER}, 'um-viewer@gmail.com', 'UM Viewer', 'viewer', 'approved')`;
});

afterAll(async () => {
  await sql.end();
});

describe("who may manage users", () => {
  it("an Editor cannot even list users", async () => {
    await expect(listUsers(EDITOR)).rejects.toThrow(ForbiddenError);
  });

  it("a Super Admin sees everyone and the permission catalogue", async () => {
    const { users, permissions } = await listUsers(SUPER);
    expect(users.map((u) => u.email)).toEqual(expect.arrayContaining(["um-admin@moonrock.om", "um-viewer@gmail.com"]));
    expect(permissions.map((p) => p.key)).toContain("users.manage");
  });

  it("an Admin without 'users.manage' cannot change roles", async () => {
    await expect(changeUserRole(ADMIN, { userId: VIEWER, role: "editor" })).rejects.toThrow(ForbiddenError);
  });
});

describe("Admin permissions (given by a Super Admin)", () => {
  it("a Super Admin gives an Admin 'users.manage'; it works at once", async () => {
    expect(await allowed(ADMIN, "users.manage")).toBe(false);
    await setAdminPermission(SUPER, { userId: ADMIN, permission: "users.manage", granted: true });
    expect(await allowed(ADMIN, "users.manage")).toBe(true);
  });

  it("an Admin cannot give permissions", async () => {
    await expect(setAdminPermission(ADMIN, { userId: ADMIN, permission: "audit.view", granted: true })).rejects.toThrow(ForbiddenError);
  });

  it("that Admin can now switch a Viewer to Editor — but cannot create Admins", async () => {
    await changeUserRole(ADMIN, { userId: VIEWER, role: "editor" });
    expect((await statusOf(VIEWER)).role).toBe("editor");
    await expect(changeUserRole(ADMIN, { userId: VIEWER, role: "admin" })).rejects.toThrow(ForbiddenError);
    await changeUserRole(ADMIN, { userId: VIEWER, role: "viewer" });
  });

  it("nobody changes their own role", async () => {
    await expect(changeUserRole(ADMIN, { userId: ADMIN, role: "editor" })).rejects.toThrow(ForbiddenError);
  });
});

describe("disabling", () => {
  it("disable and enable again; the person is never deleted", async () => {
    await setUserDisabled(ADMIN, { userId: VIEWER, disabled: true });
    expect(await statusOf(VIEWER)).toEqual({ status: "disabled", role: "viewer" });
    expect(await allowed(VIEWER, "reports.view")).toBe(false);
    await expect(changeUserRole(ADMIN, { userId: VIEWER, role: "editor" })).rejects.toThrow(/approve or enable/);
    await setUserDisabled(ADMIN, { userId: VIEWER, disabled: false });
    expect(await statusOf(VIEWER)).toEqual({ status: "approved", role: "viewer" });
  });

  it("an Admin cannot disable a Super Admin", async () => {
    await expect(setUserDisabled(ADMIN, { userId: SUPER, disabled: true })).rejects.toThrow(ForbiddenError);
  });

  it("enabling someone who is not disabled is refused", async () => {
    await expect(setUserDisabled(SUPER, { userId: EDITOR, disabled: false })).rejects.toThrow(ValidationError);
  });

  it("demoting an Admin removes their individual permissions", async () => {
    await changeUserRole(SUPER, { userId: ADMIN, role: "editor" });
    const [{ n }] = await sql`select count(*)::int as n from user_permissions where user_id = ${ADMIN}`;
    expect(n).toBe(0);
  });
});
