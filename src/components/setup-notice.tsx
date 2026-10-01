import { configStatus } from "@/lib/queries";

/** Shown instead of a crash when Supabase isn't configured or the schema hasn't been applied. */
export function SetupNotice({ problem }: { problem: string }) {
  const cfg = configStatus();
  const rows: [string, boolean, string][] = [
    ["Supabase", cfg.supabase, "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY"],
    ["Gemini", cfg.gemini, "GEMINI_API_KEY"],
    ["Resend", cfg.resend, "RESEND_API_KEY and HIRING_FROM_EMAIL"],
    ["Sign-in", cfg.auth, "APP_PASSWORD and SESSION_SECRET"],
  ];
  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-8">
      <h1 className="text-2xl font-semibold">Finish setting up Kargo Hiring</h1>
      <p className="mt-2 text-md text-ink-2">{problem}</p>
      <dl className="mt-6 divide-y divide-rule rounded-[var(--radius-lg)] border border-rule bg-sheet">
        {rows.map(([name, ok, vars]) => (
          <div key={name} className="flex items-center justify-between gap-4 px-4 py-3">
            <dt>
              <span className="block text-base font-medium">{name}</span>
              <span className="block font-mono text-xs text-ink-3">{vars}</span>
            </dt>
            <dd className={ok ? "text-sm text-ok" : "text-sm text-bad"}>{ok ? "Configured" : "Missing"}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-6 text-base text-ink-2">
        Add the missing values to <code className="font-mono text-sm">.env.local</code> (or your Vercel project settings), then apply{" "}
        <code className="font-mono text-sm">supabase/schema.sql</code> and <code className="font-mono text-sm">supabase/seed.sql</code> in the Supabase SQL editor.
      </p>
    </div>
  );
}
