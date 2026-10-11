import Link from "next/link";
import { getSql } from "@/server/db";
import { requireApprovedUser } from "@/server/session";
import { signOut } from "./auth-actions";
import styles from "./auth.module.css";

// Temporary home page: proves login, approval and roles work. Stage 6 replaces it with the
// Dashboard from design/.
export default async function Home() {
  const user = await requireApprovedUser();
  const [{ allowed: canApprove }] = await getSql()`select has_permission(${user.id}, 'users.approve') as allowed`;

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1>MRD Inventory</h1>
        <p>
          Signed in as <strong>{user.fullName}</strong> ({user.email}) — role: <strong>{user.role}</strong>
        </p>
        {canApprove && <Link href="/admin/users">Approve new accounts</Link>}
        <p>The inventory screens arrive in Stage 6.</p>
        <form action={signOut}>
          <button type="submit">Sign out</button>
        </form>
      </div>
    </main>
  );
}
