"use client";

import clsx from "clsx";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { useState } from "react";
import type { CriterionDetail } from "@/lib/queries";
import { evidenceStrength } from "@/lib/scoring";
import { ScoreTicks } from "./ui";

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function CriterionRow({ c, open, onToggle }: { c: CriterionDetail; open: boolean; onToggle: () => void }) {
  const id = `crit-${c.key}`;
  return (
    <li className="border-b border-rule last:border-0">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={onToggle}
          className="group grid w-full grid-cols-[1fr_auto] items-start gap-x-4 gap-y-1 py-3.5 text-left sm:grid-cols-[1fr_auto_auto]"
        >
          <span className="flex min-w-0 items-start gap-2">
            <ChevronRight
              aria-hidden
              className={clsx("mt-0.5 size-3.5 shrink-0 text-ink-4 transition-transform duration-[var(--dur)] ease-[var(--ease-out)]", open && "rotate-90")}
            />
            <span className="min-w-0">
              <span className="block text-md font-medium text-ink group-hover:underline decoration-ink-4">{c.criterion_name}</span>
              <span className="block text-sm text-ink-3">
                {evidenceStrength(c.score)} · weight {fmt(c.weight)}%
                {!c.evidence_verified && <span className="text-warn"> · quote not found verbatim</span>}
              </span>
            </span>
          </span>
          <span className="flex items-center gap-2.5 pt-0.5">
            <ScoreTicks score={c.score} />
            <span className="tabular text-base font-semibold">
              {c.score}<span className="font-normal text-ink-3">/5</span>
            </span>
          </span>
          <span className="col-start-2 row-start-2 text-right tabular text-sm text-ink-3 sm:col-start-3 sm:row-start-1 sm:w-20 sm:pt-0.5 sm:text-base">
            <span className="font-medium text-ink">{fmt(c.weighted_score)}</span> / {fmt(c.weight)}
          </span>
        </button>
      </h3>
      <div id={id} hidden={!open} className="pb-4 pl-5.5">
        <div className="grid gap-4 sm:grid-cols-[7.5rem_1fr] sm:gap-x-5">
          <p className="text-2xs font-semibold uppercase tracking-[0.06em] text-ink-3 sm:pt-0.5">Evidence from CV</p>
          {c.evidence ? (
            <figure>
              <blockquote className="border-l border-rule-strong pl-3.5 text-md text-ink">“{c.evidence}”</blockquote>
              {!c.evidence_verified && (
                <figcaption className="mt-2 flex items-start gap-1.5 text-sm text-warn">
                  <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                  This quote doesn’t appear word-for-word in the anonymised CV. Check the original before relying on it.
                </figcaption>
              )}
            </figure>
          ) : (
            <p className="text-md text-ink-2">The CV contains no evidence for this criterion. That is missing information, not a negative finding.</p>
          )}
          <p className="text-2xs font-semibold uppercase tracking-[0.06em] text-ink-3 sm:pt-0.5">Why this score</p>
          <p className="text-md text-ink-2">{c.reason}</p>
          <p className="text-2xs font-semibold uppercase tracking-[0.06em] text-ink-3 sm:pt-0.5">Rubric</p>
          <p className="text-sm text-ink-3">{c.description}</p>
        </div>
      </div>
    </li>
  );
}

export function ScoreBreakdown({ criteria, total }: { criteria: CriterionDetail[]; total: number | null }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const allOpen = open.size === criteria.length && criteria.length > 0;
  const toggle = (k: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  return (
    <div>
      <div className="flex items-center justify-between border-b border-rule pb-2">
        <p className="text-2xs font-semibold uppercase tracking-[0.06em] text-ink-3">Criterion · score · contribution</p>
        <button
          type="button"
          onClick={() => setOpen(allOpen ? new Set() : new Set(criteria.map((c) => c.key)))}
          className="text-sm text-ink-2 underline decoration-rule-strong hover:text-ink"
        >
          {allOpen ? "Collapse all" : "Show all evidence"}
        </button>
      </div>
      <ul>
        {criteria.map((c) => (
          <CriterionRow key={c.key} c={c} open={open.has(c.key)} onToggle={() => toggle(c.key)} />
        ))}
      </ul>
      {total != null && (
        <p className="mt-1 flex flex-wrap items-baseline justify-between gap-2 border-t border-rule-strong pt-3 text-sm text-ink-3">
          <span className="tabular">
            {criteria.map((c) => fmt(c.weighted_score)).join(" + ")} =
          </span>
          <span className="tabular text-base font-semibold text-ink">{fmt(total)} / 100</span>
        </p>
      )}
    </div>
  );
}
