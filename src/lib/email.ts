import type { EmailDraft, EmailDrafts } from "./types";

const EMAIL_SYNTAX = /^[^\s@<>()[\]\\,;:"]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

export function isValidEmail(email: string | null | undefined): email is string {
  return typeof email === "string" && email.length <= 254 && EMAIL_SYNTAX.test(email.trim());
}

export function firstName(fullName: string | null | undefined): string {
  const first = (fullName ?? "").trim().split(/\s+/)[0];
  return first ? first[0].toUpperCase() + first.slice(1) : "";
}

export const SIGNATURE = "Arjun Mehta\nFounder, Kargo";

function schedulingLine(url: string | undefined): string {
  return url ? `Book a time that suits you: ${url}` : "Reply to this email with two or three times that suit you this week.";
}

function renderOne(draft: EmailDraft, name: string, kind: "interview" | "rejection", schedulingUrl?: string): EmailDraft {
  let body = draft.body.replace(/\r/g, "").trim();
  const greetingName = firstName(name);

  if (!/^(?:hi|hello|dear)\b/i.test(body)) body = `Hi {{first_name}},\n\n${body}`;
  if (kind === "interview" && !body.includes("{{scheduling_link}}")) body = `${body}\n\n{{scheduling_link}}`;
  if (kind === "rejection") body = body.replace(/\n?.*\{\{scheduling_link\}\}.*\n?/g, "\n");
  // Drop a lead-in the model wrote anyway ("Please pick a time using the link below:"): the line we insert says it all.
  body = body.replace(/(^|\n)[^\n]*(?:link|below|calendar|book|slot)[^\n]*:\s*\n+(\{\{scheduling_link\}\})/i, "$1$2");

  body = body
    .replaceAll("{{first_name}}", greetingName || "there")
    .replaceAll("{{scheduling_link}}", schedulingLine(schedulingUrl))
    .replace(/\{\{[^}]*\}\}/g, "") // never let an unknown placeholder reach a candidate
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Drop any sign-off the model added anyway (a line that is only "Best,", "Regards," … plus what follows it).
  const lines = body.split("\n");
  const signoff = lines.findIndex(
    (l, i) => i >= lines.length - 4 && /^\s*(?:best(?: regards| wishes)?|(?:warm|kind|warmest)? ?regards|thanks|thank you|sincerely|cheers)[,.!]?\s*$/i.test(l),
  );
  if (signoff > 0) body = lines.slice(0, signoff).join("\n").trim();
  body = `${body}\n\n${SIGNATURE}`;

  const subject = draft.subject.replaceAll("{{first_name}}", greetingName).replace(/\{\{[^}]*\}\}/g, "").trim();
  return { subject, body };
}

/** Insert the stored name and the scheduling link server-side, after generation. */
export function renderDrafts(drafts: EmailDrafts, candidateName: string | null, schedulingUrl?: string): EmailDrafts {
  return {
    interview: renderOne(drafts.interview, candidateName ?? "", "interview", schedulingUrl),
    rejection: renderOne(drafts.rejection, candidateName ?? "", "rejection", schedulingUrl),
  };
}

export function toHtml(body: string): string {
  const esc = body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const linked = esc.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1b1b18;max-width:560px">${linked
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, "<br>")}</p>`)
    .join("")}</div>`;
}
