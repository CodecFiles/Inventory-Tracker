import Link from "next/link";
import { signIn, signInWithGoogle } from "../auth-actions";
import styles from "../auth.module.css";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error, message } = await searchParams;
  return (
    <main className={styles.page}>
      <form action={signIn} className={styles.card}>
        <h1>Sign in to MRD Inventory</h1>
        {typeof message === "string" && <p className={styles.message}>{message}</p>}
        {typeof error === "string" && <p className={styles.error}>{error}</p>}
        <label>
          Email
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          Password
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <button type="submit">Sign in</button>
        <p>
          New here? <Link href="/signup">Request an account</Link>
        </p>
      </form>
      <form action={signInWithGoogle} className={styles.card}>
        <button type="submit" className={styles.secondary}>Continue with Google</button>
      </form>
    </main>
  );
}
