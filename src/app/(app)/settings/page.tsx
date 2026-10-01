import type { Metadata } from "next";
import { connection } from "next/server";
import { SetupNotice } from "@/components/setup-notice";
import { ConfigError } from "@/lib/db";
import { configStatus, getRubricForSettings } from "@/lib/queries";
import { sumWeights } from "@/lib/scoring";
import { ROLE_LABEL, type Role, type RubricCriterion } from "@/lib/types";

export const metadata: Metadata = { title: "Settings" };

function RubricTable({ role, rows }: { role: Role; rows: RubricCriterion[] }) {
  const total = sumWeights(rows);
  const ok = total === 100;
  return (
    <section aria-labelledby={`rubric-${role}`} className="mt-8">
      <div className="flex items-baseline justify-between gap-4">
        <h3 id={`rubric-${role}`} className="text-lg font-semibold">{ROLE_LABEL[role]}</h3>
        <p className={ok ? "tabular text-sm text-ok" : "tabular text-sm font-medium text-bad"}>
          Weights total {total}% {ok ? "· valid" : "· scoring is blocked until this is 100%"}
        </p>
      </div>
      <ol className="mt-3 divide-y divide-rule rounded-[var(--radius-lg)] border border-rule bg-sheet">
        {rows.map((c) => (
          <li key={c.id} className="grid gap-x-6 gap-y-1 px-4 py-3.5 sm:grid-cols-[1fr_4rem]">
            <div>
              <p className="text-md font-medium">{c.criterion_name}</p>
              <p className="mt-1 max-w-[70ch] text-sm text-ink-2">{c.description}</p>
            </div>
            <p className="tabular text-md font-semibold sm:text-right">{c.weight}%</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default async function SettingsPage() {
  await connection();
  const cfg = configStatus();
  let rubric: RubricCriterion[];
  try {
    rubric = await getRubricForSettings();
  } catch (err) {
    if (err instanceof ConfigError) return <SetupNotice problem={err.message} />;
    return <SetupNotice problem="The rubric couldn't be loaded. Apply the schema and rubric seed." />;
  }
  const version = rubric[0]?.rubric_version ?? "—";

  const integrations: [string, string, boolean][] = [
    ["Database", "Supabase, server-side service key", cfg.supabase && cfg.serviceRole],
    ["Scoring model", cfg.geminiModel, cfg.gemini],
    ["Email", cfg.from ? `Resend · from ${cfg.from}` : "Resend", cfg.resend && Boolean(cfg.from)],
    ["Interview booking link", cfg.schedulingUrl ?? "Not set: invites ask candidates to reply with times", Boolean(cfg.schedulingUrl)],
    ["Sign-in", "Password gate", cfg.auth],
  ];

  return (
    <div className="mx-auto max-w-3xl px-4 pb-20 pt-6 sm:px-8 lg:pt-9">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="mt-1 text-md text-ink-2">How candidates are scored, and what the app is connected to.</p>

      <section aria-labelledby="rubric-h" className="mt-10">
        <h2 id="rubric-h" className="text-xl font-semibold">Rubric {version}</h2>
        <p className="mt-1 max-w-[70ch] text-base text-ink-2">
          Stored in the <code className="font-mono text-sm">rubric_criteria</code> table. The model reads it and scores each criterion 0–5; it cannot change
          criteria or weights. To recalibrate with more hiring history, edit the rows (or add a new version) and re-run scoring. Past scores keep the weight they were scored with.
        </p>
        <RubricTable role="pm" rows={rubric.filter((c) => c.role === "pm")} />
        <RubricTable role="spm" rows={rubric.filter((c) => c.role === "spm")} />
      </section>

      <section aria-labelledby="int-h" className="mt-12">
        <h2 id="int-h" className="text-xl font-semibold">Connections</h2>
        {cfg.testRecipient && (
          <p className="mt-2 rounded-[var(--radius)] bg-warn-wash px-3.5 py-2.5 text-base text-warn">
            Test mode is on: every email is delivered to {cfg.testRecipient} instead of the candidate. Remove RESEND_TEST_RECIPIENT to send for real.
          </p>
        )}
        <dl className="mt-4 divide-y divide-rule rounded-[var(--radius-lg)] border border-rule bg-sheet">
          {integrations.map(([name, detail, ok]) => (
            <div key={name} className="flex items-center justify-between gap-4 px-4 py-3">
              <dt>
                <span className="block text-base font-medium">{name}</span>
                <span className="block text-sm text-ink-3">{detail}</span>
              </dt>
              <dd className={ok ? "text-sm text-ok" : "text-sm text-ink-3"}>{ok ? "Connected" : "Not configured"}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-sm text-ink-3">Keys live only in server environment variables and are never sent to the browser.</p>
      </section>
    </div>
  );
}
