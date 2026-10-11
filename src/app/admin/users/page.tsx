import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireApprovedUser } from "@/server/session";
import { approveUser, listPendingUsers, rejectUser } from "@/server/users/approval";
import styles from "../../auth.module.css";

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
      <main className={styles.page}>
        <p>You do not have permission to approve accounts.</p>
        <Link href="/">Back</Link>
      </main>
    );
  }
  const canCreateAdmins = user.role === "super_admin";

  return (
    <main style={{ padding: 24 }}>
      <h1>Accounts waiting for approval</h1>
      {typeof error === "string" && <p className={styles.error}>{error}</p>}
      {pending.length === 0 ? (
        <p>Nobody is waiting.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr><th>Name</th><th>Email</th><th>Requested</th><th>Decision</th></tr>
          </thead>
          <tbody>
            {pending.map((p) => (
              <tr key={p.id}>
                <td>{p.fullName}</td>
                <td>{p.email}</td>
                <td>{p.createdAt.toISOString().slice(0, 10)}</td>
                <td>
                  <form action={approve} className={styles.inline}>
                    <input type="hidden" name="userId" value={p.id} />
                    <select name="role" defaultValue="viewer" aria-label="Role">
                      <option value="viewer">Viewer (read only)</option>
                      <option value="editor">Editor (read + edit)</option>
                      {canCreateAdmins && <option value="admin">Admin</option>}
                    </select>
                    <button type="submit">Approve</button>
                  </form>{" "}
                  <form action={reject} className={styles.inline}>
                    <input type="hidden" name="userId" value={p.id} />
                    <button type="submit">Reject</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p><Link href="/">Back</Link></p>
    </main>
  );
}
