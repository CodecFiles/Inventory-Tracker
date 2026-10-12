import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/session";
import { signOut } from "../../auth-actions";

const TEXT: Record<string, string> = {
  pending: "Your account is waiting for an administrator to approve it. You will be able to use the app once it is approved.",
  rejected: "Your account request was not approved. Contact an MRD administrator if you think this is a mistake.",
  disabled: "Your account has been disabled. Contact an MRD administrator.",
};

export default async function PendingPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.status === "approved") redirect("/");
  return (
    <div className="card authcard">
      <h2 style={{ fontSize: 22, fontWeight: 600 }}>Hello {user.fullName}</h2>
      <div className={user.status === "pending" ? "alert warn" : "alert err"}>{TEXT[user.status]}</div>
      <form action={signOut}>
        <button type="submit" className="btn" style={{ width: "100%" }}>Sign out</button>
      </form>
    </div>
  );
}
