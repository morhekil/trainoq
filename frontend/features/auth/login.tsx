import { useState, type FormEvent } from "react";
import { request, trpc } from "../../api";
import { AuthError } from "./session";

export function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await request(trpc.auth.login.mutate({ password }), true);
      onDone();
    } catch (err) {
      setError(err instanceof AuthError ? err.message : "Can't reach the server – check your connection");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="login" onSubmit={submit}>
      <div className="login-mark" aria-hidden="true">
        <img src="/icon-192.png" alt="" width={64} height={64} />
      </div>
      <h1>Trainoq</h1>
      <input
        className="text"
        type="password"
        autoComplete="current-password"
        placeholder="Password"
        aria-label="Password"
        value={password}
        autoFocus
        onChange={(e) => setPassword(e.target.value)}
      />
      {error && <div className="login-error">{error}</div>}
      <button type="submit" className="btn big primary" disabled={busy || !password}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
