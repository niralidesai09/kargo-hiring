"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button } from "@/components/ui";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    }).catch(() => null);
    const data = await res?.json().catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(data?.error ?? "Couldn't reach the server.");
      return;
    }
    const next = params.get("next");
    router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm">
      <p className="text-lg font-semibold tracking-[-0.02em]">Kargo</p>
      <h1 className="mt-6 text-2xl font-semibold">Sign in to Hiring</h1>
      <p className="mt-1 text-md text-ink-2">Candidate data is private to Kargo.</p>
      <label className="mt-7 block">
        <span className="text-base font-medium">Password</span>
        <input
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "login-error" : undefined}
          className="mt-1.5 h-10 w-full rounded-[var(--radius)] border border-rule-strong bg-sheet px-3 text-base outline-none hover:border-ink-4 focus:border-accent"
        />
      </label>
      {error && <p id="login-error" role="alert" className="mt-2 text-sm text-bad">{error}</p>}
      <Button type="submit" variant="primary" loading={busy} className="mt-5 w-full">Sign in</Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main id="main" className="grid min-h-dvh place-items-center px-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
