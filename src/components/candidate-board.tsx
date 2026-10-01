"use client";

import clsx from "clsx";
import { ArrowRight, RotateCw, Search, Upload } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import type { CandidateListItem } from "@/lib/queries";
import { STAGE_LABEL, STATUS_META } from "@/lib/status";
import { ROLE_LABEL, type Role, type WorkflowStatus } from "@/lib/types";
import { Button, buttonClasses, Dialog, EmptyState, formatScore, Stamp, useToast } from "./ui";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

type Filter = "all" | "review" | "shortlisted" | "hold" | "not_shortlisted" | "sent";
const FILTERS: { value: Filter; label: string; match: (s: WorkflowStatus) => boolean }[] = [
  { value: "all", label: "All", match: () => true },
  { value: "review", label: "Needs decision", match: (s) => s === "review" },
  { value: "shortlisted", label: "Shortlisted", match: (s) => s === "shortlisted" || s === "email_ready" },
  { value: "hold", label: "Hold", match: (s) => s === "hold" },
  { value: "not_shortlisted", label: "Passed", match: (s) => s === "not_shortlisted" },
  { value: "sent", label: "Sent", match: (s) => s === "sent" },
];

const ROLE_TONE: Record<Role, { text: string; fill: string; bar: string }> = {
  pm: { text: "text-pm", fill: "bg-pm-fill", bar: "bg-pm" },
  spm: { text: "text-spm", fill: "bg-spm-fill", bar: "bg-spm" },
};

function crossFit(c: CandidateListItem): string | null {
  if (c.pm_score == null || c.spm_score == null) return null;
  const other: Role = c.role_applied === "pm" ? "spm" : "pm";
  const otherScore = other === "pm" ? c.pm_score : c.spm_score;
  const own = c.role_applied === "pm" ? c.pm_score : c.spm_score;
  return otherScore - own >= 10 ? `Stronger ${other.toUpperCase()} fit · ${formatScore(otherScore)}` : null;
}

const byScore = (a: CandidateListItem, b: CandidateListItem) =>
  (b.score ?? -1) - (a.score ?? -1) || a.created_at.localeCompare(b.created_at);

/* -------------------------------------------------------------------------- */
/* A row is a loading gauge: the fill behind the name is the score.            */
/* -------------------------------------------------------------------------- */

