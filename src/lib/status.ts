import type { StampTone } from "@/components/ui";
import type { ProcessingState, WorkflowStatus } from "./types";

export const STATUS_META: Record<WorkflowStatus, { label: string; tone: StampTone }> = {
  processing: { label: "Screening", tone: "muted" },
  failed: { label: "Needs retry", tone: "bad" },
  review: { label: "Review", tone: "neutral" },
  shortlisted: { label: "Shortlisted", tone: "ok" },
  hold: { label: "Hold", tone: "warn" },
  not_shortlisted: { label: "Not shortlisted", tone: "neutral" },
  email_ready: { label: "Email ready", tone: "accent" },
  sent: { label: "Sent", tone: "ok" },
};

/** Plain-language stage names shown while a CV is being processed. */
export const STAGE_LABEL: Record<ProcessingState, string> = {
  uploaded: "Queued",
  extracting: "Extracting CV",
  extracted: "Extracting CV",
  anonymising: "Removing personal information",
  scoring: "Evaluating against PM and SPM rubrics",
  generating_brief: "Preparing interview brief",
  generating_email: "Drafting email",
  ready_for_review: "Ready for review",
  sending: "Sending email",
  sent: "Sent",
  extraction_failed: "We couldn't read this CV",
  scoring_failed: "Scoring didn't complete",
  generation_failed: "Brief or email didn't generate",
  send_failed: "Email didn't send",
};

export const PIPELINE_ORDER: ProcessingState[] = [
  "uploaded", "extracting", "extracted", "anonymising", "scoring", "generating_brief", "generating_email", "ready_for_review",
];

export const UPLOAD_STEPS: { label: string; states: ProcessingState[] }[] = [
  { label: "Extracting CV", states: ["uploaded", "extracting", "extracted"] },
  { label: "Removing personal information", states: ["anonymising"] },
  { label: "Scoring against both rubrics", states: ["scoring"] },
  { label: "Preparing interview brief", states: ["generating_brief"] },
  { label: "Drafting email", states: ["generating_email"] },
];

export function relativeTime(iso: string, now = Date.now()): string {
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function formatSentAt(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
  return `${date} · ${time}`;
}
