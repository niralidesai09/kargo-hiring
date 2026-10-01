import { NextResponse } from "next/server";
import { handle, jsonError, UUID_RE } from "@/lib/api";
import { supabaseRepo } from "@/lib/db";
import { sendConfigFromEnv } from "@/lib/mailer";
import { sendCandidateEmail } from "@/lib/send";
import type { EmailType } from "@/lib/types";

/**
 * Sends one candidate email via Resend. Only called after Arjun confirms in the UI.
 * email_sent flips to true only after Resend accepts the message.
 */
export const POST = handle("send-email", async (request: Request) => {
  const body = (await request.json().catch(() => null)) as
    | { candidateId?: string; subject?: string; body?: string; emailType?: EmailType }
    | null;
  if (!body) return jsonError(400, "Send a JSON body.");
  if (!body.candidateId || !UUID_RE.test(body.candidateId)) return jsonError(404, "This candidate no longer exists.", "not_found");

  const result = await sendCandidateEmail(supabaseRepo(), sendConfigFromEnv(), {
    candidateId: body.candidateId,
    subject: body.subject ?? "",
    body: body.body ?? "",
    emailType: body.emailType as EmailType,
  });
  if (!result.ok) return jsonError(result.status, result.error, result.code);
  return NextResponse.json(result);
});
