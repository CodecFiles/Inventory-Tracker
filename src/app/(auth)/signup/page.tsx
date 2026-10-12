import Link from "next/link";
import { GoogleButton } from "@/components/google-button";
import { signUp } from "../../auth-actions";

export default async function SignUpPage({ searchParams }: PageProps<"/signup">) {
  const { error } = await searchParams;
  return (
    <div className="card authcard">
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-.015em" }}>Request an account</h2>
        <p className="muted" style={{ fontSize: 13.5 }}>
          Any email address works. An administrator approves new accounts before they can be used.
        </p>
      </div>
      {typeof error === "string" && <div role="alert" className="alert err">{error}</div>}
      <form action={signUp} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <label className="lbl" htmlFor="fn">Full name</label>
          <input id="fn" name="fullName" className="fld" autoComplete="name" required minLength={2} />
        </div>
        <div>
          <label className="lbl" htmlFor="em">Email</label>
          <input id="em" name="email" className="fld" type="email" autoComplete="email" required />
        </div>
        <div>
          <label className="lbl" htmlFor="pw">Password (at least 10 characters)</label>
          <input id="pw" name="password" className="fld" type="password" autoComplete="new-password" required minLength={10} />
        </div>
        <button type="submit" className="btn p" style={{ height: 44 }}>Request account</button>
      </form>
      <div className="or">or</div>
      <GoogleButton />
      <p className="muted" style={{ fontSize: 13 }}>Already have one? <Link href="/login">Sign in</Link></p>
    </div>
  );
}
