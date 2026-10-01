"use client";

import clsx from "clsx";
import { ArrowLeft, Check, Copy, FileText, RotateCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { CandidateDetail } from "@/lib/queries";
import { formatSentAt, PIPELINE_ORDER, STAGE_LABEL, STATUS_META, UPLOAD_STEPS } from "@/lib/status";
import { FAILED_STATES, IN_PROGRESS_STATES, ROLE_LABEL, type Decision, type Role } from "@/lib/types";
import { EmailComposer } from "./email-composer";
import { ScoreBreakdown } from "./score-breakdown";
import { Button, formatScore, Segmented, Skeleton, Stamp, useToast } from "./ui";

interface Config {
  testRecipient: string | null;
  sendingConfigured: boolean;
}

/* -------------------------------------------------------------------------- */

function StageRail({ d }: { d: CandidateDetail }) {
  const s = d.candidate.processing_status;
  const idx = PIPELINE_ORDER.indexOf(s);
  const done = (after: typeof s) => (idx === -1 ? !FAILED_STATES.includes(s) : idx > PIPELINE_ORDER.indexOf(after));
  const stages = [
    { label: "Extracted", done: done("extracted") || s === "anonymising" },
    { label: "Anonymised", done: done("anonymising") },
    { label: "Scored", done: done("scoring") },
    { label: "Briefed", done: done("generating_brief") },
    { label: "Drafted", done: done("generating_email") },
    { label: "Decided", done: d.candidate.decision !== "review" },
    { label: "Sent", done: Boolean(d.result?.email_sent) },
  ];
  const next = stages.findIndex((st) => !st.done);
  return (
    <ol aria-label="Progress" className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm">
      {stages.map((st, i) => (
        <li key={st.label} className="flex items-center gap-1">
          {i > 0 && <span aria-hidden className="mx-1 h-px w-3 bg-rule-strong sm:w-5" />}
          <span
            className={clsx(
              "inline-flex items-center gap-1",
              st.done ? "text-ink-2" : i === next ? "font-medium text-accent" : "text-ink-4",
            )}
          >
            {st.done ? <Check aria-hidden className="size-3" /> : <span aria-hidden className={clsx("size-1.5 rounded-full", i === next ? "bg-accent" : "bg-rule-strong")} />}
            {st.label}
            <span className="sr-only">{st.done ? " (done)" : i === next ? " (next)" : ""}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <dt className="text-2xs font-semibold uppercase tracking-[0.06em] text-ink-3">{children}</dt>;
}

/* -------------------------------------------------------------------------- */

function Processing({ d }: { d: CandidateDetail }) {
  const s = d.candidate.processing_status;
  const current = UPLOAD_STEPS.findIndex((st) => st.states.includes(s));
  return (
    <section aria-live="polite" className="rounded-[var(--radius-lg)] border border-rule bg-sheet p-6">
      <h2 className="text-lg font-semibold">Screening this CV</h2>
      <p className="mt-1 text-base text-ink-2">This usually takes 20–40 seconds. The page updates by itself.</p>
      <ol className="mt-5 space-y-2.5">
        {UPLOAD_STEPS.map((st, i) => (
          <li key={st.label} className={clsx("flex items-center gap-2.5 text-base", i < current ? "text-ink-2" : i === current ? "font-medium text-ink" : "text-ink-4")}>
            {i < current ? <Check aria-hidden className="size-3.5 text-ok" /> : <span aria-hidden className={clsx("size-1.5 rounded-full mx-1", i === current ? "animate-pulse bg-accent" : "bg-rule-strong")} />}
            {st.label}
          </li>
        ))}
      </ol>
      <div className="mt-6 space-y-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </section>
  );
}

function Failed({ d, onRetry, retrying }: { d: CandidateDetail; onRetry: () => void; retrying: boolean }) {
  return (
    <section role="alert" className="rounded-[var(--radius-lg)] border border-rule bg-sheet p-6">
      <h2 className="text-lg font-semibold">{STAGE_LABEL[d.candidate.processing_status]}.</h2>
      <p className="mt-1 max-w-prose text-md text-ink-2">{d.candidate.processing_error ?? "Something went wrong while processing this CV."}</p>
      <div className="mt-4 flex gap-2">
        <Button onClick={onRetry} loading={retrying}><RotateCw className="size-3.5" aria-hidden />Retry</Button>
        {d.candidate.original_file_url && (
          <a href={`/api/candidates/${d.candidate.id}/file`} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 px-2 text-base text-ink-2 hover:text-ink">
            <FileText className="size-3.5" aria-hidden />Open original
          </a>
        )}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

export function Docket({ d, config }: { d: CandidateDetail; config: Config }) {
  const router = useRouter();
  const toast = useToast();
  const c = d.candidate;
  const r = d.result;
  const applied = c.role_applied;
  const [view, setView] = useState<Role>(applied);
  const [deciding, setDeciding] = useState<Decision | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [copied, setCopied] = useState(false);
  const flush = useRef<() => Promise<void>>(async () => {});

  const processing = IN_PROGRESS_STATES.includes(c.processing_status);
  const failed = FAILED_STATES.includes(c.processing_status);
  const scored = r?.pm_score != null && r?.spm_score != null;

  useEffect(() => {
    if (!processing && c.processing_status !== "sending") return;
    const t = setInterval(() => router.refresh(), 2500);
    return () => clearInterval(t);
  }, [processing, c.processing_status, router]);

  async function decide(next: Decision) {
    if (next === c.decision) return;
    setDeciding(next);
    await flush.current();
    const res = await fetch(`/api/candidates/${c.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: next }),
    }).catch(() => null);
    const data = await res?.json().catch(() => null);
    setDeciding(null);
    if (!res?.ok) toast(data?.error ?? "Couldn't save your decision.", "bad");
    router.refresh();
  }

  async function retry() {
    setRetrying(true);
    const res = await fetch(`/api/candidates/${c.id}/process`, { method: "POST" }).catch(() => null);
    const data = await res?.json().catch(() => null);
    setRetrying(false);
    if (!res?.ok || !data?.ok) toast(data?.error ?? "Retry didn't complete. Try again in a minute.", "bad");
    router.refresh();
  }

  async function copyBrief() {
    const b = r?.interview_brief_parts;
    if (!b) return;
    const text = `${c.candidate_name ?? "Candidate"} — ${ROLE_LABEL[applied]}\nWhy they stand out: ${b.why}\nStrongest evidence: ${b.strongest_evidence}\nProbe: ${b.probe}`;
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  const meta = STATUS_META[d.status];
  const other: Role = applied === "pm" ? "spm" : "pm";
  const score = (role: Role) => (role === "pm" ? r?.pm_score : r?.spm_score) ?? null;
  const el = r?.eligibility_status;

  const decisionAndBrief = (at: "sm" | "lg") => (
    <>
          <section aria-labelledby={`decision-h-${at}`} className="rounded-[var(--radius-lg)] border border-rule-strong bg-sheet p-5 shadow-sheet">
            <h2 id={`decision-h-${at}`} className="text-lg font-semibold">Your decision</h2>
            <p className="mt-0.5 text-sm text-ink-3">
              {r?.email_sent ? "Final — the email has been sent." : "Picks the matching email. Nothing is sent until you confirm."}
            </p>
            <div className="mt-3.5">
              <Segmented
                label="Decision"
                value={deciding ?? (c.decision === "review" ? null : c.decision)}
                disabled={Boolean(r?.email_sent) || processing || deciding != null}
                onChange={decide}
                options={[
                  { value: "shortlisted", label: "Shortlist" },
                  { value: "hold", label: "Hold" },
                  { value: "not_shortlisted", label: "Not shortlist" },
                ]}
              />
            </div>
          </section>

          {r?.interview_brief_parts && (
            <section aria-labelledby={`brief-h-${at}`}>
              <div className="flex items-center justify-between">
                <h2 id={`brief-h-${at}`} className="text-lg font-semibold">Interview brief</h2>
                <button type="button" onClick={copyBrief} className="inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-ink">
                  {copied ? <Check className="size-3.5 text-ok" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
                  {copied ? "Copied" : "Copy brief"}
                </button>
              </div>
              <dl className="mt-3 space-y-3">
                <div><Label>Why they stand out</Label><dd className="mt-0.5 text-base text-ink-2">{r.interview_brief_parts.why}</dd></div>
                <div><Label>Strongest evidence</Label><dd className="mt-0.5 text-base text-ink-2">{r.interview_brief_parts.strongest_evidence}</dd></div>
                <div className="rounded-[var(--radius)] bg-accent-wash px-3.5 py-3">
                  <dt className="text-2xs font-semibold uppercase tracking-[0.08em] text-accent">Probe</dt>
                  <dd className="mt-1 text-md font-medium text-ink">{r.interview_brief_parts.probe}</dd>
                </div>
              </dl>
            </section>
          )}

    </>
  );

  return (
    <div className="mx-auto max-w-[1240px] px-4 pb-20 pt-5 sm:px-8 lg:pt-7">
      <Link href={`/?role=${applied}`} className="inline-flex items-center gap-1.5 text-sm text-ink-3 hover:text-ink">
        <ArrowLeft className="size-3.5" aria-hidden />Candidates
      </Link>

      {/* Docket header */}
      <header className="mt-4 border-b border-rule pb-5">
        <p className="font-mono text-xs text-ink-4">
          KRG-{c.id.slice(0, 6).toUpperCase()} · received {new Date(c.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
        </p>
        <div className="mt-1.5 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold tracking-[-0.02em]">{c.candidate_name ?? "Unnamed candidate"}</h1>
            <p className="mt-1.5 text-md text-ink-2">
              {ROLE_LABEL[applied]}
              {d.rank && <> · <span className="tabular">Ranked {d.rank.position} of {d.rank.of}</span></>}
              {c.name_source === "filename" && <span className="text-ink-3"> · name taken from file name</span>}
            </p>
          </div>
          <Stamp tone={meta.tone} className="mt-2">{meta.label}</Stamp>
        </div>
        <div className="mt-4"><StageRail d={d} /></div>
      </header>

      <div className="mt-7 grid gap-10 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-12">
        {/* ------------------------------------------------------------ AI screening */}
        <div className="min-w-0 space-y-10">
          {processing && <Processing d={d} />}
          {failed && <Failed d={d} onRetry={retry} retrying={retrying} />}

          {scored && (
            <>
              <section aria-labelledby="overview-h">
                <h2 id="overview-h" className="sr-only">Overview</h2>
                <div className="grid gap-x-10 gap-y-5 sm:grid-cols-[auto_1fr]">
                  <div>
                    <p className="text-sm text-ink-3">Score for {ROLE_LABEL[applied]}</p>
                    <p className="mt-1 flex items-baseline gap-1.5">
                      <span className="tabular text-4xl font-semibold leading-none tracking-[-0.04em]">{formatScore(score(applied))}</span>
                      <span className="text-base text-ink-3">/ 100</span>
                    </p>
                    {(() => {
                      const diff = (score(other) ?? 0) - (score(applied) ?? 0);
                      return (
                        <p className="mt-2 text-sm text-ink-3">
                          As {ROLE_LABEL[other]}: <span className="tabular font-medium text-ink-2">{formatScore(score(other))}</span>
                          {diff >= 10 && <span className="text-accent"> · fits that role better</span>}
                        </p>
                      );
                    })()}
                  </div>
                  <dl className="space-y-2 text-base sm:border-l sm:border-rule sm:pl-10">
                    <div>
                      <dt className="text-sm text-ink-3">Location <span className="text-ink-4">(not part of the score)</span></dt>
                      <dd><span className="font-medium">{el?.location_status ?? "—"}</span> <span className="text-ink-3">· {el?.location_basis}</span></dd>
                    </div>
                    <div>
                      <dt className="text-sm text-ink-3">Background match <span className="text-ink-4">(not part of the score)</span></dt>
                      <dd><span className="font-medium">{el?.role_match ?? "—"}</span> <span className="text-ink-3">· {el?.role_match_basis}</span></dd>
                    </div>
                  </dl>
                </div>
                {(r?.top_strength || r?.main_concern) && (
                  <dl className="mt-6 grid gap-x-10 gap-y-3 border-t border-rule pt-4 sm:grid-cols-2">
                    <div><Label>Strongest area</Label><dd className="mt-1 text-md">{r?.top_strength}</dd></div>
                    <div><Label>Main gap</Label><dd className="mt-1 text-md">{r?.main_concern}</dd></div>
                  </dl>
                )}
              </section>

              {/* Phones: the decision and the probe come before the evidence detail. */}
              <div className="space-y-8 lg:hidden">{decisionAndBrief("sm")}</div>

              <section aria-labelledby="breakdown-h">
                <div className="mb-3">
                  <h2 id="breakdown-h" className="text-xl font-semibold">Why {view === applied ? "this score" : `the ${ROLE_LABEL[view]} score`}</h2>
                  <p className="mt-0.5 text-sm text-ink-3">Each criterion is scored 0–5 from a quote in the CV. Kargo adds them up using the rubric weights.</p>
                </div>
                <ScoreBreakdown key={view} criteria={d.scores[view]} total={score(view)} />
                <button
                  type="button"
                  onClick={() => setView(view === applied ? other : applied)}
                  className="mt-4 text-sm text-ink-2 underline decoration-rule-strong underline-offset-4 hover:text-ink"
                >
                  {view === applied ? `Show the ${ROLE_LABEL[other]} breakdown (${formatScore(score(other))})` : `Back to the ${ROLE_LABEL[applied]} breakdown`}
                </button>
              </section>

              <details className="group rounded-[var(--radius-lg)] border border-rule bg-sheet">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-base">
                  <span>
                    <span className="font-medium">What the model saw</span>
                    <span className="ml-2 text-ink-3">Anonymised CV — name, contact details and links removed</span>
                  </span>
                  <span className="text-sm text-ink-3 group-open:hidden">Show</span>
                  <span className="hidden text-sm text-ink-3 group-open:inline">Hide</span>
                </summary>
                <div className="border-t border-rule px-4 py-3">
                  <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap font-sans text-sm leading-[1.6] text-ink-2">{c.anonymised_cv_text}</pre>
                  <a href={`/api/candidates/${c.id}/file`} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-sm text-ink-2 underline decoration-rule-strong hover:text-ink">
                    <FileText className="size-3.5" aria-hidden />Open original CV
                  </a>
                </div>
              </details>
            </>
          )}
        </div>

        {/* ------------------------------------------------------------ Arjun's side */}
        <aside className="min-w-0 space-y-8">
          <div className="hidden space-y-8 lg:block">{decisionAndBrief("lg")}</div>

          {(r?.email_drafts || r?.email_sent) && (
            <section aria-labelledby="email-h">
              <h2 id="email-h" className="mb-3 text-lg font-semibold">Email</h2>
              <EmailComposer
                key={`${r.email_type}-${r.updated_at}`}
                candidateId={c.id}
                candidateName={c.candidate_name ?? "Candidate"}
                candidateEmail={c.candidate_email}
                decision={c.decision}
                drafts={r.email_drafts}
                emailType={r.email_type}
                subject={r.email_subject}
                body={r.email_body}
                ready={r.email_ready}
                sent={r.email_sent && r.sent_at ? { at: r.sent_at, to: r.sent_to } : null}
                lastSendError={c.processing_status === "send_failed" ? r.last_send_error : null}
                testRecipient={config.testRecipient}
                sendingConfigured={config.sendingConfigured}
                registerFlush={(fn) => (flush.current = fn)}
              />
            </section>
          )}
          {r?.email_sent && r.sent_at && <p className="sr-only">Sent {formatSentAt(r.sent_at)}</p>}
        </aside>
      </div>
    </div>
  );
}
