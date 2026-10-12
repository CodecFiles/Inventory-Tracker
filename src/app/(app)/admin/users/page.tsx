import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireApprovedUser } from "@/server/session";
import { approveUser, listPendingUsers, rejectUser } from "@/server/users/approval";

// Approve or reject people waiting for access. The server actions below re-check the signed-in
// user and their permission on every click — the page hiding buttons is not the security.

async function approve(formData: FormData) {
  "use server";
  const actor = await requireApprovedUser();
  try {
    await approveUser(actor.id, { userId: formData.get("userId"), role: formData.get("role") });
  } catch (e) {
    redirect("/admin/users?error=" + encodeURIComponent((e as Error).message));
  }
  revalidatePath("/admin/users");
}

async function reject(formData: FormData) {
  "use server";
  const actor = await requireApprovedUser();
  try {
    await rejectUser(actor.id, formData.get("userId"));
  } catch (e) {
    redirect("/admin/users?error=" + encodeURIComponent((e as Error).message));
  }
  revalidatePath("/admin/users");
}

export default async function AdminUsersPage({ searchParams }: PageProps<"/admin/users">) {
  const user = await requireApprovedUser();
  const { error } = await searchParams;

  let pending;
  try {
    pending = await listPendingUsers(user.id);
  } catch {
    return (
      <main className="main">
        <div className="alert err">You do not have permission to approve accounts.</div>
      </main>
    );
  }
  const canCreateAdmins = user.role === "super_admin";

  return (
    <main className="main">
      <div>
        <div className="ov">Users &amp; roles</div>
        <h1 className="h1">Accounts waiting for approval</h1>
        <p className="muted">New sign-ups can do nothing until they are approved with a role.</p>
      </div>
      {typeof error === "string" && <div role="alert" className="alert err">{error}</div>}
      <div className="card">
        {pending.length === 0 ? (
          <div className="empty">Nobody is waiting.</div>
        ) : (
          <div className="tw">
            <table className="tbl">
              <thead>
                <tr><th>Name</th><th>Email</th><th>Requested</th><th>Decision</th></tr>
              </thead>
              <tbody>
                {pending.map((p) => (
                  <tr key={p.id}>
                    <td>{p.fullName}</td>
                    <td>{p.email}</td>
                    <td>{p.createdAt.toISOString().slice(0, 10)}</td>
                    <td style={{ display: "flex", gap: 8 }}>
                      <form action={approve} style={{ display: "flex", gap: 8 }}>
                        <input type="hidden" name="userId" value={p.id} />
                        <select name="role" defaultValue="viewer" aria-label={`Role for ${p.fullName}`} className="fld" style={{ height: 32, width: "auto" }}>
                          <option value="viewer">Viewer (read only)</option>
                          <option value="editor">Editor (read + edit)</option>
                          {canCreateAdmins && <option value="admin">Admin</option>}
                        </select>
                        <button type="submit" className="btn sm p">Approve</button>
                      </form>
                      <form action={reject}>
                        <input type="hidden" name="userId" value={p.id} />
                        <button type="submit" className="btn sm dg">Reject</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
