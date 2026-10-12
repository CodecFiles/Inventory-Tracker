import Link from "next/link";
import { signInWithGoogle, signUp } from "../auth-actions";
import styles from "../auth.module.css";

export default async function SignUpPage({ searchParams }: PageProps<"/signup">) {
  const { error } = await searchParams;
  return (
    <main className={styles.page}>
      <form action={signUp} className={styles.card}>
        <h1>Request an account</h1>
        <p>Any email address works. An administrator approves new accounts before they can be used.</p>
        {typeof error === "string" && <p className={styles.error}>{error}</p>}
        <label>
          Full name
          <input name="fullName" autoComplete="name" required minLength={2} />
        </label>
        <label>
          Email
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          Password (at least 10 characters)
          <input name="password" type="password" autoComplete="new-password" required minLength={10} />
        </label>
        <button type="submit">Request account</button>
        <p>
          Already have one? <Link href="/login">Sign in</Link>
        </p>
      </form>
      <form action={signInWithGoogle} className={styles.card}>
        <button type="submit" className={styles.secondary}>Continue with Google</button>
      </form>
    </main>
  );
}
