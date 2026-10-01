import { createHash } from "node:crypto";
import { isValidEmail, toHtml } from "./email";
import type { Repo } from "./repo";
import type { EmailType } from "./types";
import { log } from "./log";

export class MailerError extends Error {
  constructor(
    message: string,
    readonly kind: "resend" | "network",
    readonly statusCode?: number | null,
  ) {
    super(message);
  }
}

export interface Mailer {
  send(msg: {
    from: string;
    to: string;
    replyTo?: string;
    subject: string;
    text: string;
    html: string;
    idempotencyKey: string;
  }): Promise<{ id: string }>;
}

export interface SendConfig {
  mailer: Mailer | null; // null when RESEND_API_KEY is missing
  from: string | undefined;
  replyTo?: string;
  /** When set, every email is delivered here instead (testing on Resend's shared domain). */
  testRecipient?: string;
}

export interface SendInput {
  candidateId: string;
  subject: string;
  body: string;
  emailType: EmailType;
}

export type SendResult =
  | { ok: true; sentAt: string; sentTo: string; messageId: string }
  | { ok: false; status: number; code: string; error: string };

const LOCK_STALE_MS = 2 * 60 * 1000;

const fail = (status: number, code: string, error: string): SendResult => ({ ok: false, status, code, error });

export async function sendCandidateEmail(repo: Repo, cfg: SendConfig, input: SendInput): Promise<SendResult> {
  const subject = input.subject?.trim() ?? "";
  const body = input.body?.trim() ?? "";
  if (!input.candidateId) return fail(400, "missing_candidate", "No candidate was specified.");
  if (!subject) return fail(422, "missing_subject", "The email needs a subject.");
  if (!body) return fail(422, "missing_body", "The email body is empty.");
  if (subject.length > 200) return fail(422, "subject_too_long", "The subject is longer than 200 characters.");
  if (input.emailType !== "interview" && input.emailType !== "rejection") return fail(422, "bad_type", "Unknown email type.");

  const candidate = await repo.getCandidate(input.candidateId);
  if (!candidate) return fail(404, "not_found", "This candidate no longer exists.");
  const result = await repo.getResult(input.candidateId);
  if (!result) return fail(409, "not_ready", "This candidate hasn't finished processing yet.");
  if (result.email_sent) {
    return fail(409, "already_sent", `An email was already sent to this candidate${result.sent_at ? ` on ${new Date(result.sent_at).toUTCString()}` : ""}.`);
  }

  // The email must follow Arjun's recorded decision — the system never picks the outcome.
  const expected = candidate.decision === "shortlisted" ? "interview" : candidate.decision === "not_shortlisted" ? "rejection" : null;
  if (!expected) return fail(409, "no_decision", "Record Shortlist or Not Shortlist before sending.");
  if (expected !== input.emailType) {
    return fail(409, "decision_mismatch", `This candidate is ${expected === "interview" ? "shortlisted" : "not shortlisted"}, so only the ${expected === "interview" ? "interview invite" : "rejection"} can be sent.`);
  }

  const recipient = candidate.candidate_email?.trim();
  if (!recipient) return fail(422, "missing_email", "There's no email address on file for this candidate.");
  if (!isValidEmail(recipient)) return fail(422, "invalid_email", `"${recipient}" isn't a valid email address.`);

  if (!cfg.mailer) return fail(503, "missing_api_key", "Email sending isn't configured: RESEND_API_KEY is missing on the server.");
  if (!cfg.from || !isValidEmail(cfg.from.replace(/^.*<([^>]+)>\s*$/, "$1"))) {
    return fail(503, "missing_from", "Email sending isn't configured: HIRING_FROM_EMAIL is missing or invalid.");
  }
  const deliverTo = cfg.testRecipient?.trim() || recipient;
  if (!isValidEmail(deliverTo)) return fail(503, "invalid_test_recipient", "RESEND_TEST_RECIPIENT is not a valid address.");

  // Atomic claim: only one request can hold the lock, and never after a successful send.
  const claimed = await repo.claimSend(input.candidateId, new Date(Date.now() - LOCK_STALE_MS));
  if (!claimed) return fail(409, "duplicate", "This email is already being sent. Refresh in a moment.");

  await repo.upsertResult(input.candidateId, {
    email_type: input.emailType,
    email_subject: subject,
    email_body: body,
    last_send_error: null,
  });
  await repo.updateCandidate(input.candidateId, { processing_status: "sending", processing_error: null });

  // Same candidate + same content → same key, so a retried request after a timeout can't double-send.
  const idempotencyKey = `kargo-${input.candidateId}-${createHash("sha256").update(`${deliverTo}\n${subject}\n${body}`).digest("hex").slice(0, 24)}`;

  try {
    const { id } = await cfg.mailer.send({
      from: cfg.from,
      to: deliverTo,
      replyTo: cfg.replyTo,
      subject,
      text: body,
      html: toHtml(body),
      idempotencyKey,
    });
    const sentAt = new Date().toISOString();
    await repo.upsertResult(input.candidateId, {
      email_sent: true,
      sent_at: sentAt,
      sent_to: deliverTo,
      resend_message_id: id,
      send_lock_at: null,
      email_ready: true,
    });
    await repo.updateCandidate(input.candidateId, { processing_status: "sent" });
    log.info("email.sent", { candidateId: input.candidateId, type: input.emailType });
    return { ok: true, sentAt, sentTo: deliverTo, messageId: id };
  } catch (err) {
    const message =
      err instanceof MailerError
        ? err.kind === "network"
          ? "Couldn't reach Resend. Check the connection and try again."
          : `Resend refused the email: ${err.message}`
        : "Sending failed unexpectedly.";
    await repo.upsertResult(input.candidateId, { send_lock_at: null, last_send_error: message });
    await repo.updateCandidate(input.candidateId, { processing_status: "send_failed", processing_error: message });
    log.warn("email.failed", { candidateId: input.candidateId, kind: err instanceof MailerError ? err.kind : "unknown" });
    return fail(502, err instanceof MailerError && err.kind === "network" ? "network_error" : "resend_error", message);
  }
}
