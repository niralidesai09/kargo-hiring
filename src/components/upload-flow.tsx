"use client";

import clsx from "clsx";
import { ArrowRight, Check, FileText, Loader2, RotateCw, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProcessingState, Role } from "@/lib/types";
import { Button, buttonClasses, formatScore } from "./ui";

/* -------------------------------------------------------------------------- */

type RoleChoice = Role | "auto";
const ROLES: { value: RoleChoice; title: string; hint: string }[] = [
  { value: "pm", title: "Product Manager", hint: "First PM on the core platform" },
  { value: "spm", title: "Senior Product Manager", hint: "Owns integrations and the data layer" },
  { value: "auto", title: "Not sure: let Kargo decide", hint: "Scored for both roles, filed under the one it fits" },
];

/** The four things that happen to a CV, in plain words. Also the live progress tracker. */
const STEPS: { title: string; detail: string; states: ProcessingState[] }[] = [
  { title: "Read the CV", detail: "Text is taken from the PDF or Word file.", states: ["uploaded", "extracting", "extracted"] },
  { title: "Remove personal details", detail: "Name, email, phone and links are stripped before any AI sees it.", states: ["anonymising"] },
  { title: "Score against the rubric", detail: "Five criteria, 0–5 each, every score backed by a quote from the CV. Kargo calculates the total out of 100.", states: ["scoring"] },
  { title: "Prepare the interview", detail: "A three-line interview brief and a draft email. Nothing is sent until you confirm.", states: ["generating_brief", "generating_email"] },
];

const stepIndex = (s: ProcessingState | null) => (s ? STEPS.findIndex((st) => st.states.includes(s)) : -1);

interface Summary {
  name: string | null;
  role: Role;
  score: number | null;
  rank: { position: number; of: number } | null;
  strength: string | null;
  concern: string | null;
  probe: string | null;
  location: string | null;
  hasEmail: boolean;
  roleBasis: string | null;
}

type ItemState = "waiting" | "working" | "done" | "failed";
interface Item {
  key: string;
  file: File;
  state: ItemState;
  stage: ProcessingState | null;
  candidateId: string | null;
  error: string | null;
  summary: Summary | null;
}

const CONCURRENCY = 2;
const ACCEPT = ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/* -------------------------------------------------------------------------- */

