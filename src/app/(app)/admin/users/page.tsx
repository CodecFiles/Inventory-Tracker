import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { getPermissions, requireApprovedUser, ROLE_LABEL } from "@/server/session";
import { listUsers } from "@/server/users/manage";
import { approve, reject, savePermissions, setDisabled, setRole } from "./actions";

// Users & roles (design/Users.dc.html, with the agreed roles — D8): approve new sign-ups, change
// roles, disable people (never delete), and give Admins their individual permissions. The server and
// the database check every change; hiding buttons here is only for convenience.

const STATUS: Record<string, [string, string]> = {
  pending: ["Waiting", "s-prep"], approved: ["Active", "s-deployed"], rejected: ["Rejected", "s-retired"], disabled: ["Disabled", "s-damaged"],
};
const day = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : "—");

export default async function UsersPage() {
  const me = await requireApprovedUser();
  const permissions = await getPermissions(me.id);
  let data;
  try {
    data = await listUsers(me.id);
  } catch {
    return <main className="main"><div className="alert err">You do not have permission to manage users.</div></main>;
  }
  const isSuper = me.role === "super_admin";
  const canManage = permissions.has("users.manage");
  const pending = data.users.filter((u) => u.status === "pending");
  const others = data.users.filter((u) => u.status !== "pending");
  const roleOptions = (current?: string | null) => (
    <>
      <option value="viewer">Viewer (read only)</option>
      <option value="editor">Editor (read + edit)</option>
      {(isSuper || current === "admin") && <option value="admin" disabled={!isSuper}>Admin</option>}
      {(isSuper || current === "super_admin") && <option value="super_admin" disabled={!isSuper}>Super Admin</option>}
    </>
  );

  return (
    <main className="main">
      <div>
        <nav aria-label="Breadcrumb" className="bc"><Link href="/">Dashboard</Link><span aria-hidden="true">/</span><span>Users &amp; roles</span></nav>
        <h1 className="h1">Users &amp; roles</h1>
        <p className="muted">Viewer reads · Editor does the daily work · Admin gets the permissions a Super Admin gives · Super Admin can do everything.</p>
      </div>

      {permissions.has("users.approve") && (
        <section className="card">
          <div className="sh"><div><h2>Waiting for approval</h2><p>New sign-ups can do nothing until they are approved with a role.</p></div></div>
          {pending.length === 0 ? <div className="empty">Nobody is waiting.</div> : pending.map((u) => (
            <div key={u.id} className="row" style={{ flexWrap: "wrap" }}>
              <span style={{ flex: "1 1 220px" }}><span style={{ fontWeight: 500 }}>{u.fullName}</span>
                <div className="muted" style={{ fontSize: 12.5 }}>{u.email} · asked {day(u.createdAt)}</div></span>
              <ActionForm action={approve.bind(null, u.id)} submit="Approve" className="formrow" style={{ flex: "0 1 360px" }}>
                <label className="fl">Role<select className="fld" name="role" defaultValue="viewer">{roleOptions()}</select></label>
              </ActionForm>
              <ActionForm action={reject.bind(null, u.id)} submit="Reject" danger confirm={`Reject ${u.fullName}?`} />
            </div>
          ))}
        </section>
      )}

      <section className="card">
        <div className="sh"><div><h2>Everyone</h2><p>People are disabled, never deleted — their name stays on the history they created.</p></div></div>
        <div className="tw">
          <table className="tbl">
            <thead><tr><th>Person</th><th>Role</th><th>Status</th><th>Approved</th>{canManage && <th>Change</th>}</tr></thead>
            <tbody>
              {others.map((u) => {
                const self = u.id === me.id;
                const protectedUser = !isSuper && (u.role === "admin" || u.role === "super_admin");
                const [label, cls] = STATUS[u.status] ?? [u.status, ""];
                return (
                  <tr key={u.id}>
                    <td style={{ whiteSpace: "normal" }}><span style={{ fontWeight: 500 }}>{u.fullName}</span>{self && <span className="muted"> (you)</span>}
                      <div className="muted" style={{ fontSize: 12 }}>{u.email}</div>
                      {u.role === "admin" && <div className="muted" style={{ fontSize: 12 }}>{u.permissions.length ? u.permissions.join(", ") : "no permissions yet"}</div>}
                    </td>
                    <td>{u.role ? ROLE_LABEL[u.role] : "—"}</td>
                    <td><span className={`b ${cls}`}>{label}</span></td>
                    <td className="muted">{day(u.approvedAt)}{u.approvedBy ? ` · ${u.approvedBy}` : ""}</td>
                    {canManage && (
                      <td style={{ whiteSpace: "normal" }}>
                        {self ? <span className="muted">You cannot change yourself</span> : protectedUser ? <span className="muted">Super Admin only</span> : (
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                            {u.status === "approved" && (
                              <ActionForm action={setRole.bind(null, u.id)} submit="Save role" className="formrow">
                                <select className="fld" name="role" defaultValue={u.role ?? "viewer"} aria-label={`Role for ${u.fullName}`} style={{ height: 32 }}>{roleOptions(u.role)}</select>
                              </ActionForm>
                            )}
                            {u.status === "approved" && <ActionForm action={setDisabled.bind(null, u.id, true)} submit="Disable" danger confirm={`Disable ${u.fullName}? They can no longer use the app.`} />}
                            {u.status === "disabled" && <ActionForm action={setDisabled.bind(null, u.id, false)} submit="Enable" />}
                          </div>
                        )}
                        {isSuper && u.role === "admin" && u.status === "approved" && (
                          <details className="edit" style={{ marginTop: 8 }}>
                            <summary className="lnk">Admin permissions</summary>
                            <ActionForm action={savePermissions.bind(null, u.id, u.permissions)} submit="Save permissions"
                                        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 6, paddingTop: 10 }}>
                              {data.permissions.map((p) => (
                                <label key={p.key} style={{ display: "flex", gap: 8, fontSize: 12.5, alignItems: "flex-start" }}>
                                  <input type="checkbox" name="permission" value={p.key} defaultChecked={u.permissions.includes(p.key)} />
                                  <span><span className="mono">{p.key}</span><div className="muted">{p.description}</div></span>
                                </label>
                              ))}
                            </ActionForm>
                          </details>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
