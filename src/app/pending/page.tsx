import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/session";
import { signOut } from "../auth-actions";
import styles from "../auth.module.css";

const TEXT: Record<string, string> = {
  pending: "Your account is waiting for an administrator to approve it. You will be able to sign in once it is approved.",
  rejected: "Your account request was not approved. Contact an MRD administrator if you think this is a mistake.",
  disabled: "Your account has been disabled. Contact an MRD administrator.",
};

export default async function PendingPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.status === "approved") redirect("/");
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1>Hello {user.fullName}</h1>
        <p>{TEXT[user.status]}</p>
        <form action={signOut}>
          <button type="submit">Sign out</button>
        </form>
      </div>
    </main>
  );
}