function StepList({ stage, state }: { stage: ProcessingState | null; state: ItemState | "idle" }) {
  const current = state === "done" ? STEPS.length : stepIndex(stage);
  return (
    <ol className="space-y-4">
      {STEPS.map((s, i) => {
        const done = state === "done" || (state !== "idle" && i < current);
        const active = state === "working" && i === Math.max(current, 0);
        return (
          <li key={s.title} className="flex gap-3">
            <span
              aria-hidden
              className={clsx(
                "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border text-2xs font-semibold tabular",
                done ? "border-ok bg-ok text-sheet" : active ? "border-accent text-accent" : "border-rule-strong text-ink-3",
              )}
            >
              {done ? <Check className="size-3" /> : active ? <Loader2 className="size-3 animate-spin" /> : i + 1}
            </span>
            <span>
              <span className={clsx("block text-base font-medium", !done && !active && state !== "idle" ? "text-ink-3" : "text-ink")}>
                {s.title}
                <span className="sr-only">{done ? " (done)" : active ? " (in progress)" : ""}</span>
              </span>
              <span className="block text-sm text-ink-3">{s.detail}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function ResultCard({ item, onRetry }: { item: Item; onRetry: () => void }) {
  if (item.state === "failed") {
    return (
      <div className="rounded-[var(--radius-lg)] border border-rule bg-sheet p-5">
        <p className="text-sm text-ink-3">{item.file.name}</p>
        <p className="mt-1 text-lg font-semibold">We couldn’t screen this CV.</p>
        <p className="mt-1 text-base text-ink-2">{item.error ?? "Something went wrong."}</p>
        <Button className="mt-4" size="sm" onClick={onRetry}><RotateCw className="size-3" aria-hidden />Try again</Button>
      </div>
    );
  }
  const s = item.summary;
  const roleTitle = s?.role === "spm" ? "Senior Product Manager" : "Product Manager";
  return (
    <div className="rounded-[var(--radius-lg)] border border-rule bg-sheet p-5 shadow-sheet">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm text-ok"><Check className="size-3.5" aria-hidden />Screened</p>
          <p className="mt-1 truncate text-xl font-semibold">{s?.name ?? item.file.name}</p>
          <p className="text-sm text-ink-3">
            {roleTitle}
            {s?.location && <> · {s.location}</>}
          </p>
        </div>
        <div className="text-right">
          <p className="tabular text-4xl font-semibold leading-none tracking-[-0.04em]">{formatScore(s?.score)}</p>
          <p className="mt-1 text-sm text-ink-3">out of 100</p>
        </div>
      </div>
      {s?.roleBasis && (
        <p className="mt-3 rounded-[var(--radius)] border border-rule bg-sheet-2 px-3.5 py-2.5 text-sm text-ink-2">
          <span className="font-semibold text-ink">Kargo filed this under {roleTitle}.</span> {s.roleBasis}
        </p>
      )}
      {s && (
        <dl className="mt-4 grid gap-3 border-t border-rule pt-4 text-base sm:grid-cols-2">
          {s.rank && (
            <div className="sm:col-span-2">
              <dt className="sr-only">Rank</dt>
              <dd className="text-ink-2">
                Ranked <span className="font-semibold text-ink tabular">{s.rank.position}</span> of {s.rank.of} {roleTitle} applicants
              </dd>
            </div>
          )}
          <div><dt className="text-sm text-ink-3">Strongest area</dt><dd>{s.strength}</dd></div>
          <div><dt className="text-sm text-ink-3">Main gap</dt><dd>{s.concern}</dd></div>
          {s.probe && (
            <div className="rounded-[var(--radius)] bg-accent-wash px-3.5 py-2.5 sm:col-span-2">
              <dt className="text-2xs font-semibold uppercase tracking-[0.08em] text-accent">Ask in the interview</dt>
              <dd className="mt-0.5">{s.probe}</dd>
            </div>
          )}
          {!s.hasEmail && <p className="text-sm text-warn sm:col-span-2">No email address was found in this CV, so it can’t be emailed from here.</p>}
        </dl>
      )}
      {item.candidateId && (
        <Link href={`/candidates/${item.candidateId}`} className={buttonClasses("primary", "md", "mt-5 w-full sm:w-auto")}>
          Open full review & decide<ArrowRight className="size-3.5" aria-hidden />
        </Link>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export function UploadFlow() {
  const router = useRouter();
  const [role, setRole] = useState<RoleChoice | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const [started, setStarted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const launched = useRef(new Set<string>());

  const update = (key: string, patch: Partial<Item>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  function addFiles(list: FileList | File[]) {
    setItems((xs) => [
      ...xs,
      ...[...list].map((file) => ({
        key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`,
        file, state: "waiting" as const, stage: null, candidateId: null, error: null, summary: null,
      })),
    ]);
  }

  const processOne = useCallback(async (item: Item, chosenRole: RoleChoice) => {
    let id = item.candidateId;
    try {
      update(item.key, { state: "working", stage: "uploaded", error: null });
      if (!id) {
        const form = new FormData();
        form.set("file", item.file);
        form.set("role", chosenRole);
        const res = await fetch("/api/candidates", { method: "POST", body: form });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return update(item.key, { state: "failed", error: data.error ?? "The upload didn’t go through." });
        id = data.id as string;
        update(item.key, { candidateId: id });
      }
      const poll = setInterval(async () => {
        const s = await fetch(`/api/candidates/${id}/status`).then((r) => r.json()).catch(() => null);
        if (s?.processing_status) update(item.key, { stage: s.processing_status });
      }, 1500);
      const res = await fetch(`/api/candidates/${id}/process`, { method: "POST" }).catch(() => null);
      clearInterval(poll);
      const data = await res?.json().catch(() => null);
      if (!res?.ok || !data?.ok) return update(item.key, { state: "failed", stage: data?.status ?? null, error: data?.error ?? "Screening didn’t finish." });
      const status = await fetch(`/api/candidates/${id}/status`).then((r) => r.json()).catch(() => null);
      update(item.key, { state: "done", stage: "ready_for_review", summary: status?.summary ?? null });
    } catch {
      update(item.key, { state: "failed", error: "Lost connection to the server." });
    }
  }, []);

  useEffect(() => {
    if (!started || !role) return;
    const active = items.filter((i) => i.state === "working").length;
    items
      .filter((i) => i.state === "waiting" && !launched.current.has(i.key))
      .slice(0, Math.max(0, CONCURRENCY - active))
      .forEach((i) => {
        launched.current.add(i.key);
        void processOne(i, role);
      });
    if (items.length > 0 && items.every((i) => i.state === "done" || i.state === "failed")) router.refresh();
  }, [items, started, role, processOne, router]);

  const busy = started && items.some((i) => i.state === "waiting" || i.state === "working");
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  function reset() {
    setItems([]);
    setStarted(false);
    launched.current.clear();
  }

  const single = items.length === 1 ? items[0] : null;
  const tracking = started ? (single ?? items.find((i) => i.state === "working") ?? null) : null;
  const finished = started && !busy;
  const doneCount = items.filter((i) => i.state === "done").length;

  return (
    <div className="mx-auto max-w-[1080px] px-4 pb-20 pt-6 sm:px-8 lg:pt-9">
      <h1 className="text-2xl font-semibold">Screen a CV</h1>
      <p className="mt-1 max-w-[60ch] text-md text-ink-2">Add a CV and you’ll get a score, the evidence behind it and a ready interview brief. Nothing is sent to the candidate.</p>

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-14">
        {/* ------------------------------------------------ Left: the form, then results */}
        <div className="min-w-0">
          {!started ? (
            <>
              <fieldset>
                <legend className="text-base font-semibold">Which role did they apply for?</legend>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  {ROLES.map((r) => {
                    const on = role === r.value;
                    return (
                      <label
                        key={r.value}
                        className={clsx(
                          "flex cursor-pointer items-start gap-3 rounded-[var(--radius-lg)] border bg-sheet px-4 py-3.5 transition-colors duration-[var(--dur-fast)]",
                          on ? "border-ink ring-1 ring-ink" : "border-rule-strong hover:border-ink-4",
                        )}
                      >
                        <input type="radio" name="role" value={r.value} checked={on} onChange={() => setRole(r.value)} className="mt-1 accent-[var(--ink)]" />
                        <span>
                          <span className="block text-md font-semibold">{r.title}</span>
                          <span className="block text-sm text-ink-3">{r.hint}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <div className="mt-8">
                <p className="text-base font-semibold">CV</p>
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
                  }}
                  className={clsx(
                    "mt-3 flex flex-col items-center justify-center rounded-[var(--radius-lg)] border border-dashed px-6 py-10 text-center transition-colors duration-[var(--dur-fast)]",
                    dragging ? "border-accent bg-accent-wash" : "border-rule-strong bg-sheet",
                  )}
                >
                  <FileText className="size-5 text-ink-3" aria-hidden />
                  <p className="mt-2.5 text-md font-medium">Drag a CV here</p>
                  <p className="text-sm text-ink-3">PDF or Word (.docx), up to 5 MB. You can add several.</p>
                  <Button className="mt-4" size="sm" onClick={() => inputRef.current?.click()}>Choose file</Button>
                  <input
                    ref={inputRef}
                    type="file"
                    accept={ACCEPT}
                    multiple
                    className="sr-only"
                    aria-label="Choose CV files"
                    onChange={(e) => {
                      if (e.target.files?.length) addFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </div>
                {items.length > 0 && (
                  <ul className="mt-3 divide-y divide-rule rounded-[var(--radius-lg)] border border-rule bg-sheet">
                    {items.map((i) => (
                      <li key={i.key} className="flex items-center justify-between gap-3 px-4 py-2.5">
                        <span className="flex min-w-0 items-center gap-2 text-base">
                          <FileText className="size-3.5 shrink-0 text-ink-3" aria-hidden />
                          <span className="truncate">{i.file.name}</span>
                        </span>
                        <button type="button" onClick={() => setItems((xs) => xs.filter((x) => x.key !== i.key))} className="rounded p-1 text-ink-4 hover:text-ink" aria-label={`Remove ${i.file.name}`}>
                          <X className="size-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button variant="primary" disabled={!role || items.length === 0} onClick={() => setStarted(true)}>
                  {items.length > 1 ? `Screen ${items.length} CVs` : "Screen CV"}
                </Button>
                <p className="text-sm text-ink-3">
                  {!role ? "Choose the role first." : items.length === 0 ? "Add a CV to continue." : "Takes about 20–40 seconds per CV."}
                </p>
              </div>
            </>
          ) : (
            <div aria-live="polite">
              <p className="text-base text-ink-2">
                {busy
                  ? items.length > 1
                    ? `Screening ${items.length} CVs${role === "auto" ? "" : ` for ${role === "pm" ? "Product Manager" : "Senior Product Manager"}`}. ${doneCount} done. Keep this tab open.`
                    : "Screening… keep this tab open. It takes about half a minute."
                  : items.length > 1
                    ? `${doneCount} of ${items.length} CVs screened.`
                    : "Done. Here’s the result."}
              </p>

              <div className="mt-4 space-y-3">
                {items.map((i) =>
                  i.state === "done" || i.state === "failed" ? (
                    <ResultCard key={i.key} item={i} onRetry={() => role && void processOne(i, role)} />
                  ) : (
                    <div key={i.key} className="flex items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-rule bg-sheet px-5 py-4">
                      <span className="min-w-0">
                        <span className="block truncate text-base font-medium">{i.file.name}</span>
                        <span className="block text-sm text-ink-3">
                          {i.state === "waiting" ? "Waiting its turn" : (STEPS[Math.max(stepIndex(i.stage), 0)]?.title ?? "Working") + "…"}
                        </span>
                      </span>
                      {i.state === "working" && <Loader2 className="size-4 shrink-0 animate-spin text-accent" aria-hidden />}
                    </div>
                  ),
                )}
              </div>

              {finished && (
                <div className="mt-6 flex flex-wrap gap-2">
                  <Button onClick={reset}>Screen another CV</Button>
                  <Link href={role && role !== "auto" ? `/?role=${role}` : "/"} className={buttonClasses("ghost")}>See all candidates</Link>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ------------------------------------------------ Right: what happens (and live progress) */}
        <aside aria-labelledby="what-happens" className="rounded-[var(--radius-lg)] border border-rule bg-sheet-2 p-5 lg:self-start">
          <h2 id="what-happens" className="text-base font-semibold">{tracking && busy ? "In progress" : "What happens to the CV"}</h2>
          {tracking && busy && items.length > 1 && <p className="mt-0.5 truncate text-sm text-ink-3">{tracking.file.name}</p>}
          <div className="mt-4">
            <StepList stage={tracking?.stage ?? null} state={tracking ? tracking.state : finished && doneCount ? "done" : "idle"} />
          </div>
          <p className="mt-5 border-t border-rule pt-4 text-sm text-ink-3">
            Every CV is also checked against the other role’s rubric, so you’ll see if someone fits the other job better.
          </p>
        </aside>
      </div>
    </div>
  );
}
