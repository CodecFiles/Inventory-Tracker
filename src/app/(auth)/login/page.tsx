import Link from "next/link";
import { GoogleButton } from "@/components/google-button";
import { signIn } from "../../auth-actions";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error, message } = await searchParams;
  return (
    <div className="card authcard">
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-.015em" }}>Sign in</h2>
        <p className="muted" style={{ fontSize: 13.5 }}>Use your email and password, or your Google account.</p>
      </div>
      {typeof error === "string" && (
        <div role="alert" className="alert err"><span><strong>We couldn&apos;t sign you in.</strong> {error}</span></div>
      )}
      {typeof message === "string" && <div role="status" className="alert ok">{message}</div>}
      <form action={signIn} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <label className="lbl" htmlFor="em">Email</label>
          <input id="em" name="email" className="fld" type="email" autoComplete="username" placeholder="name@moonrock.om" required />
        </div>
        <div>
          <label className="lbl" htmlFor="pw">Password</label>
          <input id="pw" name="password" className="fld" type="password" autoComplete="current-password" required />
        </div>
        <button type="submit" className="btn p" style={{ height: 44 }}>Sign in</button>
      </form>
      <div className="or">or</div>
      <GoogleButton />
      <p className="muted" style={{ fontSize: 13 }}>
        New here? <Link href="/signup">Request an account</Link> — an administrator approves it before you can use it.
      </p>
    </div>
  );
}