function GaugeRow({
  c, rank, compact, onRetry, retrying,
}: {
  c: CandidateListItem;
  rank: number | null;
  compact?: boolean;
  onRetry: () => void;
  retrying: boolean;
}) {
  const tone = ROLE_TONE[c.role_applied];
  const pending = c.status === "processing";
  const failed = c.status === "failed";
  const pct = Math.max(0, Math.min(100, c.score ?? 0));
  const fit = crossFit(c);
  const showStamp = !pending && !failed && c.status !== "review";
  const meta = STATUS_META[c.status];

  return (
    <li className="group relative isolate overflow-hidden border-b border-rule last:border-0">
      {/* score fill */}
      <span
        aria-hidden
        className={clsx("absolute inset-y-0 left-0 -z-10 transition-[width,opacity] duration-500 ease-[var(--ease-out)] group-hover:opacity-100", tone.fill, pending ? "animate-pulse opacity-60" : "opacity-70")}
        style={{ width: pending ? "35%" : `${pct}%` }}
      />
      <span aria-hidden className={clsx("absolute bottom-0 left-0 h-[2px]", tone.bar)} style={{ width: pending ? 0 : `${pct}%` }} />

      <div className={clsx("grid grid-cols-[1.75rem_1fr_auto] items-center gap-x-3", compact ? "px-4 py-3" : "px-5 py-3.5")}>
        <span className="tabular text-sm text-ink-3">{rank ?? "–"}</span>
        <div className="min-w-0">
          <Link
            href={`/candidates/${c.id}`}
            className="block truncate text-md font-semibold text-ink after:absolute after:inset-0 after:content-[''] focus-visible:outline-none group-focus-within:underline"
          >
            {c.name}
          </Link>
          <p className="line-clamp-2 text-sm text-ink-2 sm:line-clamp-1">
            {pending ? (
              <span className="text-ink-3">{STAGE_LABEL[c.processing_status]}…</span>
            ) : failed ? (
              <span className="text-bad">{STAGE_LABEL[c.processing_status]}</span>
            ) : (
              <>
                {c.top_strength}
                {c.main_concern && <span className="text-ink-3"> · {c.main_concern.toLowerCase()}</span>}
              </>
            )}
          </p>
          {(fit || (!c.has_email && !pending && !failed)) && (
            <p className="text-xs text-ink-3">
              {fit && <span className={ROLE_TONE[c.role_applied === "pm" ? "spm" : "pm"].text}>{fit}</span>}
              {fit && !c.has_email && " · "}
              {!c.has_email && !pending && !failed && "No email on file"}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {showStamp && <Stamp tone={meta.tone} className="hidden sm:inline-flex">{meta.label}</Stamp>}
          {c.send_failed && <span className="hidden text-2xs font-semibold uppercase tracking-[0.06em] text-bad sm:inline">Send failed</span>}
          {failed ? (
            <button
              type="button"
              onClick={onRetry}
              disabled={retrying}
              className="relative z-10 inline-flex items-center gap-1 rounded-[var(--radius)] border border-rule-strong bg-sheet px-2 py-1 text-sm hover:border-ink-4 disabled:opacity-50"
            >
              <RotateCw className={clsx("size-3", retrying && "animate-spin")} aria-hidden />Retry
            </button>
          ) : (
            <span className={clsx("tabular font-semibold tracking-[-0.03em]", compact ? "w-10 text-xl" : "w-12 text-2xl", "text-right", pending && "text-ink-4")}>
              {pending ? "··" : formatScore(c.score)}
            </span>
          )}
        </div>
      </div>
      {showStamp && <span className="sr-only">Status: {meta.label}</span>}
    </li>
  );
}

function Leaderboard({
  role, rows, compact, retry, retrying, footer, titled = true,
}: {
  titled?: boolean;
  role: Role;
  rows: CandidateListItem[];
  compact?: boolean;
  retry: (id: string) => void;
  retrying: Set<string>;
  footer?: React.ReactNode;
}) {
  const scored = rows.filter((r) => r.score != null).sort(byScore);
  const other: Role = role === "pm" ? "spm" : "pm";
  const crossover = rows.filter((r) => crossFit(r)).length;
  const rest = rows.filter((r) => r.score == null);
  const rankOf = new Map(scored.map((r, i) => [r.id, i + 1]));
  const ordered = [...rest, ...scored];
  return (
    <section aria-labelledby={`lb-${role}`} className="min-w-0">
      <div className={clsx("flex items-baseline justify-between gap-3 pb-3", !titled && "sr-only")}>
        <h2 id={`lb-${role}`} className="flex items-baseline gap-2.5">
          <span aria-hidden className={clsx("size-2.5 translate-y-[-1px] rounded-[2px]", ROLE_TONE[role].bar)} />
          <span className="text-lg font-semibold">{ROLE_LABEL[role]}</span>
          <span className="tabular text-sm text-ink-3">{rows.length}</span>
        </h2>
        {footer}
      </div>
      {crossover >= 3 && (
        <p className="-mt-1 mb-3 text-sm text-ink-2">
          <span className={clsx("font-semibold", ROLE_TONE[other].text)}>{crossover} of {rows.length}</span> score at least 10 points higher on the {other.toUpperCase()} rubric. Worth a look as {ROLE_LABEL[other]} hires.
        </p>
      )}
      {rows.length === 0 ? (
        <p className="rounded-[var(--radius-lg)] border border-dashed border-rule-strong px-5 py-8 text-center text-base text-ink-3">No candidates here.</p>
      ) : (
        <ol className="overflow-hidden rounded-[var(--radius-lg)] border border-rule bg-sheet shadow-sheet">
          {ordered.map((c) => (
            <GaugeRow key={c.id} c={c} rank={rankOf.get(c.id) ?? null} compact={compact} onRetry={() => retry(c.id)} retrying={retrying.has(c.id)} />
          ))}
        </ol>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export function CandidateBoard({ items, role }: { items: CandidateListItem[]; role: Role | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const toast = useToast();
  const [, startTransition] = useTransition();

  const filter = (params.get("status") as Filter) || "all";
  const [q, setQ] = useState(params.get("q") ?? "");
  const [retrying, setRetrying] = useState<Set<string>>(new Set());
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchSending, setBatchSending] = useState(false);

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (!value || value === "all") next.delete(key);
    else next.set(key, value);
    startTransition(() => router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false }));
  }

  const processing = items.some((i) => i.status === "processing");
  useEffect(() => {
    if (!processing) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [processing, router]);

  const scoped = useMemo(() => (role ? items.filter((i) => i.role_applied === role) : items), [items, role]);
  const needle = q.trim().toLowerCase();
  const visible = useMemo(
    () =>
      scoped
        .filter((i) => FILTERS.find((f) => f.value === filter)!.match(i.status))
        .filter((i) => !needle || [i.name, i.top_strength, i.main_concern].some((s) => s?.toLowerCase().includes(needle))),
    [scoped, filter, needle],
  );

  const count = (pred: (s: WorkflowStatus) => boolean) => scoped.filter((i) => pred(i.status)).length;
  const screened = scoped.filter((i) => i.score != null).length;
  const waiting = count((s) => s === "review");
  const shortlisted = count((s) => s === "shortlisted" || s === "email_ready");
  const sent = count((s) => s === "sent");
  const ready = scoped.filter((i) => i.status === "email_ready");
  const inFlight = count((s) => s === "processing");
  const failed = count((s) => s === "failed");
  const nextUp = scoped.filter((i) => i.status === "review" && i.score != null).sort(byScore)[0];

  async function retry(id: string) {
    setRetrying((s) => new Set(s).add(id));
    const res = await fetch(`/api/candidates/${id}/process`, { method: "POST" }).catch(() => null);
    const body = await res?.json().catch(() => null);
    setRetrying((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
    if (!res?.ok || !body?.ok) toast(body?.error ?? "Retry didn’t complete. Try again in a minute.", "bad");
    router.refresh();
  }

  async function sendBatch() {
    setBatchSending(true);
    const res = await fetch("/api/send-batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ candidateIds: ready.map((r) => r.id) }),
    }).catch(() => null);
    const body = await res?.json().catch(() => null);
    setBatchSending(false);
    setBatchOpen(false);
    if (!res?.ok) toast(body?.error ?? "Couldn’t reach the server.", "bad");
    else if (body.failed) toast(`${body.sent} sent, ${body.failed} didn’t send. Open those candidates to see why.`, "bad");
    else toast(`${body.sent} ${body.sent === 1 ? "email" : "emails"} sent.`, "ok");
    router.refresh();
  }

  const stats: { label: string; value: number; note?: string }[] = [
    { label: "Screened", value: screened, note: inFlight ? `${inFlight} in progress` : undefined },
    { label: "Waiting on you", value: waiting },
    { label: "Shortlisted", value: shortlisted, note: ready.length ? `${ready.length} email${ready.length === 1 ? "" : "s"} ready` : undefined },
    { label: "Emails sent", value: sent },
  ];

  return (
    <div className="mx-auto max-w-[1320px] px-4 pb-20 pt-6 sm:px-8 lg:pt-9">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div>
          <h1 className="text-2xl font-semibold">
            {role ? <span className="inline-flex items-baseline gap-3"><span aria-hidden className={clsx("size-3 rounded-[3px]", ROLE_TONE[role].bar)} />{ROLE_LABEL[role]}</span> : "Hiring"}
          </h1>
          <p className="mt-1 text-md text-ink-2">
            {role ? `Ranked by ${role.toUpperCase()} score. Every point traces to a line in the CV.` : "Review candidates, compare evidence, and prepare interviews."}
          </p>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <label className="relative flex-1 sm:w-60 sm:flex-none">
            <span className="sr-only">Search candidates</span>
            <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-4" />
            <input
              type="search"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setParam("q", e.target.value);
              }}
              placeholder="Search"
              className="h-9 w-full rounded-[var(--radius)] border border-rule-strong bg-sheet pl-8 pr-3 text-base outline-none hover:border-ink-4 focus:border-accent"
            />
          </label>
          <Link href="/upload" className={buttonClasses("primary", "md", "hidden sm:inline-flex")}>
            <Upload className="size-3.5" aria-hidden />Upload CV
          </Link>
        </div>
      </header>

      {/* Four numbers, no cards */}
      <dl className="mt-8 grid grid-cols-2 gap-y-6 border-y border-rule py-6 sm:grid-cols-4 sm:divide-x sm:divide-rule">
        {stats.map((s, i) => (
          <div key={s.label} className={clsx("sm:px-6", i === 0 && "sm:pl-0")}>
            <dt className="text-sm text-ink-3">{s.label}</dt>
            <dd className="mt-1 flex items-baseline gap-2">
              <span className={clsx("tabular text-4xl font-semibold tracking-[-0.04em]", s.value === 0 ? "text-ink-4" : "text-ink")}>
                {s.value}
              </span>
              {s.note && <span className="text-sm text-ink-3">{s.note}</span>}
            </dd>
          </div>
        ))}
      </dl>

      {/* What needs Arjun now */}
      {(ready.length > 0 || nextUp || failed > 0) && (
        <div className="mt-6 flex flex-col gap-px overflow-hidden rounded-[var(--radius-lg)] bg-ink text-paper sm:flex-row">
          {nextUp && (
            <Link href={`/candidates/${nextUp.id}`} className="group flex flex-1 items-center justify-between gap-4 px-5 py-4 hover:bg-ink-2">
              <span>
                <span className="block text-sm text-paper/70">Next to review</span>
                <span className="block text-lg font-semibold">
                  {nextUp.name} <span className="tabular font-normal text-paper/70">· {formatScore(nextUp.score)} {nextUp.role_applied.toUpperCase()}</span>
                </span>
              </span>
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          )}
          {ready.length > 0 && (
            <button type="button" onClick={() => setBatchOpen(true)} className="group flex flex-1 items-center justify-between gap-4 border-paper/15 px-5 py-4 text-left hover:bg-ink-2 sm:border-l">
              <span>
                <span className="block text-sm text-paper/70">Ready for your confirmation</span>
                <span className="block text-lg font-semibold">Send {ready.length} {ready.length === 1 ? "email" : "emails"}</span>
              </span>
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </button>
          )}
          {failed > 0 && (
            <div className="flex flex-1 items-center gap-4 border-paper/15 px-5 py-4 sm:border-l">
              <span>
                <span className="block text-sm text-paper/70">Couldn’t be screened</span>
                <span className="block text-lg font-semibold">{failed} need a retry <span className="font-normal text-paper/70">· top of the list</span></span>
              </span>
            </div>
          )}
        </div>
      )}

      {/* Boards */}
      {scoped.length === 0 ? (
        <div className="mt-10 rounded-[var(--radius-lg)] border border-rule bg-sheet">
          <EmptyState
            title="No candidates yet"
            body={role ? `Upload a CV for the ${ROLE_LABEL[role]} role to start screening.` : "Upload a CV to start screening your first candidate."}
            action={<Link href="/upload" className={buttonClasses("primary")}>Upload CV</Link>}
          />
        </div>
      ) : role ? (
        <div className="mt-10">
          <nav aria-label="Filter" className="-mx-4 mb-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <ul className="flex min-w-max gap-1.5">
              {FILTERS.map((f) => {
                const n = scoped.filter((i) => f.match(i.status)).length;
                const active = filter === f.value;
                return (
                  <li key={f.value}>
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => setParam("status", f.value)}
                      className={clsx(
                        "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors",
                        active ? "border-ink bg-ink text-paper" : "border-rule-strong text-ink-2 hover:border-ink-4 hover:text-ink",
                      )}
                    >
                      {f.label}
                      <span className={clsx("tabular", active ? "text-paper/70" : "text-ink-4")}>{n}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
          {visible.length === 0 ? (
            <p className="py-12 text-center text-base text-ink-3">Nothing matches.</p>
          ) : (
            <Leaderboard role={role} rows={visible} retry={retry} retrying={retrying} titled={false} />
          )}
        </div>
      ) : (
        <div className="mt-10 grid gap-10 lg:grid-cols-2 lg:gap-8">
          {(["pm", "spm"] as Role[]).map((r) => (
            <Leaderboard
              key={r}
              role={r}
              compact
              rows={visible.filter((i) => i.role_applied === r)}
              retry={retry}
              retrying={retrying}
              footer={<Link href={`/?role=${r}`} className="text-sm text-ink-2 underline decoration-rule-strong hover:text-ink">Filter & sort</Link>}
            />
          ))}
        </div>
      )}

      <Dialog
        open={batchOpen}
        onClose={() => !batchSending && setBatchOpen(false)}
        title={`Send ${ready.length} ${ready.length === 1 ? "email" : "emails"}?`}
        footer={
          <>
            <Button onClick={() => setBatchOpen(false)} disabled={batchSending}>Cancel</Button>
            <Button variant="primary" onClick={sendBatch} loading={batchSending}>Confirm &amp; send {ready.length}</Button>
          </>
        }
      >
        <p className="text-base text-ink-2">Each email goes exactly as you last saved it. Sent emails can’t be recalled.</p>
        <ul className="mt-4 max-h-72 divide-y divide-rule overflow-y-auto rounded-[var(--radius)] border border-rule">
          {ready.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <span className="min-w-0">
                <span className="block truncate text-base font-medium">{r.name}</span>
                <span className="block text-xs text-ink-3">{ROLE_LABEL[r.role_applied]}</span>
              </span>
              <Stamp tone={r.email_type === "interview" ? "ok" : "neutral"}>{r.email_type === "interview" ? "Invite" : "Rejection"}</Stamp>
            </li>
          ))}
        </ul>
      </Dialog>
    </div>
  );
}
