import { NextResponse } from "next/server";
import { handle, jsonError, UUID_RE } from "@/lib/api";
import { supabaseRepo } from "@/lib/db";
import type { EmailType } from "@/lib/types";

/** Save Arjun's edits to a draft, optionally marking it ready for the batch send. */
export const PUT = handle("email", async (request: Request, ctx: RouteContext<"/api/candidates/[id]/email">) => {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return jsonError(404, "Candidate not found.");
  const body = (await request.json().catch(() => null)) as
    | { emailType?: EmailType; subject?: string; body?: string; ready?: boolean }
    | null;
  const type = body?.emailType;
  if (type !== "interview" && type !== "rejection") return jsonError(422, "Unknown email type.");
  const subject = body?.subject?.trim() ?? "";
  const text = body?.body?.trim() ?? "";
  if (!subject || !text) return jsonError(422, "Subject and body are both required.");

  const repo = supabaseRepo();
  const [candidate, result] = await Promise.all([repo.getCandidate(id), repo.getResult(id)]);
  if (!candidate || !result) return jsonError(404, "Candidate not found.");
  if (result.email_sent) return jsonError(409, "This email has already been sent and can't be edited.");
  if (!result.email_drafts) return jsonError(409, "Drafts haven't been generated yet.");

  const ready = Boolean(body?.ready);
  if (ready) {
    const expected = candidate.decision === "shortlisted" ? "interview" : candidate.decision === "not_shortlisted" ? "rejection" : null;
    if (!expected) return jsonError(409, "Decide Shortlist or Not Shortlist before marking the email ready.");
    if (expected !== type) return jsonError(409, `This candidate is ${candidate.decision === "shortlisted" ? "shortlisted" : "not shortlisted"}; switch to the ${expected === "interview" ? "interview invite" : "rejection"} first.`);
    if (!candidate.candidate_email) return jsonError(422, "There's no email address on file for this candidate.");
  }

  await repo.upsertResult(id, {
    email_type: type,
    email_subject: subject,
    email_body: text,
    email_drafts: { ...result.email_drafts, [type]: { subject, body: text } },
    email_ready: ready,
  });
  return NextResponse.json({ ok: true, ready });
});
