import { requireApprovedUser, ROLE_LABEL } from "@/server/session";

// Dashboard — the real one (stock overview, low stock) arrives in step 6.2.
export default async function Home() {
  const user = await requireApprovedUser();
  return (
    <main className="main">
      <div>
        <div className="ov">Dashboard</div>
        <h1 className="h1">Welcome, {user.fullName.split(" ")[0]}</h1>
        <p className="muted">Signed in as {user.email} · {ROLE_LABEL[user.role ?? ""]}</p>
      </div>
    </main>
  );
}
