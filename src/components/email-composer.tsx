"use client";

import clsx from "clsx";
import { Check, Eye, PenLine } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { formatSentAt } from "@/lib/status";
import type { Decision, EmailDrafts, EmailType } from "@/lib/types";
import { Button, Dialog, Segmented, useToast } from "./ui";

export interface ComposerProps {
  candidateId: string;
  candidateName: string;
  candidateEmail: string | null;
  decision: Decision;
  drafts: EmailDrafts | null;
  emailType: EmailType | null;
  subject: string | null;
  body: string | null;
  ready: boolean;
  sent: { at: string; to: string | null } | null;
  lastSendError: string | null;
  testRecipient: string | null;
  sendingConfigured: boolean;
  /** Parent registers a flush so a decision change can save edits first. */
  registerFlush?: (fn: () => Promise<void>) => void;
}

const TYPE_LABEL: Record<EmailType, string> = { interview: "Interview invite", rejection: "Rejection" };

export function EmailComposer(p: ComposerProps) {
  const router = useRouter();
  const toast = useToast();
  const [type, setType] = useState<EmailType>(p.emailType ?? "interview");
  const [local, setLocal] = useState<EmailDrafts | null>(p.drafts);
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [local, type, mode]);

  const expected: EmailType | null = p.decision === "shortlisted" ? "interview" : p.decision === "not_shortlisted" ? "rejection" : null;
  const current = local?.[type] ?? { subject: p.subject ?? "", body: p.body ?? "" };

  async function save(ready: boolean, silent = false) {
    if (!local) return false;
    setSaving(true);
    const res = await fetch(`/api/candidates/${p.candidateId}/email`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ emailType: type, subject: current.subject, body: current.body, ready }),
    }).catch(() => null);
    const data = await res?.json().catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      toast(data?.error ?? "Couldn't save the draft.", "bad");
      return false;
    }
    setDirty(false);
    if (!silent) toast(ready ? "Saved and marked ready to send." : "Draft saved.", "ok");
    router.refresh();
    return true;
  }

  useEffect(() => {
    p.registerFlush?.(async () => {
      if (dirty) await save(false, true);
    });
  });

  async function send() {
    setSending(true);
    setError(null);
    const res = await fetch("/api/send-email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ candidateId: p.candidateId, emailType: type, subject: current.subject, body: current.body }),
    }).catch(() => null);
    const data = await res?.json().catch(() => null);
    setSending(false);
    setConfirming(false);
    if (!res) {
      setError("Couldn't reach the server. Check your connection; nothing was sent.");
      return;
    }
    if (!res.ok) {
      setError(data?.error ?? "The email wasn't sent.");
      router.refresh();
      return;
    }
    toast("Email sent.", "ok");
    router.refresh();
  }

  if (p.sent) {
    return (
      <div>
        <p className="flex items-center gap-2 text-md font-medium text-ok">
          <Check className="size-4" aria-hidden /> Sent
        </p>
        <p className="mt-0.5 tabular text-sm text-ink-3">
          {formatSentAt(p.sent.at)}{p.sent.to && <> · to {p.sent.to}</>}
        </p>
        <div className="mt-4 rounded-[var(--radius)] border border-rule bg-sheet-2 px-3.5 py-3">
          <p className="text-base font-medium">{p.subject}</p>
          <p className="mt-2 whitespace-pre-wrap text-base text-ink-2">{p.body}</p>
        </div>
      </div>
    );
  }

  if (!local) {
    return <p className="text-base text-ink-3">Drafts appear here once screening finishes.</p>;
  }

  const blockedReason = !p.candidateEmail
    ? "There's no email address on file for this candidate."
    : !expected
      ? "Choose Shortlist or Not shortlist above to send."
      : expected !== type
        ? `This candidate is ${expected === "interview" ? "shortlisted" : "not shortlisted"}. Switch to the ${TYPE_LABEL[expected].toLowerCase()} to send.`
        : !p.sendingConfigured
          ? "Sending isn't configured yet (RESEND_API_KEY)."
          : null;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          label="Email type"
          size="sm"
          value={type}
          onChange={(v) => {
            setType(v);
            setError(null);
          }}
          options={[
            { value: "interview", label: "Interview invite" },
            { value: "rejection", label: "Rejection" },
          ]}
        />
        <button
          type="button"
          onClick={() => setMode(mode === "edit" ? "preview" : "edit")}
          className="inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-ink"
          aria-pressed={mode === "preview"}
        >
          {mode === "edit" ? <><Eye className="size-3.5" aria-hidden />Preview</> : <><PenLine className="size-3.5" aria-hidden />Edit</>}
        </button>
      </div>

      <dl className="mt-4 grid grid-cols-[3.75rem_1fr] gap-y-2 text-base">
        <dt className="text-ink-3">To</dt>
        <dd className="min-w-0 truncate">
          {p.candidateEmail ? <>{p.candidateName} <span className="text-ink-3">&lt;{p.candidateEmail}&gt;</span></> : <span className="text-bad">No email on file</span>}
          {p.testRecipient && <span className="block text-xs text-warn">Test mode: delivered to {p.testRecipient}</span>}
        </dd>
      </dl>

      {mode === "edit" ? (
        <div className="mt-3 flex flex-col gap-2">
          <label className="block">
            <span className="sr-only">Subject</span>
            <input
              value={current.subject}
              onChange={(e) => {
                setLocal({ ...local, [type]: { ...current, subject: e.target.value } });
                setDirty(true);
              }}
              className="h-9 w-full rounded-[var(--radius)] border border-rule-strong bg-sheet px-3 text-base font-medium outline-none hover:border-ink-4 focus:border-accent"
              placeholder="Subject"
            />
          </label>
          <label className="block">
            <span className="sr-only">Message</span>
            <textarea
              ref={bodyRef}
              value={current.body}
              onChange={(e) => {
                setLocal({ ...local, [type]: { ...current, body: e.target.value } });
                setDirty(true);
              }}
              rows={10}
              className="block w-full resize-none rounded-[var(--radius)] border border-rule-strong bg-sheet px-3 py-2.5 text-base leading-[1.6] outline-none hover:border-ink-4 focus:border-accent"
            />
          </label>
        </div>
      ) : (
        <div className="mt-3 rounded-[var(--radius)] border border-rule bg-sheet-2 px-4 py-3.5">
          <p className="text-base font-semibold">{current.subject}</p>
          <div className="mt-3 space-y-3 text-base leading-[1.6] text-ink-2">
            {current.body.split(/\n{2,}/).map((para, i) => (
              <p key={i} className="whitespace-pre-wrap">{para}</p>
            ))}
          </div>
        </div>
      )}

      {(error || p.lastSendError) && (
        <p role="alert" className="mt-3 text-sm text-bad">{error ?? p.lastSendError} {!error && "You can try again."}</p>
      )}
      {blockedReason && <p className="mt-3 text-sm text-ink-3">{blockedReason}</p>}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <span className={clsx("text-xs", dirty ? "text-warn" : "text-ink-4")}>
          {dirty ? "Unsaved changes" : p.ready ? "Saved · ready to send" : "Saved"}
        </span>
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => save(expected === type && !!p.candidateEmail)}
            loading={saving}
            disabled={!dirty && (p.ready || expected !== type)}
            title={expected === type ? "Save and add to the batch of ready emails" : "Save this draft"}
          >
            {expected === type && p.candidateEmail ? (p.ready && !dirty ? "Ready" : "Save & mark ready") : "Save draft"}
          </Button>
          <Button size="sm" variant="primary" disabled={!!blockedReason || saving} onClick={() => setConfirming(true)}>
            Confirm &amp; send
          </Button>
        </div>
      </div>

      <Dialog
        open={confirming}
        onClose={() => !sending && setConfirming(false)}
        title={`Send ${TYPE_LABEL[type].toLowerCase()} to ${p.candidateName}?`}
        labelledBy="send-dialog-title"
        footer={
          <>
            <Button onClick={() => setConfirming(false)} disabled={sending}>Cancel</Button>
            <Button variant="primary" onClick={send} loading={sending}>Send email</Button>
          </>
        }
      >
        <dl className="grid grid-cols-[4.5rem_1fr] gap-y-1.5 text-base">
          <dt className="text-ink-3">To</dt>
          <dd className="min-w-0 break-words">{p.testRecipient ?? p.candidateEmail}</dd>
          <dt className="text-ink-3">Subject</dt>
          <dd className="min-w-0 break-words font-medium">{current.subject}</dd>
        </dl>
        <div className="mt-3 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-[var(--radius)] border border-rule bg-sheet-2 px-3.5 py-3 text-sm leading-[1.6] text-ink-2">
          {current.body}
        </div>
        <p className="mt-3 text-sm text-ink-3">Sending can’t be undone. It goes out once, exactly as shown.</p>
      </Dialog>
    </div>
  );
}
